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
      .prepare(`SELECT id,email,username,display_name FROM users WHERE id = ?`)
      .get(userId) as any | undefined;

    if (!row) return next();

    req.user = {
      id: Number(row.id),
      email: String(row.email),
      username: String(row.username),
      displayName: row.display_name != null ? String(row.display_name) : null,
    };
  } catch {
    // ignore (treat as unauthenticated)
  }

  return next();
}

