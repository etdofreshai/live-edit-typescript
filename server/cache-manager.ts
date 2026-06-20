import { stopServer, removeFiles } from './runner.js';

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

function makeId(owner: string, repo: string, sha: string) {
  return `${owner}-${repo}-${sha.slice(0, 7)}`;
}

function usedPorts(): Set<number> {
  const s = new Set<number>();
  for (const e of cache.values()) s.add(e.port);
  return s;
}

export function allocatePort(): number | null {
  const used = usedPorts();
  for (let p = PORT_MIN; p <= PORT_MAX; p++) {
    if (!used.has(p)) return p;
  }
  return null;
}

export function getEntry(owner: string, repo: string, sha: string): CacheEntry | undefined {
  const id = makeId(owner, repo, sha);
  const e = cache.get(id);
  if (e) e.lastAccessed = Date.now();
  return e;
}

export function addEntry(entry: CacheEntry) {
  cache.set(entry.id, entry);
}

export async function evictIfNeeded() {
  while (cache.size >= MAX_ENTRIES) {
    let oldest: CacheEntry | null = null;
    for (const e of cache.values()) {
      if (!oldest || e.lastAccessed < oldest.lastAccessed) oldest = e;
    }
    if (oldest) await removeEntry(oldest.id);
  }
}

export async function removeEntry(id: string) {
  const e = cache.get(id);
  if (!e) return false;
  await stopServer(e);
  await removeFiles(e.dir);
  cache.delete(id);
  return true;
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
