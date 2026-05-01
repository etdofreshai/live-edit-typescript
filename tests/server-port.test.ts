import { describe, expect, it } from 'vitest';
import { getServerPort } from '../server/index.js';

describe('getServerPort', () => {
  it('defaults to 3000 when PORT is unset', () => {
    expect(getServerPort({})).toBe(3000);
  });

  it('parses a valid PORT value', () => {
    expect(getServerPort({ PORT: '3010' })).toBe(3010);
  });

  it('rejects non-integer PORT values', () => {
    expect(() => getServerPort({ PORT: '3000.5' })).toThrow(/invalid PORT/);
    expect(() => getServerPort({ PORT: 'abc' })).toThrow(/invalid PORT/);
  });

  it('rejects out-of-range PORT values', () => {
    expect(() => getServerPort({ PORT: '0' })).toThrow(/invalid PORT/);
    expect(() => getServerPort({ PORT: '65536' })).toThrow(/invalid PORT/);
  });
});
