import { stopServer, removeFiles } from './runner.js';
import { safeTargetSubdir } from './path-safety.js';

export interface CacheEntry {
  id: string;
  owner: string;
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

const MAX_ENTRIES = 10;
const PORT_MIN = 5174;
const PORT_MAX = 5189;

const cache = new Map<string, CacheEntry>();
const reservedPorts = new Set<number>();

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

function makeId(owner: string, repo: string, sha: string) {
  return safeTargetSubdir(owner, repo, sha).split(/[\\/]/).pop()!;
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

export async function allocatePort(): Promise<number | null> {
  return cacheMutex.runExclusive(async () => {
    await evictIfNeededLocked();
    const used = usedPorts();
    for (let p = PORT_MIN; p <= PORT_MAX; p++) {
      if (!used.has(p)) {
        reservedPorts.add(p);
        return p;
      }
    }
    return null;
  });
}

export async function releasePort(port: number) {
  await cacheMutex.runExclusive(() => {
    reservedPorts.delete(port);
  });
}

export function getEntry(owner: string, repo: string, sha: string): CacheEntry | undefined {
  const id = makeId(owner, repo, sha);
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
}

export async function evictIfNeeded() {
  await cacheMutex.runExclusive(evictIfNeededLocked);
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
  return cacheMutex.runExclusive(() => removeEntryLocked(id));
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
  if (e) Object.assign(e, updates);
}

export function getLatestEntries(): CacheEntry[] {
  return [...cache.values()].filter(e => e.isLatest);
}

export { makeId };
