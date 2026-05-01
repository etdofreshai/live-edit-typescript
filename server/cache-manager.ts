import { EventEmitter } from 'events';
import net from 'net';
import { stopServer, removeFiles } from './runner.js';
import { safeTargetSubdir } from './path-safety.js';

export interface CacheEntry {
  id: string;
  repo: string;
  sha: string;
  port: number;
  dir: string;
  lastAccessed: number;
  pid?: number;
  branch?: string;
  isLatest?: boolean;
  commitMessage?: string;
  commitDate?: string;
  type?: 'vite' | 'static';
}

export const events = new EventEmitter();

const MAX_ENTRIES = 10;
const PORT_MIN = 5174;
const PORT_MAX = 5273;

const cache = new Map<string, CacheEntry>();
const reservedPorts = new Set<number>();
const blockedPorts = new Set<number>();

class Mutex {
  private chain = Promise.resolve();

  async runExclusive<T>(fn: () => T | Promise<T>): Promise<T> {
    const previous = this.chain;
    let release!: () => void;
    this.chain = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

const cacheMutex = new Mutex();

function makeId(repo: string, sha: string) {
  return safeTargetSubdir(repo, sha).split(/[\\/]/).pop()!;
}

function usedPorts(): Set<number> {
  const s = new Set<number>(reservedPorts);
  for (const e of cache.values()) s.add(e.port);
  return s;
}

async function evictIfNeededLocked() {
  while (cache.size + reservedPorts.size >= MAX_ENTRIES) {
    let oldest: CacheEntry | null = null;
    for (const e of cache.values()) {
      if (!oldest || e.lastAccessed < oldest.lastAccessed) oldest = e;
    }
    if (oldest) await removeEntryLocked(oldest.id);
    else break;
  }
}

function probePort(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const srv = net.createServer();
    const timer = setTimeout(() => { srv.close(); resolve(false); }, 250);
    srv.on('error', () => { clearTimeout(timer); resolve(false); });
    srv.listen({ host: '127.0.0.1', port }, () => {
      clearTimeout(timer);
      srv.close(() => resolve(true));
    });
  });
}

export async function allocatePort(): Promise<number | null> {
  return cacheMutex.runExclusive(async () => {
    await evictIfNeededLocked();
    const used = usedPorts();
    for (let p = PORT_MIN; p <= PORT_MAX; p++) {
      if (used.has(p) || blockedPorts.has(p)) continue;
      const free = await probePort(p);
      if (free) {
        reservedPorts.add(p);
        return p;
      }
      blockedPorts.add(p);
    }
    return null;
  });
}

export async function releasePort(port: number) {
  await cacheMutex.runExclusive(() => {
    reservedPorts.delete(port);
    // Clear block so next allocate re-probes; avoids stale blocks after process exit
    blockedPorts.delete(port);
  });
}

export function getEntry(repo: string, sha: string): CacheEntry | undefined {
  const id = makeId(repo, sha);
  const e = cache.get(id);
  if (e) e.lastAccessed = Date.now();
  return e;
}

export async function addEntry(entry: CacheEntry) {
  await cacheMutex.runExclusive(async () => {
    await evictIfNeededLocked();
    reservedPorts.delete(entry.port);
    cache.set(entry.id, entry);
  });
  events.emit('change');
}

export async function evictIfNeeded() {
  const before = cache.size;
  await cacheMutex.runExclusive(evictIfNeededLocked);
  if (cache.size < before) events.emit('change');
}

async function removeEntryLocked(id: string) {
  const e = cache.get(id);
  if (!e) return false;
  await stopServer(e);
  await removeFiles(e.dir);
  cache.delete(id);
  return true;
}

export async function removeEntry(id: string) {
  const result = await cacheMutex.runExclusive(() => removeEntryLocked(id));
  if (result) events.emit('change');
  return result;
}

export function listEntries(): CacheEntry[] {
  return [...cache.values()].sort((a, b) => b.lastAccessed - a.lastAccessed);
}

export function getEntryByPort(port: number): CacheEntry | undefined {
  for (const e of cache.values()) {
    if (e.port === port) return e;
  }
  return undefined;
}

export function getEntryById(id: string): CacheEntry | undefined {
  return cache.get(id);
}

export function updateEntry(id: string, updates: Partial<CacheEntry>) {
  const e = cache.get(id);
  if (e) {
    Object.assign(e, updates);
    events.emit('change');
  }
}

export function getLatestEntries(): CacheEntry[] {
  return [...cache.values()].filter(e => e.isLatest);
}

export { makeId };
