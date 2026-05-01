import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isSameOriginApiRequest, setAdminToken, withAdminToken } from '../src/api.js';

const originalWindow = globalThis.window;
const originalSessionStorage = globalThis.sessionStorage;

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
});
