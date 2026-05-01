export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const ADMIN_TOKEN_STORAGE_KEY = 'live-edit-admin-token';

function canUseSessionStorage(): boolean {
  try {
    const key = `${ADMIN_TOKEN_STORAGE_KEY}:test`;
    sessionStorage.setItem(key, '1');
    sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function getAdminToken(): string {
  if (!canUseSessionStorage()) return '';
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setAdminToken(token: string): void {
  if (!canUseSessionStorage()) return;
  try {
    const trimmed = token.trim();
    if (trimmed) sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, trimmed);
    else sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
  } catch {}
}

export function clearAdminToken(): void {
  setAdminToken('');
}

function isSameOriginApiRequest(input: RequestInfo | URL): boolean {
  if (typeof window === 'undefined') return false;
  const raw = input instanceof Request ? input.url : String(input);
  const url = new URL(raw, window.location.origin);
  if (url.origin !== window.location.origin) return false;

  const basePath = new URL(import.meta.env.BASE_URL, window.location.origin).pathname;
  const apiBase = `${basePath.replace(/\/$/, '')}/api/`;
  return url.pathname === `${basePath.replace(/\/$/, '')}/api` || url.pathname.startsWith(apiBase);
}

export function withAdminToken(input: RequestInfo | URL, opts: RequestInit = {}): RequestInit {
  const token = getAdminToken();
  if (!token || !isSameOriginApiRequest(input)) return opts;

  const headers = new Headers(opts.headers);
  if (!headers.has('Authorization') && !headers.has('x-admin-token')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return { ...opts, headers };
}

export function apiFetch(input: RequestInfo | URL, opts?: RequestInit): Promise<Response> {
  return fetch(input, withAdminToken(input, opts));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function api<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const res = await apiFetch(path, opts);
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body.error) message = body.error;
    } catch {}
    throw new ApiError(res.status, message);
  }
  return res.json();
}
