import { validateBranch, validateOwner, validateRepo, validateSha } from './validators.js';

const TOKEN = process.env.GITHUB_TOKEN;
export const DEFAULT_OWNER = validateOwner(process.env.GITHUB_DEFAULT_OWNER || 'etdofreshai');
const headers: Record<string, string> = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'live-edit-ts',
};
if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

async function ghFetch(path: string) {
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function listRepos(owner = DEFAULT_OWNER) {
  const safeOwner = validateOwner(owner);
  return ghFetch(`/users/${safeOwner}/repos?per_page=100&sort=updated`);
}

export async function listBranches(owner: string, repo: string) {
  const safeOwner = validateOwner(owner);
  const safeRepo = validateRepo(repo);
  return ghFetch(`/repos/${safeOwner}/${safeRepo}/branches?per_page=100`);
}

export async function listCommits(owner: string, repo: string, branch: string) {
  const safeOwner = validateOwner(owner);
  const safeRepo = validateRepo(repo);
  const safeBranch = validateBranch(branch);
  return ghFetch(`/repos/${safeOwner}/${safeRepo}/commits?sha=${encodeURIComponent(safeBranch)}&per_page=30`);
}

export async function getBranchHead(owner: string, repo: string, branch: string): Promise<string> {
  const safeOwner = validateOwner(owner);
  const safeRepo = validateRepo(repo);
  const safeBranch = validateBranch(branch);
  const data = await ghFetch(`/repos/${safeOwner}/${safeRepo}/branches/${encodeURIComponent(safeBranch)}`);
  return data.commit.sha;
}

export async function getCommit(owner: string, repo: string, sha: string): Promise<{ message: string; date: string }> {
  const safeOwner = validateOwner(owner);
  const safeRepo = validateRepo(repo);
  const safeSha = validateSha(sha);
  const data = await ghFetch(`/repos/${safeOwner}/${safeRepo}/commits/${safeSha}`);
  return {
    message: data.commit?.message?.split('\n')[0] || '',
    date: data.commit?.committer?.date || data.commit?.author?.date || '',
  };
}

export async function createBranch(owner: string, repo: string, name: string, fromSha: string) {
  const safeOwner = validateOwner(owner);
  const safeRepo = validateRepo(repo);
  const safeName = validateBranch(name);
  const safeFromSha = validateSha(fromSha);
  const res = await fetch(`https://api.github.com/repos/${safeOwner}/${safeRepo}/git/refs`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${safeName}`, sha: safeFromSha }),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 422 && text.includes('Reference already exists')) {
      throw new Error(`Branch "${safeName}" already exists`);
    }
    throw new Error(`GitHub API ${res.status}: ${text}`);
  }
  return res.json();
}

export async function getDefaultBranch(owner: string, repo: string): Promise<string> {
  const safeOwner = validateOwner(owner);
  const safeRepo = validateRepo(repo);
  const data = await ghFetch(`/repos/${safeOwner}/${safeRepo}`);
  return data.default_branch;
}

export async function compareBranches(owner: string, repo: string, base: string, head: string) {
  const safeOwner = validateOwner(owner);
  const safeRepo = validateRepo(repo);
  const safeBase = validateBranch(base);
  const safeHead = validateBranch(head);
  const data = await ghFetch(`/repos/${safeOwner}/${safeRepo}/compare/${encodeURIComponent(safeBase)}...${encodeURIComponent(safeHead)}`);
  return { ahead_by: data.ahead_by, behind_by: data.behind_by, status: data.status };
}

export async function createPullRequest(owner: string, repo: string, title: string, head: string, base: string, body?: string) {
  const safeOwner = validateOwner(owner);
  const safeRepo = validateRepo(repo);
  const safeHead = validateBranch(head);
  const safeBase = validateBranch(base);
  const res = await fetch(`https://api.github.com/repos/${safeOwner}/${safeRepo}/pulls`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, head: safeHead, base: safeBase, body: body || '' }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${res.status}: ${text}`);
  }
  return res.json();
}
