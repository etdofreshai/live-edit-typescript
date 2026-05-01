import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildChildEnv } from '../server/runner.js';

describe('buildChildEnv', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Set secrets that should be stripped
    process.env.GITHUB_TOKEN = 'ghp_secret123';
    process.env.OPENAI_API_KEY = 'sk-test-key';
    process.env.OPENCLAW_GATEWAY_TOKEN = 'oct-token';
    // Set allowlist vars
    process.env.PATH = '/usr/bin';
    process.env.HOME = '/home/test';
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    // Restore original env
    const keys = new Set([...Object.keys(process.env), ...Object.keys(originalEnv)]);
    for (const key of keys) {
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it('strips secrets from result', () => {
    const env = buildChildEnv({}, { PORT: '3000' });
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.OPENCLAW_GATEWAY_TOKEN).toBeUndefined();
  });

  it('passes allowlist vars through', () => {
    const env = buildChildEnv({}, { PORT: '3000' });
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/test');
    expect(env.NODE_ENV).toBe('test');
  });

  it('applies runtime PORT', () => {
    const env = buildChildEnv({}, { PORT: '5174' });
    expect(env.PORT).toBe('5174');
  });

  it('applies runtime HOST and BASE when provided', () => {
    const env = buildChildEnv({}, { PORT: '5174', HOST: '0.0.0.0', BASE: '/proxy/5174/' });
    expect(env.HOST).toBe('0.0.0.0');
    expect(env.BASE).toBe('/proxy/5174/');
  });

  it('does not set HOST or BASE when not provided', () => {
    const env = buildChildEnv({}, { PORT: '5174' });
    expect(env.HOST).toBeUndefined();
    expect(env.BASE).toBeUndefined();
  });

  it('lets user envVars override allowlist', () => {
    const env = buildChildEnv({ NODE_ENV: 'production' }, { PORT: '3000' });
    expect(env.NODE_ENV).toBe('production');
  });

  it('includes user envVars in result', () => {
    const env = buildChildEnv({ VITE_API_KEY: 'abc' }, { PORT: '3000' });
    expect(env.VITE_API_KEY).toBe('abc');
  });

  it('user envVars override runtime vars', () => {
    const env = buildChildEnv({ PORT: '9999' }, { PORT: '5174' });
    // User env vars are applied last, so they override
    expect(env.PORT).toBe('9999');
  });
});
