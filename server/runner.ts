import { execSync, spawn } from 'child_process';
import { existsSync, rmSync } from 'fs';
import path from 'path';
import type { CacheEntry } from './cache-manager.js';
import { OWNER } from './github.js';

const TARGETS_DIR = path.resolve(process.cwd(), 'targets');

export function getTargetDir(repo: string, sha: string): string {
  return path.join(TARGETS_DIR, `${repo}-${sha.slice(0, 7)}`);
}

export async function cloneAndStart(repo: string, sha: string, port: number): Promise<{ dir: string; pid: number }> {
  const dir = getTargetDir(repo, sha);

  if (!existsSync(dir)) {
    const cloneUrl = `https://github.com/${OWNER}/${repo}.git`;
    execSync(`git clone --depth 50 ${cloneUrl} ${dir}`, { stdio: 'pipe' });
    execSync(`git checkout ${sha}`, { cwd: dir, stdio: 'pipe' });
  }

  // Install deps
  execSync('npm install', { cwd: dir, stdio: 'pipe', timeout: 120_000 });

  // Start vite dev server with base path so assets route through the proxy
  // Write a minimal override config that disables HMR (no live editing yet) and sets base path
  const { writeFileSync } = await import('fs');
  writeFileSync(path.join(dir, 'vite.config.live-edit.js'), `
import { defineConfig } from 'vite';
export default defineConfig({
  base: '/proxy/${port}/',
  server: { hmr: false, host: '0.0.0.0' },
});
`);

  const child = spawn('npx', ['vite', '--config', 'vite.config.live-edit.js', '--port', String(port), '--strictPort'], {
    cwd: dir,
    stdio: 'ignore',
    detached: true,
    env: { ...process.env, PORT: String(port) },
  });
  child.unref();

  // Wait a bit for server to start
  await new Promise(r => setTimeout(r, 3000));

  return { dir, pid: child.pid! };
}

export async function stopServer(entry: CacheEntry) {
  if (entry.pid) {
    try {
      process.kill(-entry.pid, 'SIGTERM');
    } catch {
      try { process.kill(entry.pid, 'SIGTERM'); } catch {}
    }
  }
}

export async function removeFiles(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
}
