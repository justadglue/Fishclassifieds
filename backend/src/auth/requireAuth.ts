import type { Request, Response, NextFunction } from "express";
import type Database from "better-sqlite3";
import { verifyAccessToken } from "./jwt.js";
import { nowIso } from "../security.js";

declare global {
  namespace Express {
    interface Request {
      user?: { id: number; email: string; username: string; isAdmin: boolean; isSuperadmin: boolean };
    }
  }
}

function getDb(req: Request): Database.Database {
  const db = (req.app as any)?.locals?.db as Database.Database | undefined;
  if (!db) {
    throw new Error("DB not available on app.locals.db");
  }
  return db;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.fc_access;
  if (!token || typeof token !== "string") return res.status(401).json({ error: "Not authenticated" });

  try {
    const payload = verifyAccessToken(token);
    const userId = Number(payload.sub);
    if (!Number.isFinite(userId)) return res.status(401).json({ error: "Invalid access token" });

    const db = getDb(req);
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

    if (!row) return res.status(401).json({ error: "User not found" });

    const modStatus = row.mod_status ? String(row.mod_status) : "active";
    const suspendedUntil = row.mod_suspended_until != null ? Number(row.mod_suspended_until) : null;
    if (modStatus === "banned") return res.status(403).json({ error: "Account banned" });
    if (modStatus === "suspended") {
      if (suspendedUntil == null || suspendedUntil > Date.now()) return res.status(403).json({ error: "Account suspended" });
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

    return next();
  } catch {
    return res.status(401).json({ error: "Invalid access token" });
  }
}
