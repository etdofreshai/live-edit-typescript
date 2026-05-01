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

export function isSameOriginApiRequest(input: RequestInfo | URL, origin: string, baseUrl: string): boolean {
  const raw = input instanceof Request ? input.url : String(input);
  const url = new URL(raw, origin);
  if (url.origin !== origin) return false;

  const basePath = new URL(baseUrl, origin).pathname;
  const apiBase = `${basePath.replace(/\/$/, '')}/api/`;
  return url.pathname === `${basePath.replace(/\/$/, '')}/api` || url.pathname.startsWith(apiBase);
}

export function withAdminToken(input: RequestInfo | URL, opts: RequestInit = {}): RequestInit {
  const token = getAdminToken();
  if (
    !token ||
    typeof window === 'undefined' ||
    !isSameOriginApiRequest(input, window.location.origin, import.meta.env.BASE_URL)
  ) {
    return opts;
  }

  const headers = new Headers(opts.headers);
  if (!headers.has('Authorization') && !headers.has('x-admin-token')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return { ...opts, headers };
}

export function apiFetch(input: RequestInfo | URL, opts?: RequestInit): Promise<Response> {
  return fetch(input, withAdminToken(input, opts));
}

export async function api<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
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
