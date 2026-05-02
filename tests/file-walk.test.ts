import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { walkBounded } from '../server/file-walk.js';

async function makeTree(root: string, structure: Record<string, string | null>) {
  // null means directory
  for (const [relPath, content] of Object.entries(structure)) {
    const fullPath = path.join(root, relPath);
    if (content === null) {
      fs.mkdirSync(fullPath, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    }
  }
}

describe('walkBounded', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'walk-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('walks a flat directory', async () => {
    makeTree(tmpDir, {
      'a.txt': 'hello',
      'b.txt': 'world',
    });
    const { files, truncated } = await walkBounded(tmpDir);
    expect(files).toContain('a.txt');
    expect(files).toContain('b.txt');
    expect(truncated).toBe(false);
  });

  it('walks nested directories', async () => {
    makeTree(tmpDir, {
      'src/index.ts': 'code',
      'src/utils/helper.ts': 'util',
      'README.md': 'readme',
    });
    const { files } = await walkBounded(tmpDir);
    expect(files).toContain('src/index.ts');
    expect(files).toContain('src/utils/helper.ts');
    expect(files).toContain('README.md');
  });

  it('respects depth cap', async () => {
    makeTree(tmpDir, {
      'a/b/c/d/e/f/g/h/i/j/deep.txt': 'deep',
      'shallow.txt': 'shallow',
    });
    const { files } = await walkBounded(tmpDir, { maxDepth: 3 });
    // deep.txt is at depth 10, should not appear
    expect(files.some(f => f.includes('deep.txt'))).toBe(false);
    expect(files).toContain('shallow.txt');
  });

  it('respects file count cap', async () => {
    const structure: Record<string, string> = {};
    for (let i = 0; i < 100; i++) {
      structure[`file-${i}.txt`] = `content-${i}`;
    }
    makeTree(tmpDir, structure);
    const { files, truncated } = await walkBounded(tmpDir, { maxFiles: 10 });
    expect(files.length).toBeLessThanOrEqual(10);
    expect(truncated).toBe(true);
  });

  it('skips default skipDirs (node_modules, .git, etc.)', async () => {
    makeTree(tmpDir, {
      'node_modules/pkg/index.js': 'pkg',
      '.git/HEAD': 'ref: refs/heads/main',
      'src/app.ts': 'app',
    });
    const { files } = await walkBounded(tmpDir);
    expect(files).toContain('src/app.ts');
    expect(files.some(f => f.includes('node_modules'))).toBe(false);
    expect(files.some(f => f.includes('.git'))).toBe(false);
  });

  it('honors custom skipDirs', async () => {
    makeTree(tmpDir, {
      'custom-skip/file.txt': 'skip',
      'src/app.ts': 'app',
    });
    const { files } = await walkBounded(tmpDir, { skipDirs: ['custom-skip'] });
    expect(files).toContain('src/app.ts');
    expect(files.some(f => f.includes('custom-skip'))).toBe(false);
  });

  it('does not follow symlink directories by default', async () => {
    makeTree(tmpDir, {
      'real/file.txt': 'real',
    });
    // Create a symlink to a directory outside
    const linkTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'link-target-'));
    fs.writeFileSync(path.join(linkTarget, 'external.txt'), 'outside');
    fs.symlinkSync(linkTarget, path.join(tmpDir, 'link'));

    const { files } = await walkBounded(tmpDir);
    expect(files.some(f => f.includes('external'))).toBe(false);

    fs.rmSync(linkTarget, { recursive: true, force: true });
  });

  it('sets truncated flag when maxBytes exceeded', async () => {
    makeTree(tmpDir, {
      'big.dat': 'x'.repeat(1000),
    });
    const { truncated } = await walkBounded(tmpDir, { maxBytes: 100 });
    expect(truncated).toBe(true);
  });

  it('returns sorted file list', async () => {
    makeTree(tmpDir, {
      'z.txt': 'z',
      'a.txt': 'a',
      'm.txt': 'm',
    });
    const { files } = await walkBounded(tmpDir);
    const sorted = [...files].sort();
    expect(files).toEqual(sorted);
  });

  it('handles non-existent directory gracefully', async () => {
    const { files, truncated } = await walkBounded('/nonexistent/path');
    expect(files).toEqual([]);
    expect(truncated).toBe(false);
  });
});
