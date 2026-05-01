import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { GIT_TIMEOUTS_MS, buildCloneArgs, getGitTimeoutMs, getSharedNpmCache } from '../server/runner.js';

describe('buildCloneArgs', () => {
  it('uses a shallow single-branch clone for latest branch entries', () => {
    const args = buildCloneArgs('https://github.com/owner/repo.git', '/tmp/repo', {
      isLatest: true,
      branch: 'feature/perf',
    });

    expect(args).toEqual([
      'clone',
      '--depth',
      '50',
      '--single-branch',
      '-b',
      'feature/perf',
      'https://github.com/owner/repo.git',
      '/tmp/repo',
    ]);
  });

  it('uses a shallow clone for specific commits', () => {
    const args = buildCloneArgs('https://github.com/owner/repo.git', '/tmp/repo');

    expect(args).toEqual([
      'clone',
      '--depth',
      '50',
      'https://github.com/owner/repo.git',
      '/tmp/repo',
    ]);
  });
});

describe('getGitTimeoutMs', () => {
  it('uses longer timeouts for network git operations', () => {
    expect(getGitTimeoutMs(['clone', '--depth', '50', 'https://github.com/owner/repo.git', '/tmp/repo']))
      .toBe(GIT_TIMEOUTS_MS.cloneFetch);
    expect(getGitTimeoutMs(['fetch', '--depth', '50', 'origin', 'main']))
      .toBe(GIT_TIMEOUTS_MS.cloneFetch);
  });

  it('uses shorter timeouts for local git operations', () => {
    expect(getGitTimeoutMs(['checkout', 'abc123'])).toBe(GIT_TIMEOUTS_MS.local);
    expect(getGitTimeoutMs(['reset', '--hard', 'origin/main'])).toBe(GIT_TIMEOUTS_MS.local);
    expect(getGitTimeoutMs(['diff', '--name-only', 'old..new'])).toBe(GIT_TIMEOUTS_MS.local);
  });
});

describe('getSharedNpmCache', () => {
  const originalCache = process.env.LIVE_EDIT_NPM_CACHE;
  const tempRoots: string[] = [];

  afterEach(() => {
    if (originalCache === undefined) {
      delete process.env.LIVE_EDIT_NPM_CACHE;
    } else {
      process.env.LIVE_EDIT_NPM_CACHE = originalCache;
    }

    for (const tempRoot of tempRoots.splice(0)) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('honors LIVE_EDIT_NPM_CACHE', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'live-edit-test-cache-'));
    tempRoots.push(tempRoot);
    const cacheDir = path.join(tempRoot, 'npm-cache');
    process.env.LIVE_EDIT_NPM_CACHE = cacheDir;

    expect(getSharedNpmCache()).toBe(cacheDir);
  });

  it('falls back to the shared tmp cache dir', () => {
    delete process.env.LIVE_EDIT_NPM_CACHE;

    expect(getSharedNpmCache()).toBe(path.join(os.tmpdir(), 'live-edit-npm-cache'));
  });
});
