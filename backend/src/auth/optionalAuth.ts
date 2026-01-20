import type { Request, Response, NextFunction } from "express";
import type Database from "better-sqlite3";
import { verifyAccessToken } from "./jwt.js";

function getDb(req: Request): Database.Database {
  const db = (req.app as any)?.locals?.db as Database.Database | undefined;
  if (!db) throw new Error("DB not available on app.locals.db");
  return db;
}

// Like requireAuth, but never blocks the request.
// If the access token is present + valid, attaches req.user.
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.fc_access;
  if (!token || typeof token !== "string") return next();

  try {
    const payload = verifyAccessToken(token);
    const userId = Number(payload.sub);
    if (!Number.isFinite(userId)) return next();

    const db = getDb(req);
    const row = db
      .prepare(`SELECT id,email,username,is_admin,is_superadmin FROM users WHERE id = ?`)
      .get(userId) as any | undefined;

    if (!row) return next();

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

