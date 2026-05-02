import { describe, expect, it } from 'vitest';
import { isAdminAuthorized } from '../server/admin-auth.js';

function headers(values: Record<string, string | undefined>) {
  return {
    get(name: string) {
      return values[name.toLowerCase()];
    },
  };
}

describe('isAdminAuthorized', () => {
  it('allows requests when no admin token is configured', () => {
    expect(isAdminAuthorized(headers({}), undefined)).toBe(true);
  });

  it('allows requests with a valid bearer token', () => {
    expect(isAdminAuthorized(headers({ authorization: 'Bearer secret' }), 'secret')).toBe(true);
  });

  it('allows requests with a valid x-admin-token header', () => {
    expect(isAdminAuthorized(headers({ 'x-admin-token': 'secret' }), 'secret')).toBe(true);
  });

  it('denies requests with a wrong token', () => {
    expect(isAdminAuthorized(headers({ authorization: 'Bearer wrong' }), 'secret')).toBe(false);
  });

  it('denies requests with a missing token', () => {
    expect(isAdminAuthorized(headers({}), 'secret')).toBe(false);
  });

  it('denies requests with a malformed bearer token', () => {
    expect(isAdminAuthorized(headers({ authorization: 'Bearer' }), 'secret')).toBe(false);
    expect(isAdminAuthorized(headers({ authorization: 'Token secret' }), 'secret')).toBe(false);
  });
});
