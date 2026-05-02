import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  allocatePort,
  releasePort,
  addEntry,
  getEntry,
  evictIfNeeded,
  removeEntry,
  listEntries,
  getEntryByPort,
  getEntryById,
  makeId,
  updateEntry,
  events,
} from '../server/cache-manager.js';
import type { CacheEntry } from '../server/cache-manager.js';

vi.mock('../server/runner.js', () => ({
  stopServer: vi.fn().mockResolvedValue(undefined),
  removeFiles: vi.fn().mockResolvedValue(undefined),
}));

function makeEntry(overrides: Partial<CacheEntry> = {}): CacheEntry {
  const owner = overrides.owner ?? 'octocat';
  const repo = overrides.repo ?? 'test-repo';
  const sha = overrides.sha ?? 'abcdef1234567890abcdef1234567890abcdef12';
  const id = overrides.id ?? makeId(owner, repo, sha);
  return {
    id,
    owner,
    repo,
    sha,
    port: overrides.port ?? 5174,
    dir: `/tmp/targets/${id}`,
    lastAccessed: Date.now(),
    ...overrides,
  };
}

async function clearCache() {
  for (const e of listEntries()) {
    await removeEntry(e.id);
  }
  // Also free any reserved ports left over from a previous test
  for (let p = 5174; p <= 5273; p++) {
    await releasePort(p);
  }
}

describe('allocatePort', () => {
  beforeEach(async () => { await clearCache(); });

  it('returns first available port', async () => {
    const port = await allocatePort();
    expect(port).toBe(5174);
    await releasePort(port!);
  });

  it('skips ports already in use', async () => {
    await addEntry(makeEntry({ port: 5174 }));
    await addEntry(makeEntry({
      repo: 'other-repo',
      sha: 'bbbbbb1234567890bbbbbb1234567890bbbbbb12',
      port: 5175,
    }));
    const port = await allocatePort();
    expect(port).toBe(5176);
  });

  it('returns null when all ports are used (via reservations)', async () => {
    const reserved: number[] = [];
    for (let p = 5174; p <= 5273; p++) {
      const allocated = await allocatePort();
      if (allocated !== null) reserved.push(allocated);
    }
    expect(reserved.length).toBe(100);
    expect(await allocatePort()).toBeNull();
    for (const p of reserved) await releasePort(p);
  });

  it('reuses freed ports', async () => {
    const a = await allocatePort();
    const b = await allocatePort();
    const c = await allocatePort();
    expect([a, b, c]).toEqual([5174, 5175, 5176]);
    await releasePort(b!);
    const reused = await allocatePort();
    expect(reused).toBe(5175);
    await releasePort(a!);
    await releasePort(c!);
    await releasePort(reused!);
  });

  it('skips OS-blocked port and returns the next free one', async () => {
    // Bind to port 5174 externally so the OS-level probe finds it busy
    const net = await import('net');
    const blocker = net.createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.on('error', reject);
      blocker.listen({ host: '127.0.0.1', port: 5174 }, () => resolve());
    });

    try {
      const port = await allocatePort();
      expect(port).not.toBe(5174);
      expect(port).toBeGreaterThanOrEqual(5175);
      if (port !== null) await releasePort(port);
    } finally {
      await new Promise<void>(resolve => blocker.close(() => resolve()));
    }
  });
});

describe('getEntry', () => {
  beforeEach(async () => { await clearCache(); });

  it('finds entry by repo and sha', async () => {
    const entry = makeEntry({ repo: 'findme', sha: 'abcdef1234567890abcdef1234567890abcdef12' });
    await addEntry(entry);
    const found = getEntry('octocat', 'findme', 'abcdef1234567890abcdef1234567890abcdef12');
    expect(found).toBeDefined();
    expect(found!.repo).toBe('findme');
  });

  it('returns undefined for unknown repo/sha', () => {
    expect(getEntry('octocat', 'unknown', '0000000000000000000000000000000000000000')).toBeUndefined();
  });

  it('distinguishes identical repo and sha under different owners', async () => {
    const sha = 'abcdef1234567890abcdef1234567890abcdef12';
    await addEntry(makeEntry({ owner: 'owner-a', repo: 'same-repo', sha, port: 5174 }));
    await addEntry(makeEntry({ owner: 'owner-b', repo: 'same-repo', sha, port: 5175 }));

    expect(getEntry('owner-a', 'same-repo', sha)?.owner).toBe('owner-a');
    expect(getEntry('owner-b', 'same-repo', sha)?.owner).toBe('owner-b');
  });

  it('updates lastAccessed on lookup', async () => {
    const entry = makeEntry({ repo: 'accessed', sha: 'abcdef1234567890abcdef1234567890abcdef12' });
    entry.lastAccessed = 1000;
    await addEntry(entry);
    const before = Date.now();
    const found = getEntry('octocat', 'accessed', 'abcdef1234567890abcdef1234567890abcdef12');
    expect(found!.lastAccessed).toBeGreaterThanOrEqual(before);
  });
});

describe('evictIfNeeded', () => {
  beforeEach(async () => { await clearCache(); });

  it('does nothing when under MAX_ENTRIES', async () => {
    await addEntry(makeEntry({ repo: 'keep' }));
    await evictIfNeeded();
    expect(getEntry('octocat', 'keep', 'abcdef1234567890abcdef1234567890abcdef12')).toBeDefined();
  });

  it('evicts oldest entry when at capacity', async () => {
    for (let i = 0; i < 10; i++) {
      await addEntry(makeEntry({
        repo: `repo-${i}`,
        sha: `${i.toString(16).padStart(7, '0')}${'f'.repeat(33)}`,
        lastAccessed: 1000 + i,
        port: 5174 + i,
      }));
    }
    await evictIfNeeded();
    const id0 = makeId('octocat', 'repo-0', '0000000' + 'f'.repeat(33));
    expect(getEntryById(id0)).toBeUndefined();
  });

  it('evicts multiple entries until under capacity', async () => {
    for (let i = 0; i < 10; i++) {
      await addEntry(makeEntry({
        repo: `repo-${i}`,
        sha: `${i.toString(16).padStart(7, '0')}${'f'.repeat(33)}`,
        lastAccessed: 1000 + i,
        port: 5174 + i,
      }));
    }
    await evictIfNeeded();
    expect(listEntries().length).toBeLessThanOrEqual(10);
  });
});

describe('addEntry', () => {
  beforeEach(async () => { await clearCache(); });

  it('stores and retrieves entry', async () => {
    const entry = makeEntry({ repo: 'add-test' });
    await addEntry(entry);
    const found = getEntry('octocat', 'add-test', 'abcdef1234567890abcdef1234567890abcdef12');
    expect(found).toBeDefined();
  });
});

describe('getEntryByPort', () => {
  beforeEach(async () => { await clearCache(); });

  it('finds entry by port number', async () => {
    await addEntry(makeEntry({ repo: 'port-test', port: 5180 }));
    expect(getEntryByPort(5180)?.repo).toBe('port-test');
  });

  it('returns undefined for unused port', () => {
    expect(getEntryByPort(9999)).toBeUndefined();
  });
});

describe('SSE events emitter', () => {
  beforeEach(async () => { await clearCache(); });

  it('fires change on addEntry', async () => {
    const handler = vi.fn();
    events.on('change', handler);
    await addEntry(makeEntry({ repo: 'sse-add' }));
    expect(handler).toHaveBeenCalledTimes(1);
    events.off('change', handler);
  });

  it('fires change on removeEntry', async () => {
    await addEntry(makeEntry({ repo: 'sse-remove' }));
    const handler = vi.fn();
    events.on('change', handler);
    await removeEntry(makeId('octocat', 'sse-remove', 'abcdef1234567890abcdef1234567890abcdef12'));
    expect(handler).toHaveBeenCalledTimes(1);
    events.off('change', handler);
  });

  it('fires change on updateEntry', async () => {
    await addEntry(makeEntry({ repo: 'sse-update' }));
    const handler = vi.fn();
    events.on('change', handler);
    updateEntry(makeId('octocat', 'sse-update', 'abcdef1234567890abcdef1234567890abcdef12'), { sha: 'updated' });
    expect(handler).toHaveBeenCalledTimes(1);
    events.off('change', handler);
  });

  it('does not fire change on updateEntry for non-existent id', async () => {
    const handler = vi.fn();
    events.on('change', handler);
    updateEntry('nonexistent-id', { sha: 'noop' });
    expect(handler).not.toHaveBeenCalled();
    events.off('change', handler);
  });
});
