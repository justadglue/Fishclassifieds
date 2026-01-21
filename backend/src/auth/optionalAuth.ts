import type { Request, Response, NextFunction } from "express";
import type Database from "better-sqlite3";
import { verifyAccessToken } from "./jwt.js";
import { clearAccessCookie, clearAuthCookies } from "./cookies.js";
import { nowIso } from "../security.js";

function getDb(req: Request): Database.Database {
  const db = (req.app as any)?.locals?.db as Database.Database | undefined;
  if (!db) throw new Error("DB not available on app.locals.db");
  return db;
}

// Like requireAuth, but never blocks the request.
// If the access token is present + valid, attaches req.user.
export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.fc_access;
  if (!token || typeof token !== "string") return next();

  try {
    const payload = verifyAccessToken(token);
    const userId = Number(payload.sub);
    if (!Number.isFinite(userId)) return next();
    const sid = (payload as any)?.sid;
    if (!sid || typeof sid !== "string") {
      clearAccessCookie(res);
      return next();
    }

    const db = getDb(req);
    const session = db.prepare(`SELECT id,user_id,expires_at,revoked_at FROM sessions WHERE id = ?`).get(sid) as any | undefined;
    if (!session || Number(session.user_id) !== userId) {
      clearAccessCookie(res);
      return next();
    }
    if (session.revoked_at) {
      clearAuthCookies(res);
      return next();
    }
    const expiresAtMs = Date.parse(String(session.expires_at ?? ""));
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
      clearAuthCookies(res);
      return next();
    }

    const row = db
      .prepare(
        `
SELECT u.id,u.email,u.username,u.is_admin,u.is_superadmin,
       m.status as mod_status, m.suspended_until as mod_suspended_until
FROM users u
LEFT JOIN user_moderation m ON m.user_id = u.id
WHERE u.id = ?
`
      )
      .get(userId) as any | undefined;

    if (!row) return next();

    const modStatus = row.mod_status ? String(row.mod_status) : "active";
    const suspendedUntil = row.mod_suspended_until != null ? Number(row.mod_suspended_until) : null;
    // If banned/suspended, treat as unauthenticated (never attach req.user).
    if (modStatus === "banned") return next();
    if (modStatus === "suspended") {
      if (suspendedUntil == null || suspendedUntil > Date.now()) return next();
      // Auto-clear expired suspensions.
      try {
        db.prepare(`UPDATE user_moderation SET status='active', reason=NULL, suspended_until=NULL, updated_at=? WHERE user_id = ?`).run(nowIso(), userId);
      } catch {
        // ignore
      }
    }

    req.user = {
      id: Number(row.id),
      email: String(row.email),
      username: String(row.username),
      isAdmin: Boolean(Number(row.is_admin ?? 0)),
      isSuperadmin: Boolean(Number(row.is_superadmin ?? 0)),
    };
  } catch {
    // ignore (treat as unauthenticated)
  }

  return next();
}

