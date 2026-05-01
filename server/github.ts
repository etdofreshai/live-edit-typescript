import { validateBranch, validateRepo, validateSha } from './validators.js';

const TOKEN = process.env.GITHUB_TOKEN;
const OWNER = 'etdofreshai';
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

export async function listRepos() {
  return ghFetch(`/users/${OWNER}/repos?per_page=100&sort=updated`);
}

export async function listBranches(repo: string) {
  const safeRepo = validateRepo(repo);
  return ghFetch(`/repos/${OWNER}/${safeRepo}/branches?per_page=100`);
}

export async function listCommits(repo: string, branch: string) {
  const safeRepo = validateRepo(repo);
  const safeBranch = validateBranch(branch);
  return ghFetch(`/repos/${OWNER}/${safeRepo}/commits?sha=${encodeURIComponent(safeBranch)}&per_page=30`);
}

export async function getBranchHead(repo: string, branch: string): Promise<string> {
  const safeRepo = validateRepo(repo);
  const safeBranch = validateBranch(branch);
  const data = await ghFetch(`/repos/${OWNER}/${safeRepo}/branches/${encodeURIComponent(safeBranch)}`);
  return data.commit.sha;
}

export async function getCommit(repo: string, sha: string): Promise<{ message: string; date: string }> {
  const safeRepo = validateRepo(repo);
  const safeSha = validateSha(sha);
  const data = await ghFetch(`/repos/${OWNER}/${safeRepo}/commits/${safeSha}`);
  return {
    message: data.commit?.message?.split('\n')[0] || '',
    date: data.commit?.committer?.date || data.commit?.author?.date || '',
  };
}

export async function createBranch(repo: string, name: string, fromSha: string) {
  const safeRepo = validateRepo(repo);
  const safeName = validateBranch(name);
  const safeFromSha = validateSha(fromSha);
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${safeRepo}/git/refs`, {
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

export async function getDefaultBranch(repo: string): Promise<string> {
  const safeRepo = validateRepo(repo);
  const data = await ghFetch(`/repos/${OWNER}/${safeRepo}`);
  return data.default_branch;
}

export async function compareBranches(repo: string, base: string, head: string) {
  const safeRepo = validateRepo(repo);
  const safeBase = validateBranch(base);
  const safeHead = validateBranch(head);
  const data = await ghFetch(`/repos/${OWNER}/${safeRepo}/compare/${encodeURIComponent(safeBase)}...${encodeURIComponent(safeHead)}`);
  return { ahead_by: data.ahead_by, behind_by: data.behind_by, status: data.status };
}

export async function createPullRequest(repo: string, title: string, head: string, base: string, body?: string) {
  const safeRepo = validateRepo(repo);
  const safeHead = validateBranch(head);
  const safeBase = validateBranch(base);
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${safeRepo}/pulls`, {
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

export { OWNER };
