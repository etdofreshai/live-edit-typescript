import { execSync, spawn } from 'child_process';
import { existsSync, rmSync, createWriteStream, readFileSync } from 'fs';
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

  const hmrEnabled = !!opts?.isLatest;

  // Start vite with --base flag; project's own vite.config is preserved
  const args = ['vite', '--port', String(port), '--host', '0.0.0.0', '--strictPort', '--base', `/proxy/${port}/`];

  // Capture stdout/stderr to a log file for debugging
  const logPath = path.join(dir, '.vite-server.log');
  const logStream = createWriteStream(logPath, { flags: 'w' });

  const child = spawn('npx', args, {
    cwd: dir,
    stdio: ['ignore', logStream, logStream],
    detached: true,
    env: { ...process.env, PORT: String(port) },
  });
  child.unref();
  child.on('exit', (code) => {
    logStream.write(`\n[process exited with code ${code}]\n`);
    logStream.end();
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
