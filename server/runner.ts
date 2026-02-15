import { execSync, spawn } from 'child_process';
import { existsSync, rmSync, readFileSync, openSync, closeSync } from 'fs';
import path from 'path';
import type { CacheEntry } from './cache-manager.js';
import { OWNER } from './github.js';

const TARGETS_DIR = path.resolve(process.cwd(), 'targets');

export function getTargetDir(repo: string, sha: string): string {
  return path.join(TARGETS_DIR, `${repo}-${sha.slice(0, 7)}`);
}

export async function cloneAndStart(repo: string, sha: string, port: number, opts?: { branch?: string; isLatest?: boolean }): Promise<{ dir: string; pid: number; type: 'vite' | 'static' }> {
  const dir = getTargetDir(repo, sha);

  if (!existsSync(dir)) {
    const cloneUrl = `https://github.com/${OWNER}/${repo}.git`;
    if (opts?.isLatest) {
      execSync(`git clone ${cloneUrl} ${dir}`, { stdio: 'pipe' });
      execSync(`git checkout ${sha}`, { cwd: dir, stdio: 'pipe' });
    } else {
      execSync(`git clone --depth 50 ${cloneUrl} ${dir}`, { stdio: 'pipe' });
      execSync(`git checkout ${sha}`, { cwd: dir, stdio: 'pipe' });
    }
  }

  // Check if package.json exists — if not, this is a static repo
  if (!existsSync(path.join(dir, 'package.json'))) {
    return { dir, pid: 0, type: 'static' };
  }

  // Install deps
  execSync('npm install', { cwd: dir, stdio: 'pipe', timeout: 120_000 });

  // Check if this project actually uses Vite
  const pkgJson = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf-8'));
  const allDeps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
  if (!allDeps['vite']) {
    // Not a Vite project — treat as static
    return { dir, pid: 0, type: 'static' };
  }

  // Verify vite is actually usable (npm install can silently produce incomplete installs)
  const viteCli = path.join(dir, 'node_modules', 'vite', 'dist', 'node', 'cli.js');
  if (!existsSync(viteCli)) {
    // Nuke node_modules and retry once
    console.warn(`[runner] Vite dist missing in ${dir}, retrying install...`);
    rmSync(path.join(dir, 'node_modules'), { recursive: true, force: true });
    execSync('npm install', { cwd: dir, stdio: 'pipe', timeout: 120_000 });
    if (!existsSync(viteCli)) {
      throw new Error(`Vite install incomplete — ${viteCli} still missing after retry`);
    }
  }

  const hmrEnabled = !!opts?.isLatest;

  // Start vite with --base flag; project's own vite.config is preserved
  const args = ['vite', '--port', String(port), '--host', '0.0.0.0', '--strictPort', '--base', `/proxy/${port}/`];

  // Capture stdout/stderr to a log file for debugging
  const logPath = path.join(dir, '.vite-server.log');
  const logFd = openSync(logPath, 'w');

  const child = spawn('npx', args, {
    cwd: dir,
    stdio: ['ignore', logFd, logFd],
    detached: true,
    env: { ...process.env, PORT: String(port) },
  });
  child.unref();
  child.on('exit', () => {
    try { closeSync(logFd); } catch {}
  });

  await new Promise(r => setTimeout(r, 3000));

  return { dir, pid: child.pid!, type: 'vite' };
}

export async function pullLatest(entry: CacheEntry, newSha: string) {
  if (!entry.branch) return;
  execSync(`git fetch origin ${entry.branch}`, { cwd: entry.dir, stdio: 'pipe' });
  execSync(`git reset --hard origin/${entry.branch}`, { cwd: entry.dir, stdio: 'pipe' });
  // Quick npm install in case deps changed
  try {
    execSync('npm install', { cwd: entry.dir, stdio: 'pipe', timeout: 60_000 });
  } catch {}
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

export function getServerLog(dir: string): string {
  const logPath = path.join(dir, '.vite-server.log');
  try {
    return readFileSync(logPath, 'utf-8');
  } catch {
    return '';
  }
}

export async function removeFiles(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
}
