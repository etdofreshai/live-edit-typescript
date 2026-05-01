import path from 'path';
import { validateOwner, validateRepo, validateSha } from './validators.js';

export const TARGETS_DIR = path.resolve(process.cwd(), 'targets');

export function assertInsideTargets(absPath: string): void {
  const resolved = path.resolve(absPath);
  if (resolved !== TARGETS_DIR && !resolved.startsWith(TARGETS_DIR + path.sep)) {
    throw new Error('path outside targets');
  }
}

export function safeTargetSubdir(owner: string, repo: string, sha: string): string {
  const safeOwner = validateOwner(owner);
  const safeRepo = validateRepo(repo);
  const safeSha = validateSha(sha);
  const dir = path.resolve(TARGETS_DIR, `${safeOwner}__${safeRepo}-${safeSha.slice(0, 7)}`);
  assertInsideTargets(dir);
  return dir;
}
