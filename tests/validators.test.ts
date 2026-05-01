import { describe, it, expect } from 'vitest';
import { validateRepo, validateSha, validateBranch, validateOwner } from '../server/validators.js';

describe('validateRepo', () => {
  it('accepts a simple alphanumeric repo', () => {
    expect(validateRepo('my-repo')).toBe('my-repo');
  });

  it('accepts repo with dots and underscores', () => {
    expect(validateRepo('my.repo_v2')).toBe('my.repo_v2');
  });

  it('accepts repo at min length 1', () => {
    expect(validateRepo('a')).toBe('a');
  });

  it('accepts repo at max length 100', () => {
    const name = 'a'.repeat(100);
    expect(validateRepo(name)).toBe(name);
  });

  it('rejects empty string', () => {
    expect(() => validateRepo('')).toThrow('invalid repo');
  });

  it('rejects repo exceeding 100 chars', () => {
    expect(() => validateRepo('a'.repeat(101))).toThrow('invalid repo');
  });

  it('rejects repo with spaces', () => {
    expect(() => validateRepo('my repo')).toThrow('invalid repo');
  });

  it('rejects repo with special chars', () => {
    expect(() => validateRepo('repo!@#$')).toThrow('invalid repo');
  });

  it('rejects repo with path traversal', () => {
    expect(() => validateRepo('../evil')).toThrow('invalid repo');
  });

  it('rejects non-string input', () => {
    const invalidRepo: unknown = 42;
    expect(() => validateRepo(invalidRepo)).toThrow('invalid repo');
  });
});

describe('validateOwner', () => {
  it('accepts a simple alphanumeric owner', () => {
    expect(validateOwner('octocat')).toBe('octocat');
  });

  it('accepts hyphens in the middle', () => {
    expect(validateOwner('github-user')).toBe('github-user');
  });

  it('accepts owner at min length 1', () => {
    expect(validateOwner('a')).toBe('a');
  });

  it('accepts owner at max length 39', () => {
    const owner = 'a'.repeat(39);
    expect(validateOwner(owner)).toBe(owner);
  });

  it('rejects empty owner', () => {
    expect(() => validateOwner('')).toThrow('invalid owner');
  });

  it('rejects owner exceeding 39 chars', () => {
    expect(() => validateOwner('a'.repeat(40))).toThrow('invalid owner');
  });

  it('rejects leading hyphen', () => {
    expect(() => validateOwner('-octocat')).toThrow('invalid owner');
  });

  it('rejects trailing hyphen', () => {
    expect(() => validateOwner('octocat-')).toThrow('invalid owner');
  });

  it('rejects underscores and dots', () => {
    expect(() => validateOwner('octo_cat')).toThrow('invalid owner');
    expect(() => validateOwner('octo.cat')).toThrow('invalid owner');
  });

  it('rejects non-string input', () => {
    const invalidOwner: unknown = null;
    expect(() => validateOwner(invalidOwner)).toThrow('invalid owner');
  });
});

describe('validateSha', () => {
  it('accepts a full 40-char sha', () => {
    const sha = 'a'.repeat(40);
    expect(validateSha(sha)).toBe(sha);
  });

  it('accepts a minimal 7-char sha', () => {
    const sha = 'abcdef0';
    expect(validateSha(sha)).toBe(sha);
  });

  it('accepts mixed case hex', () => {
    const sha = 'AbCdEf1234567890AbCdEf1234567890AbCdEf12';
    expect(validateSha(sha)).toBe(sha);
  });

  it('rejects 6-char sha (too short)', () => {
    expect(() => validateSha('abcdef')).toThrow('invalid sha');
  });

  it('rejects 41-char sha (too long)', () => {
    expect(() => validateSha('a'.repeat(41))).toThrow('invalid sha');
  });

  it('rejects sha with non-hex chars', () => {
    expect(() => validateSha('abcdefg')).toThrow('invalid sha');
  });

  it('rejects empty string', () => {
    expect(() => validateSha('')).toThrow('invalid sha');
  });

  it('rejects non-string input', () => {
    const invalidSha: unknown = null;
    expect(() => validateSha(invalidSha)).toThrow('invalid sha');
  });
});

describe('validateBranch', () => {
  it('accepts simple branch name', () => {
    expect(validateBranch('main')).toBe('main');
  });

  it('accepts branch with slashes', () => {
    expect(validateBranch('feature/my-branch')).toBe('feature/my-branch');
  });

  it('accepts branch with dots', () => {
    expect(validateBranch('release/v1.2')).toBe('release/v1.2');
  });

  it('accepts branch at max length 200', () => {
    const name = 'a'.repeat(200);
    expect(validateBranch(name)).toBe(name);
  });

  it('rejects empty string', () => {
    expect(() => validateBranch('')).toThrow('invalid branch');
  });

  it('rejects branch exceeding 200 chars', () => {
    expect(() => validateBranch('a'.repeat(201))).toThrow('invalid branch');
  });

  it('rejects branch starting with dash', () => {
    expect(() => validateBranch('-branch')).toThrow('invalid branch');
  });

  it('rejects branch with .. segment', () => {
    expect(() => validateBranch('feature/..')).toThrow('invalid branch');
  });

  it('rejects branch with spaces', () => {
    expect(() => validateBranch('my branch')).toThrow('invalid branch');
  });

  it('rejects branch with special chars', () => {
    expect(() => validateBranch('branch!name')).toThrow('invalid branch');
  });

  it('rejects non-string input', () => {
    const invalidBranch: unknown = undefined;
    expect(() => validateBranch(invalidBranch)).toThrow('invalid branch');
  });
});
