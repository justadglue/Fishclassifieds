import type { Request, Response, NextFunction } from "express";
import type Database from "better-sqlite3";
import { verifyAccessToken } from "./jwt.js";

declare global {
  namespace Express {
    interface Request {
      user?: { id: number; email: string; username: string; displayName: string | null };
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
      .prepare(`SELECT id,email,username,display_name FROM users WHERE id = ?`)
      .get(userId) as any | undefined;

    if (!row) return res.status(401).json({ error: "User not found" });

    req.user = {
      id: Number(row.id),
      email: String(row.email),
      username: String(row.username),
      displayName: row.display_name != null ? String(row.display_name) : null,
    };

    return next();
  } catch {
    return res.status(401).json({ error: "Invalid access token" });
  }
}
