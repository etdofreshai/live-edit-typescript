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

export { OWNER };
