import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, api, isSameOriginApiRequest, setAdminToken, withAdminToken } from '../src/api.js';

const originalWindow = globalThis.window;
const originalSessionStorage = globalThis.sessionStorage;
const originalFetch = globalThis.fetch;

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe('isSameOriginApiRequest', () => {
  it('matches same-origin API paths', () => {
    expect(isSameOriginApiRequest('/api', 'https://example.test', '/')).toBe(true);
    expect(isSameOriginApiRequest('/api/cache', 'https://example.test', '/')).toBe(true);
  });

  it('rejects non-API and external paths', () => {
    expect(isSameOriginApiRequest('/assets/app.js', 'https://example.test', '/')).toBe(false);
    expect(isSameOriginApiRequest('https://other.test/api', 'https://example.test', '/')).toBe(false);
  });
});

describe('withAdminToken', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { origin: 'https://example.test' } },
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: createStorage(),
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: originalSessionStorage,
    });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
  });

  it('does not add an auth header when no admin token is set', () => {
    const opts = withAdminToken('/api/cache');

    expect(new Headers(opts.headers).has('Authorization')).toBe(false);
  });

  it('adds a bearer token for same-origin API paths', () => {
    setAdminToken('secret');

    const opts = withAdminToken('/api/cache');

    expect(new Headers(opts.headers).get('Authorization')).toBe('Bearer secret');
  });

  it('does not add a bearer token for non-API or external paths', () => {
    setAdminToken('secret');

    const assetOpts = withAdminToken('/assets/app.js');
    const externalOpts = withAdminToken('https://other.test/api/cache');

    expect(new Headers(assetOpts.headers).has('Authorization')).toBe(false);
    expect(new Headers(externalOpts.headers).has('Authorization')).toBe(false);
  });

  it('preserves existing headers when adding the bearer token', () => {
    setAdminToken('secret');

    const opts = withAdminToken('/api/cache', {
      headers: {
        Accept: 'application/json',
        'X-Trace-Id': 'trace-1',
      },
    });
    const headers = new Headers(opts.headers);

    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('X-Trace-Id')).toBe('trace-1');
    expect(headers.get('Authorization')).toBe('Bearer secret');
  });

  it('does not overwrite an existing authorization header', () => {
    setAdminToken('secret');

    const opts = withAdminToken('/api/cache', {
      headers: { Authorization: 'Bearer caller-token' },
    });

    expect(new Headers(opts.headers).get('Authorization')).toBe('Bearer caller-token');
  });

  it('does not add authorization when an admin token header already exists', () => {
    setAdminToken('secret');

    const opts = withAdminToken('/api/cache', {
      headers: { 'x-admin-token': 'caller-token' },
    });
    const headers = new Headers(opts.headers);

    expect(headers.get('x-admin-token')).toBe('caller-token');
    expect(headers.has('Authorization')).toBe(false);
  });
});

describe('api', () => {
  afterEach(() => {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
  });

  it('throws an ApiError with the response error message', async () => {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: async () =>
        new Response(JSON.stringify({ error: 'Cache write failed' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
    });

    await expect(api('/api/cache')).rejects.toMatchObject({
      name: 'ApiError',
      status: 500,
      message: 'Cache write failed',
    });
    await expect(api('/api/cache')).rejects.toBeInstanceOf(ApiError);
  });

  it('throws an ApiError with an HTTP status fallback for non-JSON errors', async () => {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: async () => new Response('unavailable', { status: 503 }),
    });

    await expect(api('/api/cache')).rejects.toMatchObject({
      status: 503,
      message: 'HTTP 503',
    });
  });
});
