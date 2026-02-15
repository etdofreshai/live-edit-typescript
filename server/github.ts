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

export { OWNER };
