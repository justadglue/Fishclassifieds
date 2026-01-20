import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import argon2 from "argon2";
import crypto from "crypto";
import type Database from "better-sqlite3";
import { sha256Hex, nowIso } from "../security.js";
import { config } from "../config.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "./jwt.js";
import { clearAuthCookies, setAuthCookies, COOKIE_REFRESH } from "./cookies.js";

const router = Router();

const RegisterSchema = z.object({
  email: z.string().email().max(320),
  username: z
    .string()
    .min(3)
    .max(20)
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters,numbers,and underscore"),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  password: z.string().min(10).max(200),
});

const LoginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
});

function getDb(req: Request): Database.Database {
  const db = (req.app as any)?.locals?.db as Database.Database | undefined;
  if (!db) throw new Error("DB not available on app.locals.db");
  return db;
}

function getIp(req: Request) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) return xf.split(",")[0].trim();
  return req.socket.remoteAddress ?? null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function computeSlidingSessionExpiryIso(sessionCreatedAtIso: string): string {
  const nowMs = Date.now();
  const slidingDays = Number.isFinite(config.jwtRefreshTtlDays) && config.jwtRefreshTtlDays > 0 ? config.jwtRefreshTtlDays : 30;
  const maxDays =
    Number.isFinite(config.jwtRefreshMaxTtlDays) && config.jwtRefreshMaxTtlDays > 0 ? config.jwtRefreshMaxTtlDays : slidingDays;

  const createdAtMs = Date.parse(sessionCreatedAtIso);
  const slidingExpiryMs = nowMs + slidingDays * DAY_MS;
  const hardCapMs = Number.isFinite(createdAtMs) ? createdAtMs + maxDays * DAY_MS : slidingExpiryMs;

  return new Date(Math.min(slidingExpiryMs, hardCapMs)).toISOString();
}

router.post("/register", async (req: Request, res: Response) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const { email, username, password } = parsed.data;
  const firstName = parsed.data.firstName.trim();
  const lastName = parsed.data.lastName.trim();
  const normEmail = email.toLowerCase().trim();
  const normUsername = username.toLowerCase().trim();

  const db = getDb(req);

  const existingEmail = db
    .prepare(`SELECT id FROM users WHERE lower(email)= lower(?)`)
    .get(normEmail) as { id: number } | undefined;
  if (existingEmail) return res.status(409).json({ error: "Email already in use" });

  const existingUsername = db
    .prepare(`SELECT id FROM users WHERE lower(username)= lower(?)`)
    .get(normUsername) as { id: number } | undefined;
  if (existingUsername) return res.status(409).json({ error: "Username already in use" });

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const info = db
    .prepare(
      `
INSERT INTO users(email,username,first_name,last_name,password_hash,created_at,updated_at)
VALUES(?,?,?,?,?,?,?)
`
    )
    .run(normEmail, normUsername, firstName, lastName, passwordHash, nowIso(), nowIso());

  const userId = Number(info.lastInsertRowid);

  return res.status(201).json({
    user: { id: userId, email: normEmail, username: normUsername },
  });
});

router.post("/login", async (req: Request, res: Response) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const { email, password } = parsed.data;
  const db = getDb(req);

  const row = db
    .prepare(`SELECT * FROM users WHERE lower(email)= lower(?)`)
    .get(email.toLowerCase().trim()) as any | undefined;

  if (!row) return res.status(401).json({ error: "Invalid email or password" });

  const ok = await argon2.verify(row.password_hash, password);
  if (!ok) return res.status(401).json({ error: "Invalid email or password" });

  const sessionId = crypto.randomUUID();
  const refreshToken = signRefreshToken({ sub: String(row.id), sid: sessionId });
  const refreshHash = sha256Hex(refreshToken);
  const createdAt = nowIso();

  db.prepare(
    `
INSERT INTO sessions(id,user_id,refresh_token_hash,created_at,last_used_at,expires_at,revoked_at,user_agent,ip)
VALUES(?,?,?,?,?,?,NULL,?,?)
`
  ).run(
    sessionId,
    row.id,
    refreshHash,
    createdAt,
    createdAt,
    computeSlidingSessionExpiryIso(createdAt),
    req.headers["user-agent"] ?? null,
    getIp(req)
  );

  const accessToken = signAccessToken({ sub: String(row.id), email: row.email });
  setAuthCookies(res, accessToken, refreshToken);

  return res.json({
    user: {
      id: row.id,
      email: row.email,
      username: row.username,
      isAdmin: Boolean(Number(row.is_admin ?? 0)),
      isSuperadmin: Boolean(Number(row.is_superadmin ?? 0)),
    },
  });
});

router.post("/refresh", (req: Request, res: Response) => {
  const raw = req.cookies?.[COOKIE_REFRESH];
  if (!raw || typeof raw !== "string") {
    clearAuthCookies(res);
    return res.status(401).json({ error: "No refresh token" });
  }

  let payload: { sub: string; sid: string };
  try {
    payload = verifyRefreshToken(raw);
  } catch {
    clearAuthCookies(res);
    return res.status(401).json({ error: "Invalid refresh token" });
  }

  const db = getDb(req);

  const session = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(payload.sid) as any | undefined;
  if (!session) {
    clearAuthCookies(res);
    return res.status(401).json({ error: "Session not found" });
  }

  if (session.revoked_at) {
    clearAuthCookies(res);
    return res.status(401).json({ error: "Session revoked" });
  }

  const nowMs = Date.now();
  const expiresAtMs = Date.parse(String(session.expires_at ?? ""));
  const createdAtMs = Date.parse(String(session.created_at ?? ""));
  const maxDays =
    Number.isFinite(config.jwtRefreshMaxTtlDays) && config.jwtRefreshMaxTtlDays > 0 ? config.jwtRefreshMaxTtlDays : config.jwtRefreshTtlDays;
  const hardCapMs = Number.isFinite(createdAtMs) && Number.isFinite(maxDays) && maxDays > 0 ? createdAtMs + maxDays * DAY_MS : NaN;

  const isExpired = (Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) || (Number.isFinite(hardCapMs) && hardCapMs <= nowMs);
  if (isExpired) {
    db.prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ?`).run(nowIso(), session.id);
    clearAuthCookies(res);
    return res.status(401).json({ error: "Session expired" });
  }

  const presentedHash = sha256Hex(raw);
  if (presentedHash !== session.refresh_token_hash) {
    db.prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ?`).run(nowIso(), session.id);
    clearAuthCookies(res);
    return res.status(401).json({ error: "Refresh token reuse detected" });
  }

  const user = db
    .prepare(`SELECT id,email,username,is_admin,is_superadmin FROM users WHERE id = ?`)
    .get(Number(payload.sub)) as any | undefined;

  if (!user) {
    db.prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ?`).run(nowIso(), session.id);
    clearAuthCookies(res);
    return res.status(401).json({ error: "User not found" });
  }

  const newRefresh = signRefreshToken({ sub: String(user.id), sid: session.id });
  const newHash = sha256Hex(newRefresh);
  const newExpiresAt = computeSlidingSessionExpiryIso(String(session.created_at ?? nowIso()));

  db.prepare(
    `
UPDATE sessions
SET refresh_token_hash = ?,last_used_at = ?,expires_at = ?
WHERE id = ?
`
  ).run(newHash, nowIso(), newExpiresAt, session.id);

  const newAccess = signAccessToken({ sub: String(user.id), email: user.email });
  setAuthCookies(res, newAccess, newRefresh);

  return res.json({
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      isAdmin: Boolean(Number(user.is_admin ?? 0)),
      isSuperadmin: Boolean(Number(user.is_superadmin ?? 0)),
    },
  });
});

router.post("/logout", (req: Request, res: Response) => {
  const raw = req.cookies?.[COOKIE_REFRESH];
  if (raw && typeof raw === "string") {
    try {
      const payload = verifyRefreshToken(raw);
      const db = getDb(req);
      db.prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ?`).run(nowIso(), payload.sid);
    } catch {
      // ignore
    }
  }

  clearAuthCookies(res);
  return res.json({ ok: true });
});

export default router;
