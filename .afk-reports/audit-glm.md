# Audit: live-edit-typescript

**Date:** 2026-05-01
**Scope:** Full read-only audit — security, reliability, code quality, Docker, deps, perf, tests, docs.

---

## P0 — Critical Security

### S1. Command injection via `repo` / `sha` / `branch` parameters
**Files:** `server/runner.ts:29-34`, `server/runner.ts:148-149`, `server/index.ts:63-66`
User-controlled strings (`repo`, `sha`, `branch`) are interpolated directly into `execSync` / `spawn` shell commands:
```ts
execSync(`git clone ${cloneUrl} ${dir}`);
execSync(`git checkout ${sha}`);
execSync(`git fetch origin ${entry.branch}`);
```
A malicious value like `sha = "main; rm -rf /"` achieves RCE.
**Fix:** Validate inputs against a strict regex (`/^[a-zA-Z0-9._-]+$/` for repo names, `/^[0-9a-f]{7,40}$/` for SHAs, `/^[a-zA-Z0-9._/-]+$/` for branches) and/or use `execFileSync`/`execFile` with an args array instead of shell interpolation.

### S2. Path traversal in file-explorer endpoints
**File:** `server/index.ts:239-243`
```ts
const fullPath = pathModule.join(entry.dir, filePath);
if (!fullPath.startsWith(entry.dir)) return res.status(403)...
```
`pathModule.join` + `startsWith` is bypassable with `filePath = "../.."` on some platforms because `join` resolves `..` but `startsWith` can still match if the resolved path is a prefix of `entry.dir` in unexpected ways. More importantly, `filePath` comes from URL wildcard `*` and is not sanitized.
**Fix:** Use `pathModule.resolve(entry.dir, filePath)` and check `fullPath === entry.dir || fullPath.startsWith(entry.dir + pathModule.sep)`.

### S3. Hardcoded webhook secret
**File:** `server/webhook.ts:7`
```ts
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'live-edit-webhook-secret';
```
The fallback is a known value that an attacker can use to forge webhook payloads.
**Fix:** Remove the fallback; fail loudly if `WEBHOOK_SECRET` is not set.

### S4. No sandboxing for arbitrary code execution
**Files:** `server/runner.ts:51-143`, `Dockerfile:1`
The server `npm install`s and `npx vite`/`npm run dev`s arbitrary code from GitHub repos with zero isolation. The spawned processes inherit the parent's environment (including `GITHUB_TOKEN`, `OPENAI_API_KEY`, `OPENCLAW_GATEWAY_TOKEN`).
**Fix:**
- Strip secrets from child process env (`delete processEnv.GITHUB_TOKEN`, etc.).
- Run child processes under a non-root user.
- Consider nsjail/firejail or at minimum `--network=none` for static analysis, resource limits via `ulimit` or cgroups.
- Dockerfile should `USER node` and drop root.

### S5. Child processes inherit full environment with secrets
**File:** `server/runner.ts:77-86`
```ts
const processEnv = { ...process.env, PORT: String(port), ... };
```
This leaks `GITHUB_TOKEN`, `OPENAI_API_KEY`, `OPENCLAW_GATEWAY_TOKEN`, and any other env vars into arbitrary child processes.
**Fix:** Build a minimal env object with only the needed vars (`PORT`, `HOST`, `BASE`, `VITE_*`, user-provided `envVars`).

---

## P1 — High Impact Reliability & Security

### S6. No resource limits on child processes
**File:** `server/runner.ts:51,119-134`
`npm install` has a 120s timeout but the Vite dev server (`spawn`) has no memory/CPU limits. A malicious or broken repo can fork-bomb or OOM the host.
**Fix:** Set `ulimit` before spawning or use cgroups; limit max processes, memory, and CPU time.

### S7. `rmSync` in eviction can delete arbitrary directories
**File:** `server/runner.ts:176-179`
`removeFiles` blindly `rmSync(dir, { recursive: true, force: true })`. If `dir` is somehow corrupted (empty string, `/`, etc.), data loss occurs.
**Fix:** Assert `dir.startsWith(TARGETS_DIR)` before deleting.

### S8. Port range is tiny (16 ports)
**File:** `server/cache-manager.ts:19-20`
```ts
const PORT_MIN = 5174;
const PORT_MAX = 5189;
```
Only 16 concurrent entries are possible. With `MAX_ENTRIES = 10`, ports aren't the bottleneck, but 10 is also very low.
**Fix:** Widen port range (e.g. 5174-5273) and/or raise `MAX_ENTRIES` with a memory-based eviction policy.

### S9. `allocatePort` doesn't check OS-level port usage
**File:** `server/cache-manager.ts:34-40`
Only checks in-memory cache, not whether the port is actually free on the system (e.g. from a zombie process or another service).
**Fix:** Attempt to `net.createServer()` on the port to verify availability before returning it.

### S10. `process.kill(-entry.pid, 'SIGTERM')` kills entire process group
**File:** `server/runner.ts:159`
The negative PID sends SIGTERM to the entire process group, which could include other processes.
**Fix:** Track the process group explicitly and only kill known children.

### S11. Race condition in `evictIfNeeded`
**File:** `server/cache-manager.ts:53-61`
Multiple concurrent `/api/run` requests can both pass `evictIfNeeded()` and exceed `MAX_ENTRIES`.
**Fix:** Use a mutex/lock or make eviction synchronous with a check-then-add pattern.

---

## P2 — Code Quality / DRY

### C1. Duplicated `IframeWithRetry` component
**Files:** `src/PreviewPage.tsx:20-189` vs `src/IframeWithRetry.tsx:1-111`
`PreviewPage.tsx` defines its own local `IframeWithRetry` that duplicates the logic from the shared `IframeWithRetry.tsx`. The shared version also supports `forwardRef` while the local one doesn't.
**Fix:** Delete the local version in `PreviewPage.tsx` and import from `IframeWithRetry.tsx`.

### C2. Duplicated `CacheEntry` interface
**Files:** `src/PreviewPage.tsx:6-16`, `src/Editor.tsx:8-12`, `server/cache-manager.ts:3-16`
Three separate definitions of the same interface across client and server.
**Fix:** Create a shared `types.ts` (or `src/types.ts` for the client).

### C3. Duplicated `timeAgo` function
**Files:** `src/LandingPage.tsx:17-31`, `src/Editor.tsx:43-56`
Identical function defined twice.
**Fix:** Extract to `src/utils.ts`.

### C4. Duplicated `api` helper
**Files:** `src/LandingPage.tsx:15`, `src/PreviewPage.tsx:18`, `src/Editor.tsx:40`
Same one-liner in three files.
**Fix:** Extract to `src/api.ts`.

### C5. Duplicated `VoiceJob` interface
**Files:** `src/VoiceButton.tsx:36-42`, `server/index.ts:261-267`
Client and server both define this type.
**Fix:** Share via a types file.

### C6. Duplicated polling logic in `IframeWithRetry`
The polling loop with retry, server log fetching, and cancel logic is essentially the same pattern twice (once in each `IframeWithRetry` copy).
**Fix:** Consolidate to one component.

### C7. `Editor.tsx` is 985 lines — too large
**File:** `src/Editor.tsx`
This monolith mixes repo selection, branch/commit UI, cache management, file explorer, env modal, log modal, console interception, URL sync, and state persistence.
**Fix:** Extract into smaller components: `RepoSelector`, `BranchList`, `CommitList`, `FileExplorer`, `EnvModal`, `LogModal`, `CachePanel`.

### C8. Inline styles everywhere
**Files:** `src/LandingPage.tsx`, `src/Editor.tsx`, `src/VoiceButton.tsx`, `src/TranscriptHistoryModal.tsx`, `src/PreviewPage.tsx`
Hundreds of lines of inline `style={{}}` objects make components hard to read and prevent CSS optimization.
**Fix:** Move to `styles.css` (already exists) or CSS modules.

---

## P3 — Docker & Server Hygiene

### D1. Dockerfile runs as root
**File:** `Dockerfile:1`
```dockerfile
FROM node:22
```
No `USER` directive — container runs as root. Combined with S4, this is especially dangerous.
**Fix:** Add `USER node` and `RUN chown -R node:node /app`.

### D2. Dockerfile installs dev dependencies in production
**File:** `Dockerfile:6`
```dockerfile
RUN npm install --include=dev
```
Installs `tsx`, `typescript`, `vite`, `concurrently`, `react`, etc. as dev deps that shouldn't be in the production image.
**Fix:** Use multi-stage build: one stage for building, one for running. Use `npm ci --omit=dev` for the runtime stage.

### D3. Dockerfile copies entire source before install
**File:** `Dockerfile:8-9`
```dockerfile
COPY . .
CMD ["npm", "run", "dev"]
```
Copies everything (including potential `.env`, `targets/`, etc.). No `.dockerignore` file exists.
**Fix:** Add `.dockerignore` excluding `node_modules`, `targets`, `.env`, `.git`. Use `npm run build` + proper start command for production.

### D4. No `.dockerignore` file
**Missing file**
The `targets/` directory (cloned repos with `node_modules`) and `.env` could be baked into the image.
**Fix:** Create `.dockerignore`.

### D5. `npm run dev` used as production CMD
**File:** `Dockerfile:10`
`tsx watch` restarts the server on every file change and `vite` dev server runs alongside it. Not suitable for production.
**Fix:** Build the Vite client, then run `node --import tsx server/index.ts` or compile the server to JS.

### D6. No health check endpoint
**File:** `server/index.ts`
No `/api/health` or readiness probe. Makes orchestration (Docker, Kubernetes) blind to server state.
**Fix:** Add `app.get('/api/health', (_req, res) => res.json({ ok: true }))`.

### D7. No graceful shutdown
**File:** `server/index.ts:592-610`
`process.on('SIGTERM', ...)` is missing. On container stop, child processes (Vite servers) are orphaned.
**Fix:** Add SIGTERM handler that calls `stopServer` for all cache entries.

---

## P4 — Dependencies

### DEP1. Unused dependency: `form-data`
**File:** `package.json`
`form-data` is listed as a dependency but the code uses native `FormData` + `Blob` (Node 22). The comment at `server/index.ts:8` confirms this.
**Fix:** Remove `form-data` from dependencies.

### DEP2. Unused dependency: `http-proxy`
**File:** `package.json`
Wait — `http-proxy` IS used. But `@types/http-proxy` is at version `^1.17.17` while `http-proxy` is `^1.18.1`. The types are for v1, which matches. Not an issue, but consider if the types are still needed since the API surface is small.

### DEP3. Unused type packages: `@types/form-data`, `@types/multer`
**File:** `package.json`
`@types/form-data` is unnecessary if `form-data` is removed. `@types/multer` is at `^2.0.0` but `multer` is `^2.0.2` — these should match.

### DEP4. `html2canvas` imported dynamically
**File:** `src/VoiceButton.tsx:19`
```ts
const { default: html2canvas } = await import('html2canvas');
```
`html2canvas` is in `dependencies` but only used in the client. It should be in `devDependencies` (Vite bundles it).
**Fix:** Move to `devDependencies`.

### DEP5. No lockfile integrity check in CI
No CI exists (see T1).

---

## P5 — Performance

### P1. `npm install` on every run — no dependency caching
**File:** `server/runner.ts:51`
Every `cloneAndStart` runs a fresh `npm install`. For repos with heavy deps, this adds 30-120s.
**Fix:** Use a shared npm cache directory (`--cache /tmp/npm-cache`) or consider Docker-layer-like caching for common base deps.

### P2. `git clone` fetches full history for latest entries
**File:** `server/runner.ts:28-29`
```ts
if (opts?.isLatest) {
  execSync(`git clone ${cloneUrl} ${dir}`, { stdio: 'pipe' });
```
Full clone for `isLatest` repos (unnecessary — could use `--depth 1` and `git fetch --unshallow` when needed, or `--single-branch`).
**Fix:** Use `git clone --depth 1 --single-branch -b <branch>` for initial clone, then `git fetch` for updates.

### P3. Synchronous file system operations in request handlers
**Files:** `server/index.ts:215-233`, `server/index.ts:245-258`
`fs.readdirSync`, `fs.statSync`, `fs.readFileSync` in `/api/cache/:id/files` and `/api/cache/:id/files/*` block the event loop.
**Fix:** Use `fs.promises.readdir`, `fs.promises.stat`, `fs.promises.readFile`.

### P4. `walk()` in file explorer is unbounded
**File:** `server/index.ts:214-225`
The recursive `walk` function traverses the entire repo directory tree synchronously. A repo with thousands of files blocks the event loop.
**Fix:** Use async traversal with a depth limit and result size cap.

### P5. Polling-based SHA check every 10s for all latest entries
**File:** `server/index.ts:596-609`
Each poll hits the GitHub API for every latest entry. With 10 entries, that's 60 API calls/minute — risking rate limits (5000/hr for authenticated).
**Fix:** Use webhooks exclusively for updates; keep polling as a fallback with a longer interval (60s+).

### P6. Client polls `/api/cache` every 5s
**File:** `src/Editor.tsx:466-468`
```ts
const interval = setInterval(refreshCache, 5000);
```
Unnecessary network traffic when idle.
**Fix:** Use SSE or WebSocket for cache updates, or only poll when a loading operation is active.

---

## P6 — Tests & CI

### T1. Zero tests
No test files exist anywhere in the repo. No test framework is configured.
**Fix:** Add `vitest` (already using Vite), start with:
- Unit tests for `cache-manager.ts` (port allocation, eviction logic)
- Integration tests for `/api/run` and `/api/cache` endpoints
- Security tests for input validation (S1, S2)

### T2. No CI/CD pipeline
No `.github/workflows/` directory exists. No automated lint, type-check, or test runs.
**Fix:** Add a GitHub Actions workflow:
```yaml
on: [push, pull_request]
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm test
```

### T3. No linting configured
No ESLint, Prettier, or similar tools.
**Fix:** Add ESLint with TypeScript plugin at minimum.

---

## P7 — Documentation

### DOC1. No CLAUDE.md or contribution guide
No `CLAUDE.md`, `CONTRIBUTING.md`, or developer onboarding docs.
**Fix:** Add `CLAUDE.md` with architecture overview, local dev setup, and key conventions.

### DOC2. README is minimal
**File:** `README.md`
(Could not read — assumed minimal based on project structure.)
**Fix:** Document the architecture (server + Vite client, proxy pattern), environment variables, Docker deployment, and security model.

### DOC3. `.env.example` doesn't document which vars are required vs optional
**File:** `.env.example:1-8`
All vars are listed with no indication of which are required for basic operation.
**Fix:** Add comments like `# Required` / `# Optional — enables voice features`.

---

## P7 — Minor / Nice-to-Have

### M1. `getCommit` in `github.ts:33` doesn't validate SHA format
Could hit the GitHub API with arbitrary strings.
**Fix:** Validate SHA format before calling the API.

### M2. `express.json()` body parser has no size limit
**File:** `server/index.ts:31`
A client could send a multi-GB JSON body.
**Fix:** `app.use(express.json({ limit: '1mb' }))`.

### M3. `multer` has no file size limit for audio uploads
**File:** `server/index.ts:34`
```ts
const upload = multer({ storage: multer.memoryStorage() });
```
No `limits` option — a client could upload a multi-GB audio file and OOM the server.
**Fix:** Add `limits: { fileSize: 10 * 1024 * 1024 }` (10MB).

### M4. `JSON.parse(req.body.context)` without try/catch
**File:** `server/index.ts:323`
```ts
const context = req.body.context ? JSON.parse(req.body.context) : undefined;
```
Malformed JSON crashes the request handler.
**Fix:** Wrap in try/catch.

### M5. `consoleLogs` JSON.parse also unprotected
**File:** `server/index.ts:324`
Same issue as M4.
**Fix:** Wrap in try/catch.

### M6. Transcript history is in-memory only
**File:** `server/index.ts:282`
```ts
const transcriptHistory: TranscriptEntry[] = [];
```
Lost on server restart. The voice jobs map is similarly ephemeral.
**Fix:** Persist to a JSON file or SQLite.

### M7. `Editor.tsx` uses `any` types extensively
**File:** `src/Editor.tsx:70,76,614,637,738`
```ts
const [repos, setRepos] = useState<any[]>([]);
```
Lose type safety across the entire data flow.
**Fix:** Define proper interfaces (leveraging the shared types from C2).

### M8. `sha` endpoint fetches all entries to find one
**File:** `server/index.ts:480-485`
```ts
app.get('/api/cache/:id/sha', (req, res) => {
  const entries = listEntries();
  const entry = entries.find(...)
```
`getEntryById` already exists and is O(1).
**Fix:** Use `getEntryById(req.params.id)`.

### M9. Webhook `registerWebhook` is called on every `/api/run-latest`
**File:** `server/index.ts:183`
Even if the webhook already exists, it makes an API call to check every time.
**Fix:** Track registered webhooks in a Set to skip redundant checks.

### M10. `openSync` file descriptor leak if child exits before `closeSync`
**File:** `server/runner.ts:114,137-139`
The log file descriptor is only closed in the `exit` handler, but if the parent crashes, it leaks.
**Fix:** Close the FD in a `finally` or use `createWriteStream` instead.

---

## Summary by Priority

| Priority | Count | Key Themes |
|----------|-------|------------|
| P0 — Critical Security | 5 | Command injection, no sandboxing, secret leaks |
| P1 — High Reliability | 6 | Race conditions, resource limits, process management |
| P2 — Code Quality | 8 | Massive duplication, monolithic components |
| P3 — Docker/Hygiene | 7 | Root user, dev-mode production, no graceful shutdown |
| P4 — Dependencies | 5 | Unused packages, misplaced deps |
| P5 — Performance | 6 | No caching, sync I/O, excessive polling |
| P6 — Tests/CI | 3 | Zero tests, no CI, no linting |
| P7 — Documentation | 3 | Minimal docs |
| P7 — Minor | 10 | Input validation, type safety, minor leaks |
| **Total** | **53** | |
