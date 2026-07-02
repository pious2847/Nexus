/**
 * Express middleware factory for permission checks. Guards a route with a
 * permission; `resolveTargetPath` extracts the target place's ltree path from the
 * request (omit for national-scoped actions). Requires an authenticated request
 * (legacy `authenticate` sets `req.user`).
 */
import type { Request, RequestHandler } from 'express';
import type { Permission } from '@nexus/shared';
import type { RbacService } from './rbac.service';

type AuthedRequest = Request & { user?: { id: string } };

export function requirePermission(
  rbac: RbacService,
  permission: Permission,
  resolveTargetPath?: (req: Request) => string | null | Promise<string | null>,
): RequestHandler {
  return async (req, res, next) => {
    const userId = (req as AuthedRequest).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }
    const targetPath = resolveTargetPath ? await resolveTargetPath(req) : null;
    if (!(await rbac.can(userId, permission, targetPath))) {
      res.status(403).json({ success: false, message: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
