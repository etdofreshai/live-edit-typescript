export interface CacheEntry {
  id: string;
  repo: string;
  sha: string;
  port: number;
  lastAccessed: number;
  branch?: string;
  isLatest?: boolean;
  commitMessage?: string;
  commitDate?: string;
  type?: 'vite' | 'static';
}

export interface Repo {
  name: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface Branch {
  name: string;
  [key: string]: unknown;
}

export interface Commit {
  sha: string;
  commit?: {
    message?: string;
    author?: {
      date?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface CompareInfo {
  ahead: number;
  behind: number;
  defaultBranch: string;
}

export interface PullRequestResult {
  url: string;
  number: number;
  error?: string;
}

export interface VoiceJob {
  id: string;
  status: 'transcribing' | 'sending' | 'sent' | 'error';
  text: string;
  startedAt: number;
  error?: string;
}
