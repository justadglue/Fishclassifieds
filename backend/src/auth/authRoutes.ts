import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import argon2 from "argon2";
import crypto from "crypto";
import { openDb } from "../db.js";
import { sha256Hex, nowIso, addDaysIso } from "../security.js";
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
  password: z.string().min(10).max(200),
  displayName: z.string().min(1).max(80),
});

const LoginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
});

function getIp(req: Request) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) return xf.split(",")[0].trim();
  return req.socket.remoteAddress ?? null;
}

router.post("/register", async (req: Request, res: Response) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const { email, username, password, displayName } = parsed.data;
  const normEmail = email.toLowerCase().trim();
  const normUsername = username.toLowerCase().trim();

  const db = openDb();

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
      INSERT INTO users(email,username,password_hash,display_name,created_at,updated_at)
      VALUES(?,?,?,?,?,?)
      `
    )
    .run(normEmail, normUsername, passwordHash, displayName, nowIso(), nowIso());

  const userId = Number(info.lastInsertRowid);
  return res.status(201).json({
    user: { id: userId, email: normEmail, displayName, username: normUsername },
  });
});

router.post("/login", async (req: Request, res: Response) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const { email, password } = parsed.data;

  const db = openDb();
  const row = db
    .prepare(`SELECT * FROM users WHERE lower(email)= lower(?)`)
    .get(email.toLowerCase().trim()) as any | undefined;

  if (!row) return res.status(401).json({ error: "Invalid email or password" });

  const ok = await argon2.verify(row.password_hash, password);
  if (!ok) return res.status(401).json({ error: "Invalid email or password" });

  const sessionId = crypto.randomUUID();
  const refreshToken = signRefreshToken({ sub: String(row.id), sid: sessionId });
  const refreshHash = sha256Hex(refreshToken);

  db.prepare(
    `
    INSERT INTO sessions(id,user_id,refresh_token_hash,created_at,last_used_at,expires_at,revoked_at,user_agent,ip)
    VALUES(?,?,?,?,?,?,NULL,?,?)
    `
  ).run(
    sessionId,
    row.id,
    refreshHash,
    nowIso(),
    nowIso(),
    addDaysIso(Number(process.env.JWT_REFRESH_TTL_DAYS ?? 30)),
    req.headers["user-agent"] ?? null,
    getIp(req)
  );

  const accessToken = signAccessToken({ sub: String(row.id), email: row.email });
  setAuthCookies(res, accessToken, refreshToken);

  return res.json({
    user: { id: row.id, email: row.email, displayName: row.display_name, username: row.username },
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

  const db = openDb();
  const session = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(payload.sid) as any | undefined;
  if (!session) {
    clearAuthCookies(res);
    return res.status(401).json({ error: "Session not found" });
  }
  if (session.revoked_at) {
    clearAuthCookies(res);
    return res.status(401).json({ error: "Session revoked" });
  }
  if (new Date(session.expires_at).getTime() <= Date.now()) {
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
    .prepare(`SELECT id,email,username,display_name FROM users WHERE id = ?`)
    .get(Number(payload.sub)) as any | undefined;

  if (!user) {
    db.prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ?`).run(nowIso(), session.id);
    clearAuthCookies(res);
    return res.status(401).json({ error: "User not found" });
  }

  const newRefresh = signRefreshToken({ sub: String(user.id), sid: session.id });
  const newHash = sha256Hex(newRefresh);

  db.prepare(
    `
    UPDATE sessions
    SET refresh_token_hash = ?,last_used_at = ?
    WHERE id = ?
    `
  ).run(newHash, nowIso(), session.id);

  const newAccess = signAccessToken({ sub: String(user.id), email: user.email });
  setAuthCookies(res, newAccess, newRefresh);

  return res.json({
    user: { id: user.id, email: user.email, displayName: user.display_name, username: user.username },
  });
});

router.post("/logout", (req: Request, res: Response) => {
  const raw = req.cookies?.[COOKIE_REFRESH];
  if (raw && typeof raw === "string") {
    try {
      const payload = verifyRefreshToken(raw);
      const db = openDb();
      db.prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ?`).run(nowIso(), payload.sid);
    } catch {
      // ignore
    }
  }
  clearAuthCookies(res);
  return res.json({ ok: true });
});

export default router;
