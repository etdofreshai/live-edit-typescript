import fs from 'fs';
import path from 'path';

const DEFAULT_SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', '.next', '.cache',
  '.vercel', '.parcel-cache', 'coverage',
]);

export interface WalkOptions {
  maxDepth?: number;
  maxFiles?: number;
  maxBytes?: number;
  skipDirs?: string[];
  followSymlinks?: boolean;
}

export async function walkBounded(
  rootDir: string,
  opts: WalkOptions = {},
): Promise<{ files: string[]; truncated: boolean }> {
  const maxDepth = opts.maxDepth ?? 10;
  const maxFiles = opts.maxFiles ?? 5000;
  const maxBytes = opts.maxBytes ?? 50 * 1024 * 1024;
  const skipDirs = opts.skipDirs
    ? new Set(opts.skipDirs)
    : DEFAULT_SKIP_DIRS;

  const files: string[] = [];
  let totalBytes = 0;
  let truncated = false;

  async function walk(dir: string, prefix: string, depth: number): Promise<void> {
    if (truncated) return;
    if (depth > maxDepth) return;

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (truncated) return;
      if (skipDirs.has(entry.name)) continue;

      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        // Skip symlinked directories unless followSymlinks is true
        if (!opts.followSymlinks && entry.isSymbolicLink()) continue;
        files.push(rel + '/');
        if (files.length >= maxFiles) { truncated = true; return; }
        await walk(path.join(dir, entry.name), rel, depth + 1);
      } else {
        files.push(rel);
        if (files.length >= maxFiles) { truncated = true; return; }

        // Track byte budget
        try {
          const abs = path.join(dir, entry.name);
          const stat = await fs.promises.lstat(abs);
          totalBytes += stat.size;
          if (totalBytes >= maxBytes) { truncated = true; return; }
        } catch {
          // ignore stat errors
        }
      }
    }
  }

  await walk(rootDir, '', 0);
  files.sort();
  return { files, truncated };
}
