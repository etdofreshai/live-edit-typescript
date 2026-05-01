# Live Edit TypeScript

A web app for browsing, running, and previewing Vite + TypeScript GitHub repos with live reloading.

Browse repos → pick a branch → select a commit (or track latest) → preview it live in the browser.

**Deployed at:** `liveedittypescript.etdofresh.com`  
**Repo:** `etdofreshai/live-edit-typescript`

---

## Creating a Compatible Project

This is the authoritative guide for creating Vite + TypeScript projects that work with Live Edit. Follow this exactly.

### Minimum Viable Project

```bash
npm create vite@latest my-project -- --template react-ts
cd my-project
```

### Required: `vite.config.ts`

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: true,  // REQUIRED — without this, Vite rejects proxied requests from custom domains
  },
})
```

**`allowedHosts: true` is mandatory.** Without it, Vite returns a 403 for all requests coming through the Live Edit proxy.

### Required: `index.html` at root

Vite uses `index.html` as the entry point. It must be at the project root (not in `src/` or `public/`).

### Required: `vite` in dependencies

Live Edit checks `package.json` for `vite` in `dependencies` or `devDependencies`. If missing, the repo is treated as static (file browser only, no dev server).

**Put `vite` in `dependencies` (not just `devDependencies`)** if you want it to reliably install in all environments.

### That's it for basic projects

Any project meeting these 3 requirements works automatically. Live Edit runs:

```bash
npm install
npx vite --host 0.0.0.0 --port {assigned} --strictPort --base /proxy/{port}/
```

---

## Key Concepts & Gotchas

### The `--base` flag

Live Edit serves your app through `/proxy/{port}/` on the main domain. It passes `--base /proxy/{port}/` to Vite so all asset URLs include this prefix. **You don't need to set `base` in your config** — the CLI flag handles it.

However, this means:

- **API calls must use `import.meta.env.BASE_URL`** as the prefix, not hardcoded `/api/...`
  ```ts
  // ❌ WRONG — goes to Live Edit's server, not your app
  fetch('/api/stats')
  
  // ✅ CORRECT — routes through the proxy to your app
  fetch(`${import.meta.env.BASE_URL}api/stats`)
  // When running standalone, BASE_URL = "/"
  // When through Live Edit, BASE_URL = "/proxy/{port}/"
  ```

- **Vite's proxy config still works** — Vite strips the base before matching proxy rules, so `/api` proxy rules work correctly.

### Port Configuration

- **Don't hardcode `port` in `vite.config.ts`** for the Vite dev server. Live Edit assigns ports dynamically (5174-5273, 100-slot pool) via `--port` CLI flag. If you hardcode a port, it may conflict.
- If your project has a backend server, use a separate `BACKEND_PORT` env var (not `PORT`, which could conflict with Vite).

### Full-Stack Projects (Frontend + Backend)

For projects with both a Vite frontend and an Express/Node backend:

1. **Auto-start the backend via a Vite plugin** (recommended):

```ts
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn } from 'child_process'

function autoBackend(): Plugin {
  let proc: ReturnType<typeof spawn> | null = null
  const backendPort = process.env.BACKEND_PORT || '3001'
  return {
    name: 'auto-backend',
    configureServer() {
      console.log(`[auto-backend] Starting Express on port ${backendPort}...`)
      proc = spawn('npx', ['tsx', 'src/server.ts'], {
        stdio: 'inherit',
        env: { ...process.env, BACKEND_PORT: backendPort, PORT: backendPort },
        shell: true,
      })
      proc.on('error', (err) => console.error('[auto-backend] Failed:', err))
      proc.on('exit', (code) => console.log(`[auto-backend] Exited code ${code}`))
    },
    buildEnd() {
      if (proc) { proc.kill(); proc = null }
    },
  }
}

const backendPort = process.env.BACKEND_PORT || '3001'

export default defineConfig({
  plugins: [react(), autoBackend()],
  server: {
    allowedHosts: true,
    proxy: {
      '/api': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
      },
      // Also handle requests coming through the Live Edit base path
      '^/proxy/\\d+/api': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/proxy\/\d+/, ''),
      },
    },
  },
})
```

2. **Backend must use `BACKEND_PORT` env var** (not `PORT`):
```ts
const PORT = parseInt(process.env.BACKEND_PORT || process.env.PORT || '3001')
```

3. **This way "Vite" mode in Live Edit works** — no need to switch to "npm run dev" mode. The Vite plugin handles everything.

### Environment Variables

Live Edit has a per-repo `.env` editor (⚙️ button in the top bar). Variables are:
- Written as a `.env` file in the target directory before `npm install`
- Passed as `process.env` to the spawned dev server

For projects needing secrets (DB credentials, API keys), users set them once per repo and they persist in localStorage.

Your project should use `dotenv` or Vite's built-in env loading. For backend code, call `dotenv.config()`. For frontend code, prefix vars with `VITE_` and access via `import.meta.env.VITE_*`.

### Non-Vite Projects

- **Has `package.json` but no `vite` dep** → static file browser
- **No `package.json`** → static file browser

### Start Mode Toggle

Live Edit offers two modes:
- **Vite** (default): `npx vite --port --host --base` — most reliable for Vite projects
- **npm run dev**: runs `npm run dev` with `PORT`, `HOST`, `BASE` env vars — for custom dev scripts

For most projects, Vite mode is correct. Use "npm run dev" only if your dev script does something special that the auto-backend plugin can't handle.

---

## Project Structure Recommendations

```
my-project/
├── index.html              # Vite entry point (MUST be at root)
├── package.json            # Must include vite in deps
├── vite.config.ts          # Must include allowedHosts: true
├── tsconfig.json
├── src/
│   ├── main.tsx            # React entry
│   ├── App.tsx
│   ├── styles.css
│   └── client/             # (if full-stack) frontend components
│       └── components/
├── server/                 # (if full-stack) backend code
│   ├── index.ts
│   └── ...
└── .env.example            # Document required env vars
```

### Recommended `package.json` scripts

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  }
}
```

For full-stack:
```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev:backend\" \"npm run dev:frontend\"",
    "dev:backend": "tsx watch src/server.ts",
    "dev:frontend": "vite",
    "build": "tsc && vite build"
  }
}
```

---

## Checklist for New Projects

- [ ] `index.html` at project root
- [ ] `vite` in `dependencies` (not just devDependencies)
- [ ] `vite.config.ts` with `server.allowedHosts: true`
- [ ] **No hardcoded port** in vite.config server settings
- [ ] API calls use `import.meta.env.BASE_URL` prefix (not absolute `/api/...`)
- [ ] If full-stack: auto-backend Vite plugin + `BACKEND_PORT` env var
- [ ] If full-stack: proxy rules for both `/api` and `^/proxy/\\d+/api`
- [ ] `.env.example` documenting required environment variables
- [ ] Dark theme recommended (Catppuccin palette: `#1e1e2e`, `#cdd6f4`, `#89b4fa`, `#a6e3a1`)

---

## Deploying to Live Edit

1. Push your repo to `etdofreshai` GitHub account
2. Open `liveedittypescript.etdofresh.com`
3. Select repo → branch → click ▶ Run (or ▶ Latest to track HEAD)
4. Set env vars via ⚙️ if needed
5. Preview loads in the embedded iframe

### Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| 403 on iframe | Missing `allowedHosts` | Add `server.allowedHosts: true` to vite.config |
| `/api/...` returns 404 or HTML | Absolute API paths | Use `import.meta.env.BASE_URL` prefix |
| Port conflict error | Hardcoded port in config | Remove `port` from vite.config, let CLI flag set it |
| "Vite install incomplete" | Not a Vite project | Ensure `vite` is in package.json dependencies |
| Backend not starting | Using Vite mode without auto-backend plugin | Add the auto-backend Vite plugin, or switch to "npm run dev" mode |
| Env vars not loaded | No `.env` file | Set vars via ⚙️ Env editor in top bar |

---

## Architecture (Live Edit internals)

- **Frontend:** Vite + React + TypeScript (port 5173)
- **Backend:** Express (port 3000) — API + proxy
- **Target servers:** Ports 5174-5273 (100-slot pool), LRU cache
- **Proxy:** `http-proxy` — routes `/proxy/{port}/` to target Vite servers
- **Webhooks:** Auto-registered on GitHub for "latest" tracking, 30s poll fallback
- **Shared npm cache:** `LIVE_EDIT_NPM_CACHE` or the OS tmp dir caches npm registry metadata and tarballs only; each repo still installs into its own `node_modules` for lockfile isolation
- **localStorage:** Persists repo/branch/preview state + env vars per repo

### Security Model

Live Edit clones and runs code from GitHub repos. Preview code should be treated as **untrusted** — it executes on the host as child processes.

**Current mitigations:**

- **Optional admin token** — set `ADMIN_TOKEN` to require a bearer token on privileged routes (run, branch/PR creation, cache deletion, logs, transcripts, uploads). Unset = open access, backwards-compatible.
- **Input validation** — owner, repo, branch, and SHA are validated with strict regexes before use
- **`execFileSync`** — all git/npm operations use synchronous exec (no shell injection vectors)
- **`--ignore-scripts`** — npm install skips `preinstall`/`postinstall` lifecycle scripts
- **Env allowlist** — child processes only inherit a minimal set of host env vars (`PATH`, `HOME`, `NODE_ENV`, etc.); user-provided env vars are added on top
- **Safe path handling** — all target directories are resolved and verified to stay inside the `targets/` root
- **Bounded file walking** — directory tree listing caps depth at 10 levels to prevent runaway traversal
- **Webhook secret verification** — HMAC-SHA256 signature validation on all incoming webhook payloads
- **Docker/non-root runtime** — the provided Dockerfile runs as root; for production, add a non-root `USER` directive

**Recommended hardening (not yet implemented):**

- Per-preview containers or sandboxing (e.g., gVisor, nsjail)
- CPU, memory, and PID quotas per preview process
- Network egress policy to restrict outbound access from preview servers

### Production Deployment

**Required environment variables:**

| Variable | Purpose |
|----------|---------|
| `GITHUB_TOKEN` | Personal access token for cloning repos and registering webhooks. Needs `repo` read scope. |
| `WEBHOOK_SECRET` | HMAC secret for verifying incoming GitHub webhook payloads. Required when webhooks are enabled. |
| `WEBHOOK_URL` | Public URL where GitHub should send webhook events. Required for auto-registering hooks. |

**Optional:**

- `LIVE_EDIT_NPM_CACHE` — override the shared npm cache directory (defaults to a temp dir)
- `ADMIN_TOKEN` — when set, privileged routes require a matching token via `Authorization: Bearer <token>` or `x-admin-token: <token>` header. When unset, all routes are open (no change from previous behavior). This is a lightweight first guardrail, not a full user authentication system. Protected operations include run/run-latest, branch and PR creation, cache deletion, log and file reads, transcript history, and voice/upload routes.

**Browser usage:** The server accepts the token as either `Authorization: Bearer <ADMIN_TOKEN>` or `x-admin-token: <ADMIN_TOKEN>`. A companion UI prompt is planned — once implemented, the browser will store the token in session storage and send it automatically on privileged requests. Until then, use `curl` with one of the header options above.

**Token hygiene:**
- Do **not** reuse a GitHub personal-access token or any production secret as the admin token.
- Treat it as a shared admin secret — rotate it on a regular schedule and whenever it may have leaked.

**GitHub token scope:** The token needs read access to repositories in the target org/account. If auto-registering webhooks, it also needs `write:repo_hook` scope.

**Webhook behavior when secrets are missing:**

- No `WEBHOOK_SECRET` in production → webhook endpoint returns 503
- No `WEBHOOK_SECRET` in development → falls back to an insecure dev placeholder
- No `GITHUB_TOKEN` or `WEBHOOK_URL` → webhook registration is skipped (30s polling fallback)

### Port Pool and Caching

- **Preview port pool:** 5174-5273 (100 slots, dynamically assigned)
- **Shared npm cache:** stores registry metadata and tarballs at `LIVE_EDIT_NPM_CACHE` or the OS temp dir. Each target repo still gets its own `node_modules` for lockfile isolation.

### Env Var Editor

The per-repo env editor (⚙️ button) stores values in **browser localStorage**. This is convenient for development but is not appropriate for highly sensitive secrets — any script running in the same origin can read localStorage.

For real secrets (database credentials, API keys), prefer passing non-secret public config through the editor and using a server-side secret store for sensitive values. A future server-side secrets manager is planned.

### Docker

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
CMD ["npm", "run", "dev"]
```

No `EXPOSE` needed if your hosting platform handles port forwarding (e.g., Dokploy → port 5173).
