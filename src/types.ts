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

export interface VoiceJob {
  id: string;
  status: 'transcribing' | 'sending' | 'sent' | 'error';
  text: string;
  startedAt: number;
  error?: string;
}
