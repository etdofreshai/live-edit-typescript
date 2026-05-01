# Merged AFK Implementation Plan

Reconciled from `audit-codex.md` (30 items) and `audit-glm.md` (53 items).
Each chunk is a self-contained PR-sized change to be implemented on its
own worktree branch, then merged into `afk/main`.

## Wave 1 (parallel)

### chunk-1 — input validation + safe exec (codex)
Files: `server/runner.ts`, `server/index.ts`, `server/cache-manager.ts`, `server/github.ts`
- Add validators: repo `/^[A-Za-z0-9._-]+$/`, sha `/^[0-9a-f]{7,40}$/`,
  branch `/^[A-Za-z0-9._/-]+$/` (single helper module).
- Replace every `execSync(string)` in runner.ts with
  `execFileSync('git', [...])`.
- Path-resolve for cache file routes and target dirs; reject anything
  outside `TARGETS_DIR`.
- Assert `dir.startsWith(TARGETS_DIR)` before `rmSync` in `removeFiles`.
- Validate sha in `github.ts:getCommit`.

Maps to: codex#2, codex#3, codex#8, glm S1, S2, S7, M1.

### chunk-2 — DRY frontend (glm)
Files: `src/IframeWithRetry.tsx`, `src/PreviewPage.tsx`, `src/Editor.tsx`,
`src/LandingPage.tsx`, `src/types.ts` (new), `src/api.ts` (new),
`src/utils.ts` (new).
- Delete local `IframeWithRetry` in `PreviewPage.tsx`; import shared.
- Create `src/types.ts` with `CacheEntry`, `VoiceJob` shared types.
- Create `src/api.ts` with single `api` helper (returns parsed JSON,
  throws on non-2xx).
- Create `src/utils.ts` with `timeAgo`.

Maps to: codex#20, glm C1, C2, C3, C4, C5, C6.

### chunk-3 — dockerfile multistage + healthcheck + graceful shutdown (codex)
Files: `Dockerfile`, `.dockerignore` (new), `server/index.ts`,
`package.json`.
- Multi-stage Dockerfile (builder → runtime), `npm ci`, prune dev deps,
  `USER node`, build the client to `dist/`, run server compiled/tsx
  against built assets.
- Add `.dockerignore` (node_modules, targets, .env, .git, .afk-reports).
- Add `GET /api/health` returning `{ ok: true, version }`.
- Add SIGTERM handler that stops all cache child processes.
- Add `start` and `start:prod` scripts in package.json.

Maps to: codex#24, codex#25, glm D1–D7.

## Wave 2 (parallel after wave 1)

### chunk-4 — env scrubbing + webhook hardening (codex)
Files: `server/runner.ts`, `server/webhook.ts`, `server/index.ts`.
- Build minimal env for child processes (PATH, HOME, NODE_ENV, PORT,
  HOST, BASE, plus user-provided VITE_* and explicit envVars). Do not
  forward GITHUB_TOKEN / OPENAI_API_KEY / OPENCLAW_GATEWAY_TOKEN.
- Webhook: require WEBHOOK_SECRET in production (no fallback), length
  check before `timingSafeEqual`, try/catch around JSON parse.
- Don't trust `req.get('host')` for webhook URL; require `WEBHOOK_URL`.

Maps to: codex#4, codex#17, codex#18, glm S3, S4, S5.

### chunk-5 — request hygiene + bounded walk + body limits (glm)
Files: `server/index.ts`.
- `express.json({ limit: '1mb' })`.
- `multer({ storage: memoryStorage(), limits: { fileSize: 10MB,
  files: 4, fields: 20 } })`.
- Wrap `JSON.parse(req.body.context|consoleLogs)` in try/catch.
- Replace recursive sync `walk` with async-iterator walker, depth limit
  (10), file-count cap (5000), skip symlinks, skip common build dirs,
  return truncation flag.
- Replace `fs.readdirSync/statSync/readFileSync` in cache file routes
  with `fs.promises` equivalents.

Maps to: codex#9, codex#16, glm M2, M3, M4, M5, P3, P4.

### chunk-6 — dependency cleanup + ignore-scripts + audit fix (codex)
Files: `package.json`, `package-lock.json`, `server/runner.ts`.
- Remove `form-data`, `@types/form-data`, `@types/react-router-dom`.
- Move `html2canvas` to devDependencies.
- `npm audit fix` for multer / path-to-regexp / follow-redirects.
- Use `npm ci --ignore-scripts` (with `npm install --ignore-scripts`
  fallback when no lockfile) in `server/runner.ts`.

Maps to: codex#6, codex#22, codex#23, glm DEP1, DEP3, DEP4.

## Wave 3 (parallel after wave 2)

### chunk-7 — startup readiness + concurrent dedup + eviction lock (codex)
Files: `server/runner.ts`, `server/index.ts`, `server/cache-manager.ts`.
- Wait for the spawned port to actually accept TCP connections (with
  timeout, max 30s) instead of `sleep(3)`. Subscribe to child
  `exit`/`error` during startup; surface last log lines.
- In-flight promise map keyed by `${repo}:${sha||branch}` so duplicate
  `/api/run` requests await the same startup.
- Mutex around `evictIfNeeded` + `addEntry` so concurrent runs can't
  exceed `MAX_ENTRIES`.
- Cleanup partial dirs/processes in finally on failure.
- Restart dev server on `pullLatest` if package.json/vite.config/lockfile
  changed or process is dead.

Maps to: codex#10, codex#11, codex#12, codex#14, glm S6, S10, S11.

### chunk-8 — vitest + CI workflow + lint (glm)
Files: `vitest.config.ts` (new), `tests/` (new), `.github/workflows/ci.yml`
(new), `.eslintrc.json` (new), `package.json`.
- Add vitest config and unit tests for: validators, path-safety helper,
  webhook signature verification, env-scrub helper, cache-manager
  port allocation + eviction.
- GitHub Actions workflow: install, typecheck (tsc --noEmit), test,
  npm audit --omit=dev (warn-only), docker build dry-run.
- Minimal ESLint config + `lint` script.

Maps to: codex#26, codex#27, glm T1, T2, T3.

### chunk-9 — Editor.tsx split (codex)
Files: `src/Editor.tsx`, `src/components/*` (new).
- Extract: `RepoSelector`, `BranchList`, `CommitList`, `EnvModal`,
  `LogModal`, `CachePanel`, `StaticFileBrowser`, `TopBar`.
- Replace `any` repo state with typed interfaces.

Maps to: codex#21, codex#28, glm C7, C8, M7.

## Out of scope for this AFK run (track for follow-up)

- Full sandbox/firejail/nsjail wrapper (codex#1, glm S4): too large for
  one chunk; document threat model + ship `--ignore-scripts` + env
  scrub + non-root container as the first defense layer.
- Auth on privileged routes (codex#7): needs product decision.
- Move user envs out of localStorage (codex#30): needs product decision.
- Webhook-driven updates replacing polling (glm P5): broader change.
- SSE/WebSocket for cache updates (glm P6): broader change.
