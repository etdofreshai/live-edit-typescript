import type express from 'express';
import { isAdminAuthorized } from './admin-auth.js';

export function createRequireAdmin(configuredToken: string | undefined) {
  return function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (isAdminAuthorized(req, configuredToken)) return next();
    return res.status(401).json({ error: 'Unauthorized' });
  };
}
