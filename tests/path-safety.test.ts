import { describe, it, expect } from 'vitest';
import path from 'path';
import { assertInsideTargets, safeTargetSubdir } from '../server/path-safety.js';
import { TARGETS_DIR } from '../server/path-safety.js';

describe('assertInsideTargets', () => {
  it('accepts the targets dir itself', () => {
    expect(() => assertInsideTargets(TARGETS_DIR)).not.toThrow();
  });

  it('accepts a subdirectory inside targets', () => {
    expect(() => assertInsideTargets(path.join(TARGETS_DIR, 'my-repo-abc1234'))).not.toThrow();
  });

  it('accepts nested path inside targets', () => {
    expect(() => assertInsideTargets(path.join(TARGETS_DIR, 'repo', 'src', 'index.ts'))).not.toThrow();
  });

  it('rejects path traversal via ..', () => {
    expect(() => assertInsideTargets(path.join(TARGETS_DIR, '..', 'etc', 'passwd'))).toThrow('path outside targets');
  });

  it('rejects absolute path outside targets', () => {
    expect(() => assertInsideTargets('/etc/passwd')).toThrow('path outside targets');
  });

  it('rejects sibling directory', () => {
    expect(() => assertInsideTargets(path.resolve(process.cwd(), 'server'))).toThrow('path outside targets');
  });

  it('rejects targets dir prefix without separator (e.g. targets-evil)', () => {
    expect(() => assertInsideTargets(TARGETS_DIR + '-evil')).toThrow('path outside targets');
  });
});

describe('safeTargetSubdir', () => {
  it('produces a path inside targets dir', () => {
    const result = safeTargetSubdir('my-repo', 'abcdef1234567890abcdef1234567890abcdef12');
    expect(result.startsWith(TARGETS_DIR + path.sep)).toBe(true);
  });

  it('includes repo name and first 7 chars of sha', () => {
    const result = safeTargetSubdir('my-repo', 'abcdef1234567890abcdef1234567890abcdef12');
    expect(result).toContain('my-repo');
    expect(result).toContain('abcdef1');
  });

  it('rejects invalid repo', () => {
    expect(() => safeTargetSubdir('../evil', 'abcdef1234567890abcdef1234567890abcdef12')).toThrow('invalid repo');
  });

  it('rejects invalid sha', () => {
    expect(() => safeTargetSubdir('my-repo', 'not-a-sha')).toThrow('invalid sha');
  });
});
