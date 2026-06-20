const TOKEN = process.env.GITHUB_TOKEN;
const OWNERS = (process.env.GITHUB_OWNERS || 'etdofreshai').split(',').map(s => s.trim()).filter(Boolean);
const DEFAULT_OWNER = OWNERS[0];
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
  const all: any[] = [];
  for (const owner of OWNERS) {
    try {
      const repos = await ghFetch(`/users/${owner}/repos?per_page=100&sort=updated`);
      // GitHub returns owner.login on /users/:u/repos — preserve it; do not strip.
      if (Array.isArray(repos)) all.push(...repos);
    } catch (e: any) {
      // One failing owner must NOT blank the whole list — skip it, log it.
      console.error(`[github] Failed to list repos for owner "${owner}": ${e.message}`);
    }
  }
  return all;
}

export async function listBranches(owner: string, repo: string) {
  return ghFetch(`/repos/${owner}/${repo}/branches?per_page=100`);
}

export async function listCommits(owner: string, repo: string, branch: string) {
  return ghFetch(`/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=30`);
}

export async function getBranchHead(owner: string, repo: string, branch: string): Promise<string> {
  const data = await ghFetch(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`);
  return data.commit.sha;
}

export async function getCommit(owner: string, repo: string, sha: string): Promise<{ message: string; date: string }> {
  const data = await ghFetch(`/repos/${owner}/${repo}/commits/${sha}`);
  return {
    message: data.commit?.message?.split('\n')[0] || '',
    date: data.commit?.committer?.date || data.commit?.author?.date || '',
  };
}

export async function createBranch(owner: string, repo: string, name: string, fromSha: string) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
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

export async function getDefaultBranch(owner: string, repo: string): Promise<string> {
  const data = await ghFetch(`/repos/${owner}/${repo}`);
  return data.default_branch;
}

export async function compareBranches(owner: string, repo: string, base: string, head: string) {
  const data = await ghFetch(`/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`);
  return { ahead_by: data.ahead_by, behind_by: data.behind_by, status: data.status };
}

export async function createPullRequest(owner: string, repo: string, title: string, head: string, base: string, body?: string) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
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

export { OWNERS, DEFAULT_OWNER };
