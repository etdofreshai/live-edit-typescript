import { execFileSync, spawn } from 'child_process';
import { existsSync, rmSync, readFileSync, openSync, closeSync, writeFileSync } from 'fs';
import path from 'path';
import type { CacheEntry } from './cache-manager.js';
import { OWNER } from './github.js';
import { assertInsideTargets, safeTargetSubdir } from './path-safety.js';
import { validateBranch, validateRepo, validateSha } from './validators.js';
import { waitForPort } from './wait-for-port.js';

export function getTargetDir(repo: string, sha: string): string {
  return safeTargetSubdir(repo, sha);
}

const CHILD_ENV_ALLOWLIST = new Set([
  'PATH',
  'HOME',
  'NODE_ENV',
  'USER',
  'SHELL',
  'TERM',
  'LANG',
  'LC_ALL',
  'npm_config_cache',
  'NPM_CONFIG_CACHE',
]);

export function buildChildEnv(
  userEnv: Record<string, string> = {},
  runtime: { PORT: string; HOST?: string; BASE?: string }
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const key of CHILD_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }

  env.PORT = runtime.PORT;
  if (runtime.HOST !== undefined) env.HOST = runtime.HOST;
  if (runtime.BASE !== undefined) env.BASE = runtime.BASE;

  for (const [key, value] of Object.entries(userEnv)) {
    env[key] = value;
  }

  return env;
}

function installDependencies(dir: string, env?: Record<string, string>) {
  const hasLockfile = existsSync(path.join(dir, 'package-lock.json'));
  const args = hasLockfile
    ? ['ci', '--ignore-scripts']
    : ['install', '--ignore-scripts', '--no-audit', '--no-fund'];

  // Arbitrary preview repos must not run npm lifecycle scripts on the host by default.
  execFileSync('npm', args, {
    cwd: dir,
    stdio: 'pipe',
    timeout: 120_000,
    ...(env ? { env } : {}),
  });
}

function lastLogLines(dir: string, maxLines = 200): string {
  const log = getServerLog(dir).trim();
  if (!log) return '';
  return log.split(/\r?\n/).slice(-maxLines).join('\n');
}

async function terminateChild(child: ReturnType<typeof spawn> | undefined) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try { child.kill('SIGTERM'); } catch {}
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        try { child.kill('SIGKILL'); } catch {}
      }
      resolve();
    }, 2000);
    timer.unref();
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export async function cloneAndStart(
  repo: string,
  sha: string,
  port: number,
  opts?: {
    branch?: string;
    isLatest?: boolean;
    envVars?: Record<string, string>;
    startMode?: 'vite' | 'npm-dev';
  }
): Promise<{ dir: string; pid: number; type: 'vite' | 'static' }> {
  const safeRepo = validateRepo(repo);
  const safeSha = validateSha(sha);
  if (opts?.branch) validateBranch(opts.branch);
  const dir = safeTargetSubdir(safeRepo, safeSha);
  let createdDir = false;
  let logFd: number | undefined;
  let child: ReturnType<typeof spawn> | undefined;

  try {
    if (!existsSync(dir)) {
      const cloneUrl = `https://github.com/${OWNER}/${safeRepo}.git`;
      if (opts?.isLatest) {
        execFileSync('git', ['clone', cloneUrl, dir], { stdio: 'pipe' });
        execFileSync('git', ['checkout', safeSha], { cwd: dir, stdio: 'pipe' });
      } else {
        execFileSync('git', ['clone', '--depth', '50', cloneUrl, dir], { stdio: 'pipe' });
        execFileSync('git', ['checkout', safeSha], { cwd: dir, stdio: 'pipe' });
      }
      createdDir = true;
    }

    // Check if package.json exists — if not, this is a static repo
    if (!existsSync(path.join(dir, 'package.json'))) {
      return { dir, pid: 0, type: 'static' };
    }

    // Write .env file if env vars provided
    if (opts?.envVars && Object.keys(opts.envVars).length > 0) {
      const envContent = Object.entries(opts.envVars)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
      writeFileSync(path.join(dir, '.env'), envContent, 'utf-8');
    }

    const processEnv = buildChildEnv(opts?.envVars || {}, {
      PORT: String(port),
      HOST: '0.0.0.0',
      BASE: `/proxy/${port}/`,
    });
    const viteEnv = {
      ...processEnv,
      VITE_PORT: String(port),
      VITE_HOST: '0.0.0.0',
      VITE_BASE: `/proxy/${port}/`,
    };

    // Install deps (no lifecycle scripts; scrubbed env)
    installDependencies(dir, processEnv);

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
      installDependencies(dir, processEnv);
      if (!existsSync(viteCli)) {
        throw new Error(`Vite install incomplete — ${viteCli} still missing after retry`);
      }
    }

    const startMode = opts?.startMode || 'vite';

    // Write HMR wrapper config so Vite WebSocket connects through the proxy
    const wrapperPath = path.join(dir, '.live-edit-vite.config.ts');
    const hasExistingConfig = existsSync(path.join(dir, 'vite.config.ts')) || existsSync(path.join(dir, 'vite.config.js'));
    const wrapperContent = hasExistingConfig
      ? `// Auto-generated by Live Edit — wraps project config with HMR settings
import { defineConfig, mergeConfig } from 'vite';
import baseConfig from './vite.config';
export default mergeConfig(baseConfig, defineConfig({
  server: {
    hmr: { clientPort: 443, protocol: 'wss', path: '/proxy/${port}/' }
  }
}));
`
      : `// Auto-generated by Live Edit — HMR config for projects without vite.config
import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    hmr: { clientPort: 443, protocol: 'wss', path: '/proxy/${port}/' },
    allowedHosts: true,
  }
});
`;
    writeFileSync(wrapperPath, wrapperContent);

    // Capture stdout/stderr to a log file for debugging
    const logPath = path.join(dir, '.vite-server.log');
    logFd = openSync(logPath, 'w');

    if (startMode === 'npm-dev') {
      // Use npm run dev
      child = spawn('npm', ['run', 'dev'], {
        cwd: dir,
        stdio: ['ignore', logFd, logFd],
        detached: true,
        env: viteEnv,
      });
    } else {
      // Use npx vite with flags (default, most reliable)
      const args = ['vite', '--config', '.live-edit-vite.config.ts', '--port', String(port), '--host', '0.0.0.0', '--strictPort', '--base', `/proxy/${port}/`];
      child = spawn('npx', args, {
        cwd: dir,
        stdio: ['ignore', logFd, logFd],
        detached: true,
        env: viteEnv,
      });
    }

    child.unref();
    child.on('exit', () => {
      if (logFd !== undefined) {
        try { closeSync(logFd); } catch {}
        logFd = undefined;
      }
    });

    let rejectStartup: (error: Error) => void = () => {};
    const onStartupExit = () => rejectStartup(new Error(`dev server exited before listening — last log: ${lastLogLines(dir)}`));
    const onStartupError = () => rejectStartup(new Error(`dev server exited before listening — last log: ${lastLogLines(dir)}`));
    const childFailed = new Promise<never>((_resolve, reject) => {
      rejectStartup = reject;
      child!.once('exit', onStartupExit);
      child!.once('error', onStartupError);
    });
    try {
      await Promise.race([waitForPort('127.0.0.1', port, { timeoutMs: 30_000 }), childFailed]);
    } finally {
      child.off('exit', onStartupExit);
      child.off('error', onStartupError);
    }

    return { dir, pid: child.pid!, type: 'vite' };
  } catch (e) {
    await terminateChild(child);
    if (logFd !== undefined) {
      try { closeSync(logFd); } catch {}
    }
    if (createdDir) {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
    throw e;
  }
}

export async function pullLatest(entry: CacheEntry, newSha: string): Promise<{ changedFiles: string[] }> {
  validateRepo(entry.repo);
  validateSha(newSha);
  if (!entry.branch) return { changedFiles: [] };
  const branch = validateBranch(entry.branch);
  assertInsideTargets(entry.dir);
  const oldSha = validateSha(entry.sha);
  execFileSync('git', ['fetch', 'origin', branch], { cwd: entry.dir, stdio: 'pipe' });
  const changedFiles = execFileSync('git', ['diff', '--name-only', `${oldSha}..${newSha}`], {
    cwd: entry.dir,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).split(/\r?\n/).filter(Boolean);
  execFileSync('git', ['reset', '--hard', `origin/${branch}`], { cwd: entry.dir, stdio: 'pipe' });
  // Quick npm install in case deps changed
  try {
    const env = buildChildEnv({}, {
      PORT: String(entry.port || ''),
      HOST: '0.0.0.0',
      BASE: entry.port ? `/proxy/${entry.port}/` : undefined,
    });
    installDependencies(entry.dir, env);
  } catch {}
  return { changedFiles };
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
    assertInsideTargets(dir);
    rmSync(dir, { recursive: true, force: true });
  } catch {}
}
