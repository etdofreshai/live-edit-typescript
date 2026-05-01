import express from 'express';
import http from 'http';
import { afterEach, describe, expect, it } from 'vitest';
import { createRequireAdmin } from '../server/admin-middleware.js';

const servers: http.Server[] = [];

async function getProtectedRoute(configuredToken: string | undefined, headers: Record<string, string> = {}) {
  const app = express();
  app.get('/protected', createRequireAdmin(configuredToken), (_req, res) => {
    res.status(204).end();
  });

  const server = http.createServer(app);
  servers.push(server);

  await new Promise<void>(resolve => {
    server.listen({ host: '127.0.0.1', port: 0 }, resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind to a port');

  return fetch(`http://127.0.0.1:${address.port}/protected`, { headers });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => {
      if (error) reject(error);
      else resolve();
    });
  })));
});

describe('createRequireAdmin route middleware', () => {
  it('denies a protected route when the token is missing', async () => {
    const response = await getProtectedRoute('secret');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('denies a protected route when the token is wrong', async () => {
    const response = await getProtectedRoute('secret', { authorization: 'Bearer wrong' });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('reaches the route handler when the token is valid', async () => {
    const response = await getProtectedRoute('secret', { authorization: 'Bearer secret' });

    expect(response.status).toBe(204);
  });

  it('leaves the route open when no admin token is configured', async () => {
    const response = await getProtectedRoute(undefined);

    expect(response.status).toBe(204);
  });
});
