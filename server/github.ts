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
  return ghFetch(`/repos/${OWNER}/${repo}/branches?per_page=100`);
}

export async function listCommits(repo: string, branch: string) {
  return ghFetch(`/repos/${OWNER}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=30`);
}

export async function getBranchHead(repo: string, branch: string): Promise<string> {
  const data = await ghFetch(`/repos/${OWNER}/${repo}/branches/${encodeURIComponent(branch)}`);
  return data.commit.sha;
}

export async function getCommit(repo: string, sha: string): Promise<{ message: string; date: string }> {
  const data = await ghFetch(`/repos/${OWNER}/${repo}/commits/${sha}`);
  return {
    message: data.commit?.message?.split('\n')[0] || '',
    date: data.commit?.committer?.date || data.commit?.author?.date || '',
  };
}

export async function createBranch(repo: string, name: string, fromSha: string) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${repo}/git/refs`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${name}`, sha: fromSha }),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 422 && text.includes('Reference already exists')) {
      throw new Error(`Branch "${name}" already exists`);
    }
    throw new Error(`GitHub API ${res.status}: ${text}`);
  }
  return res.json();
}

export async function getDefaultBranch(repo: string): Promise<string> {
  const data = await ghFetch(`/repos/${OWNER}/${repo}`);
  return data.default_branch;
}

export async function compareBranches(repo: string, base: string, head: string) {
  const data = await ghFetch(`/repos/${OWNER}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`);
  return { ahead_by: data.ahead_by, behind_by: data.behind_by, status: data.status };
}

export async function createPullRequest(repo: string, title: string, head: string, base: string, body?: string) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${repo}/pulls`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, head, base, body: body || '' }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${res.status}: ${text}`);
  }
  return res.json();
}

export { OWNER };
