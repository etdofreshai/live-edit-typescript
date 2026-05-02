import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

// We test verifySignature by importing the webhook module with controlled env
// The function reads WEBHOOK_SECRET at module load time, so we need to control
// the environment before import.

function makeSignature(payload: string | Buffer, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

describe('verifySignature', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSecret = process.env.WEBHOOK_SECRET;

  // We'll re-import the module with controlled env for each scenario
  async function importWithEnv(nodeEnv: string, webhookSecret?: string) {
    process.env.NODE_ENV = nodeEnv;
    if (webhookSecret !== undefined) {
      process.env.WEBHOOK_SECRET = webhookSecret;
    } else {
      delete process.env.WEBHOOK_SECRET;
    }

    // Bust the module cache so it picks up new env vars
    const modulePath = '../server/webhook.js';
    const moduleUrl = new URL(modulePath, import.meta.url).href;
    vi.resetModules();

    const mod = await import(moduleUrl);
    return mod;
  }

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalSecret !== undefined) {
      process.env.WEBHOOK_SECRET = originalSecret;
    } else {
      delete process.env.WEBHOOK_SECRET;
    }
    vi.resetModules();
  });

  it('accepts a valid signature', async () => {
    const secret = 'test-secret-key';
    const { verifySignature } = await importWithEnv('test', secret);
    const payload = Buffer.from('{"ref":"refs/heads/main"}');
    const sig = makeSignature(payload, secret);
    expect(verifySignature(payload, sig)).toBe(true);
  });

  it('rejects an invalid signature', async () => {
    const secret = 'test-secret-key';
    const { verifySignature } = await importWithEnv('test', secret);
    const payload = Buffer.from('{"ref":"refs/heads/main"}');
    expect(verifySignature(payload, 'sha256=deadbeef'.repeat(8))).toBe(false);
  });

  it('rejects when signature has wrong length', async () => {
    const secret = 'test-secret-key';
    const { verifySignature } = await importWithEnv('test', secret);
    const payload = Buffer.from('test');
    expect(verifySignature(payload, 'sha256=abcd')).toBe(false);
  });

  it('rejects when signature header is missing', async () => {
    const secret = 'test-secret-key';
    const { verifySignature } = await importWithEnv('test', secret);
    const payload = Buffer.from('test');
    expect(verifySignature(payload, undefined)).toBe(false);
  });

  it('rejects when signature lacks sha256= prefix', async () => {
    const secret = 'test-secret-key';
    const { verifySignature } = await importWithEnv('test', secret);
    const payload = Buffer.from('test');
    expect(verifySignature(payload, 'sha1=abc')).toBe(false);
  });

  it('rejects invalid hex in signature', async () => {
    const secret = 'test-secret-key';
    const { verifySignature } = await importWithEnv('test', secret);
    const payload = Buffer.from('test');
    const badSig = 'sha256=' + 'zz'.repeat(32);
    // Buffer.from('zz', 'hex') produces empty buffer, so lengths won't match
    expect(verifySignature(payload, badSig)).toBe(false);
  });

  it('returns false when no secret configured (dev mode)', async () => {
    const { verifySignature } = await importWithEnv('test', undefined);
    const payload = Buffer.from('test');
    expect(verifySignature(payload, 'sha256=' + '00'.repeat(32))).toBe(false);
  });
});
