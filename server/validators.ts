export function validateRepo(name: string): string {
  if (typeof name !== 'string' || name.length < 1 || name.length > 100 || !/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error('invalid repo: ' + name);
  }
  return name;
}

export function validateSha(sha: string): string {
  if (typeof sha !== 'string' || !/^[0-9a-f]{7,40}$/i.test(sha)) {
    throw new Error('invalid sha: ' + sha);
  }
  return sha;
}

export function validateBranch(branch: string): string {
  if (
    typeof branch !== 'string' ||
    branch.length < 1 ||
    branch.length > 200 ||
    branch.startsWith('-') ||
    !/^[A-Za-z0-9._/-]+$/.test(branch) ||
    branch.split('/').some(segment => segment === '..')
  ) {
    throw new Error('invalid branch: ' + branch);
  }
  return branch;
}
