import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  allocatePort,
  addEntry,
  getEntry,
  evictIfNeeded,
  removeEntry,
  listEntries,
  getEntryByPort,
  getEntryById,
  makeId,
} from '../server/cache-manager.js';
import type { CacheEntry } from '../server/cache-manager.js';

// Mock runner to avoid real process kills / file removals
vi.mock('../server/runner.js', () => ({
  stopServer: vi.fn().mockResolvedValue(undefined),
  removeFiles: vi.fn().mockResolvedValue(undefined),
}));

function makeEntry(overrides: Partial<CacheEntry> = {}): CacheEntry {
  const repo = overrides.repo ?? 'test-repo';
  const sha = overrides.sha ?? 'abcdef1234567890abcdef1234567890abcdef12';
  const id = overrides.id ?? makeId(repo, sha);
  return {
    id,
    repo,
    sha,
    port: overrides.port ?? 5174,
    dir: `/tmp/targets/${id}`,
    lastAccessed: Date.now(),
    ...overrides,
  };
}

describe('allocatePort', () => {
  beforeEach(() => {
    // Clear cache before each test
    const entries = listEntries();
    for (const e of entries) {
      removeEntry(e.id);
    }
  });

  it('returns first available port', () => {
    const port = allocatePort();
    expect(port).toBe(5174);
  });

  it('skips ports already in use', () => {
    addEntry(makeEntry({ port: 5174 }));
    addEntry(makeEntry({
      repo: 'other-repo',
      sha: 'bbbbbb1234567890bbbbbb1234567890bbbbbb12',
      port: 5175,
    }));
    const port = allocatePort();
    expect(port).toBe(5176);
  });

  it('returns null when all ports are used', () => {
    for (let p = 5174; p <= 5189; p++) {
      addEntry(makeEntry({
        repo: `repo-${p}`,
        sha: `${p.toString(16).padStart(7, '0')}${'a'.repeat(33)}`,
        port: p,
      }));
    }
    expect(allocatePort()).toBeNull();
  });

  it('reuses freed ports', async () => {
    // Fill all ports
    for (let p = 5174; p <= 5189; p++) {
      const sha = p.toString(16).padStart(7, '0') + 'a'.repeat(33);
      addEntry(makeEntry({
        repo: `repo-${p}`,
        sha,
        port: p,
      }));
    }
    // Free port 5177
    const sha5177 = (5177).toString(16).padStart(7, '0') + 'a'.repeat(33);
    const id5177 = makeId('repo-5177', sha5177);
    await removeEntry(id5177);
    const port = allocatePort();
    expect(port).toBe(5177);
  });
});

describe('getEntry', () => {
  beforeEach(async () => {
    const entries = listEntries();
    for (const e of entries) {
      await removeEntry(e.id);
    }
  });

  it('finds entry by repo and sha', () => {
    const entry = makeEntry({ repo: 'findme', sha: 'abcdef1234567890abcdef1234567890abcdef12' });
    addEntry(entry);
    const found = getEntry('findme', 'abcdef1234567890abcdef1234567890abcdef12');
    expect(found).toBeDefined();
    expect(found!.repo).toBe('findme');
  });

  it('returns undefined for unknown repo/sha', () => {
    expect(getEntry('unknown', '0000000000000000000000000000000000000000')).toBeUndefined();
  });

  it('updates lastAccessed on lookup', () => {
    const entry = makeEntry({ repo: 'accessed', sha: 'abcdef1234567890abcdef1234567890abcdef12' });
    entry.lastAccessed = 1000;
    addEntry(entry);
    const before = Date.now();
    const found = getEntry('accessed', 'abcdef1234567890abcdef1234567890abcdef12');
    expect(found!.lastAccessed).toBeGreaterThanOrEqual(before);
  });
});

describe('evictIfNeeded', () => {
  beforeEach(async () => {
    const entries = listEntries();
    for (const e of entries) {
      await removeEntry(e.id);
    }
  });

  it('does nothing when under MAX_ENTRIES', async () => {
    addEntry(makeEntry({ repo: 'keep' }));
    await evictIfNeeded();
    expect(getEntry('keep', 'abcdef1234567890abcdef1234567890abcdef12')).toBeDefined();
  });

  it('evicts oldest entry when at capacity', async () => {
    // Add 10 entries with decreasing lastAccessed
    for (let i = 0; i < 10; i++) {
      addEntry(makeEntry({
        repo: `repo-${i}`,
        sha: `${i.toString(16).padStart(7, '0')}${'f'.repeat(33)}`,
        lastAccessed: 1000 + i,
      }));
    }
    // Cache is full; evictIfNeeded should remove the oldest
    await evictIfNeeded();
    // The oldest (repo-0, lastAccessed=1000) should be gone
    const id0 = makeId('repo-0', '0000000' + 'f'.repeat(33));
    expect(getEntryById(id0)).toBeUndefined();
  });

  it('evicts multiple entries until under capacity', async () => {
    for (let i = 0; i < 12; i++) {
      addEntry(makeEntry({
        repo: `repo-${i}`,
        sha: `${i.toString(16).padStart(7, '0')}${'f'.repeat(33)}`,
        lastAccessed: 1000 + i,
      }));
    }
    await evictIfNeeded();
    expect(listEntries().length).toBeLessThanOrEqual(10);
  });
});

describe('addEntry', () => {
  beforeEach(async () => {
    const entries = listEntries();
    for (const e of entries) {
      await removeEntry(e.id);
    }
  });

  it('stores and retrieves entry', () => {
    const entry = makeEntry({ repo: 'add-test' });
    addEntry(entry);
    const found = getEntry('add-test', 'abcdef1234567890abcdef1234567890abcdef12');
    expect(found).toBeDefined();
  });
});

describe('getEntryByPort', () => {
  beforeEach(async () => {
    const entries = listEntries();
    for (const e of entries) {
      await removeEntry(e.id);
    }
  });

  it('finds entry by port number', () => {
    addEntry(makeEntry({ repo: 'port-test', port: 5180 }));
    expect(getEntryByPort(5180)?.repo).toBe('port-test');
  });

  it('returns undefined for unused port', () => {
    expect(getEntryByPort(9999)).toBeUndefined();
  });
});
