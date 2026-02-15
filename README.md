# Live Edit TypeScript

A web app for browsing, running, and previewing Vite + TypeScript GitHub repos with live reloading.

Browse repos → pick a branch → select a commit (or track latest) → preview it live in the browser.

## How It Works

1. **Browse** your GitHub repos, branches, and commits
2. **Run** any commit — it clones the repo, installs deps, and starts a Vite dev server
3. **Preview** the running site in an embedded iframe
4. **Track Latest** — follow a branch HEAD, auto-pull on new commits (via webhooks + polling)

Non-Vite repos get a file explorer fallback (browse source files in-browser).

## Making Your Repo Compatible

Any Vite project works out of the box. The system runs:

```bash
npm install
npx vite --host 0.0.0.0 --port {port} --strictPort --base /proxy/{port}/
```

### Requirements

- **`package.json`** with `vite` in `dependencies` or `devDependencies`
- **`index.html`** at the project root (Vite's entry point)

### Recommended `vite.config.ts`

```ts
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    allowedHosts: true,  // Required for proxied access via custom domains
  },
})
```

The `--base` flag is passed via CLI, so you don't need to set it in your config. Your project's own `vite.config.ts` is preserved — plugins, defines, aliases all work normally.

### What If My Repo Isn't a Vite Project?

- **Has `package.json` but no `vite` dep** → treated as static, opens file explorer
- **No `package.json` at all** → treated as static, opens file explorer

The file explorer lets you browse the repo's source tree and view text files.

## Stack

- **Frontend:** Vite + React + TypeScript
- **Backend:** Express + TypeScript (tsx)
- **Runtime:** Node 22

## Setup

```bash
cp .env.example .env
# Edit .env with your GITHUB_TOKEN

npm install
npm run dev
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | Yes | GitHub personal access token (repo read access) |
| `GITHUB_OWNER` | No | GitHub user/org to browse (default: from token) |
| `WEBHOOK_URL` | No | Public URL for GitHub webhook delivery |
| `WEBHOOK_SECRET` | No | Secret for verifying webhook payloads |

## Architecture

- **10-slot LRU cache** — each running commit gets a dedicated Vite dev server on ports 5174-5189
- **Proxy** — all target sites served through `/proxy/{port}/` using `http-proxy`
- **Webhooks** — auto-registered on GitHub when tracking "latest", with 30s poll fallback
- **localStorage** — persists your repo/branch/preview state across page refreshes

## Docker

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
CMD ["npm", "run", "dev"]
```

No `EXPOSE` needed if your hosting platform handles port forwarding (e.g., Dokploy → port 5173).
