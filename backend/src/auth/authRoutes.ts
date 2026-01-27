import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import argon2 from "argon2";
import crypto from "crypto";
import type Database from "better-sqlite3";
import { sha256Hex, nowIso } from "../security.js";
import { config } from "../config.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken, signReauthToken } from "./jwt.js";
import { clearAuthCookies, setAuthCookies, setReauthCookie, COOKIE_REFRESH } from "./cookies.js";
import { requireAuth } from "./requireAuth.js";

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

const ReauthSchema = z.object({
  password: z.string().min(1).max(200),
});

const ForgotPasswordSchema = z.object({
  email: z.string().email().max(320),
});

const ResetPasswordSchema = z.object({
  email: z.string().email().max(320),
  token: z.string().min(16).max(512),
  newPassword: z.string().min(10).max(200),
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
const HOUR_MS = 60 * 60 * 1000;

function nowMsIso() {
  return new Date().toISOString();
}

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

function logPasswordResetLinkDev(link: string) {
  if ((config.nodeEnv ?? "development") === "production") return;
  // Temporary delivery mechanism until email infra is configured.
  console.log(`[dev] password reset link: ${link}`);
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

router.post("/forgot-password", async (req: Request, res: Response) => {
  const parsed = ForgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });

  const db = getDb(req);
  const normEmail = parsed.data.email.toLowerCase().trim();
  const ip = getIp(req);
  const ua = (req.headers["user-agent"] ?? null) as any;

  // Throttle: best-effort per IP and per user (if user exists). Always respond generically.
  const windowStartIso = new Date(Date.now() - HOUR_MS).toISOString();
  try {
    const ipCountRow = db
      .prepare(
        `
SELECT COUNT(*) as c
FROM password_reset_tokens
WHERE created_at >= ?
  AND ip IS NOT NULL
  AND ip = ?
`
      )
      .get(windowStartIso, ip) as any;
    const ipCount = Number(ipCountRow?.c ?? 0);
    if (Number.isFinite(ipCount) && ipCount >= 10) {
      return res.json({ ok: true });
    }
  } catch {
    // ignore throttling failures
  }

  const userRow = db.prepare(`SELECT id,email FROM users WHERE lower(email)= lower(?)`).get(normEmail) as any | undefined;
  const userId = userRow?.id != null ? Number(userRow.id) : null;

  try {
    if (userId != null && Number.isFinite(userId)) {
      const userCountRow = db
        .prepare(
          `
SELECT COUNT(*) as c
FROM password_reset_tokens
WHERE created_at >= ?
  AND user_id = ?
`
        )
        .get(windowStartIso, userId) as any;
      const userCount = Number(userCountRow?.c ?? 0);
      if (Number.isFinite(userCount) && userCount >= 3) {
        return res.json({ ok: true });
      }
    }
  } catch {
    // ignore
  }

  const createdAt = nowIso();

  // If user doesn't exist, still write a tombstone row for IP throttling (no enumeration).
  if (userId == null || !Number.isFinite(userId)) {
    try {
      const tid = crypto.randomUUID();
      const tokenHash = sha256Hex(crypto.randomBytes(32).toString("hex"));
      db.prepare(
        `
INSERT INTO password_reset_tokens(id,user_id,token_hash,expires_at,used_at,created_at,ip,user_agent)
VALUES(?,?,?,?,?,?,?,?)
`
      ).run(tid, null, tokenHash, createdAt, createdAt, createdAt, ip, ua);
    } catch {
      // ignore
    }
    return res.json({ ok: true });
  }

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const tokenId = crypto.randomUUID();

  try {
    // Invalidate any previous un-used tokens for this user (best-effort).
    db.prepare(`UPDATE password_reset_tokens SET used_at = COALESCE(used_at, ?) WHERE user_id = ? AND used_at IS NULL`).run(createdAt, userId);
  } catch {
    // ignore
  }

  db.prepare(
    `
INSERT INTO password_reset_tokens(id,user_id,token_hash,expires_at,used_at,created_at,ip,user_agent)
VALUES(?,?,?,?,NULL,?,?,?)
`
  ).run(tokenId, userId, tokenHash, expiresAt, createdAt, ip, ua);

  const link = `${config.corsOrigin}/reset-password?email=${encodeURIComponent(normEmail)}&token=${encodeURIComponent(rawToken)}`;
  logPasswordResetLinkDev(link);
  return res.json({ ok: true });
});

router.post("/reset-password", async (req: Request, res: Response) => {
  const parsed = ResetPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });

  const db = getDb(req);
  const email = parsed.data.email.toLowerCase().trim();
  const tokenHash = sha256Hex(String(parsed.data.token ?? "").trim());

  const now = nowIso();
  const nowT = Date.parse(now);

  const row = db
    .prepare(
      `
SELECT prt.id as token_id,
       prt.user_id as user_id,
       prt.used_at as used_at,
       prt.expires_at as expires_at,
       u.email as email
FROM password_reset_tokens prt
JOIN users u ON u.id = prt.user_id
WHERE prt.token_hash = ?
LIMIT 1
`
    )
    .get(tokenHash) as any | undefined;

  if (!row) return res.status(400).json({ error: "Invalid or expired reset link" });
  if (String(row.email ?? "").toLowerCase().trim() !== email) return res.status(400).json({ error: "Invalid or expired reset link" });
  if (row.used_at) return res.status(400).json({ error: "Invalid or expired reset link" });
  const expMs = Date.parse(String(row.expires_at ?? ""));
  if (!Number.isFinite(expMs) || (Number.isFinite(nowT) && expMs <= nowT)) return res.status(400).json({ error: "Invalid or expired reset link" });

  const userId = Number(row.user_id);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: "Invalid or expired reset link" });

  const passwordHash = await argon2.hash(parsed.data.newPassword, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const tx = db.transaction(() => {
    db.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`).run(passwordHash, now, userId);
    db.prepare(`UPDATE password_reset_tokens SET used_at = ? WHERE id = ?`).run(now, String(row.token_id));
    // Revoke all sessions so the user must re-login everywhere.
    db.prepare(`UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ?`).run(now, userId);
  });

  try {
    tx();
  } catch {
    return res.status(400).json({ error: "Failed to reset password" });
  }

  // Best-effort: clear any auth cookies if present in this browser session.
  clearAuthCookies(res);
  return res.json({ ok: true });
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

  // Block login for banned/suspended users with a clear message + reason.
  // (This is more user-friendly than failing later on authenticated endpoints.)
  const mod = db
    .prepare(`SELECT status, reason, suspended_until FROM user_moderation WHERE user_id = ?`)
    .get(Number(row.id)) as any | undefined;

  const modStatus = mod?.status ? String(mod.status) : "active";
  const modReason = mod?.reason != null ? String(mod.reason) : null;
  const suspendedUntil = mod?.suspended_until != null ? Number(mod.suspended_until) : null;

  if (modStatus === "banned") {
    return res.status(403).json({ error: "Account banned", code: "ACCOUNT_BANNED", reason: modReason });
  }

  if (modStatus === "suspended") {
    // If no until is provided, treat as indefinite suspension.
    if (suspendedUntil == null || suspendedUntil > Date.now()) {
      return res.status(403).json({
        error: "Account suspended",
        code: "ACCOUNT_SUSPENDED",
        reason: modReason,
        suspendedUntil,
      });
    }
    // Auto-clear expired suspensions.
    try {
      db.prepare(`UPDATE user_moderation SET status='active', reason=NULL, suspended_until=NULL, updated_at=? WHERE user_id = ?`).run(nowIso(), Number(row.id));
    } catch {
      // ignore
    }
  }

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

  const accessToken = signAccessToken({ sub: String(row.id), email: row.email, sid: sessionId });
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

  const newAccess = signAccessToken({ sub: String(user.id), email: user.email, sid: session.id });
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

router.post("/reauth", requireAuth, async (req: Request, res: Response) => {
  const parsed = ReauthSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });

  const db = getDb(req);
  const row = db.prepare(`SELECT id,password_hash FROM users WHERE id = ?`).get(req.user!.id) as any | undefined;
  if (!row) return res.status(401).json({ error: "User not found" });

  const ok = await argon2.verify(String(row.password_hash ?? ""), parsed.data.password);
  if (!ok) return res.status(401).json({ error: "Invalid password" });

  const ttlSeconds = 10 * 60;
  const token = signReauthToken({ sub: String(req.user!.id), sid: String(req.user!.sid) }, ttlSeconds);
  setReauthCookie(res, token, ttlSeconds);
  return res.json({ ok: true, expiresInSec: ttlSeconds });
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
