import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import crypto from "crypto";
import type Database from "better-sqlite3";
import argon2 from "argon2";
import { config } from "../config.js";
import { nowIso, sha256Hex } from "../security.js";
import { signAccessToken, signRefreshToken } from "./jwt.js";
import { clearAuthCookies, setAuthCookies } from "./cookies.js";
import { requireAuth } from "./requireAuth.js";

const router = Router();

type ProviderId = "google";
type Intent = "signin" | "signup" | "delete_account";

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

function isInternalNext(next: string | null): next is string {
    const s = String(next ?? "").trim();
    if (!s) return false;
    if (!s.startsWith("/")) return false;
    if (s.startsWith("//")) return false;
    return true;
}

function base64Url(buf: Buffer) {
    return buf
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

function sha256Base64Url(input: string) {
    const h = crypto.createHash("sha256").update(input).digest();
    return base64Url(h);
}

function ensureProviderConfigured(provider: ProviderId) {
    return Boolean(config.googleClientId && config.googleClientSecret);
}

router.get("/providers", (_req: Request, res: Response) => {
    const providers = {
        google: Boolean(config.googleClientId && config.googleClientSecret),
    };
    return res.json({ ok: true, providers });
});

function appRedirectBase(req: Request) {
    // Prefer explicit PUBLIC_APP_URL; fall back to CORS origin for local dev.
    return String(config.publicAppUrl || config.corsOrigin || "").replace(/\/+$/g, "");
}

function apiBase(req: Request) {
    const proto = req.protocol;
    const host = req.get("host");
    return `${proto}://${host}`;
}

function redirectUri(req: Request, provider: ProviderId) {
    return `${apiBase(req)}/api/auth/oauth/${provider}/callback`;
}

function buildGoogleAuthUrl(req: Request, state: string, codeChallenge: string) {
    const u = new URL(config.googleAuthUrl);
    u.searchParams.set("client_id", config.googleClientId);
    u.searchParams.set("redirect_uri", redirectUri(req, "google"));
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", "openid email profile");
    u.searchParams.set("state", state);
    u.searchParams.set("code_challenge", codeChallenge);
    u.searchParams.set("code_challenge_method", "S256");
    // Let Google show the account picker when the user has multiple accounts.
    u.searchParams.set("prompt", "select_account");
    return u.toString();
}

async function exchangeGoogleCode(req: Request, code: string, codeVerifier: string) {
    const body = new URLSearchParams();
    body.set("client_id", config.googleClientId);
    body.set("client_secret", config.googleClientSecret);
    body.set("code", code);
    body.set("redirect_uri", redirectUri(req, "google"));
    body.set("grant_type", "authorization_code");
    body.set("code_verifier", codeVerifier);

    const resp = await fetch(config.googleTokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
    });
    const json = (await resp.json().catch(() => null)) as any;
    if (!resp.ok) throw new Error(`google_token_exchange_failed:${resp.status}`);
    const accessToken = String(json?.access_token ?? "");
    if (!accessToken) throw new Error("google_missing_access_token");

    const uinfo = await fetch(config.googleUserinfoUrl, {
        headers: { authorization: `Bearer ${accessToken}` },
    });
    const profile = (await uinfo.json().catch(() => null)) as any;
    if (!uinfo.ok) throw new Error(`google_userinfo_failed:${uinfo.status}`);

    return {
        provider: "google" as const,
        providerUserId: String(profile?.sub ?? ""),
        email: profile?.email != null ? String(profile.email) : null,
        emailVerified: profile?.email_verified != null ? Boolean(profile.email_verified) : null,
        firstName: profile?.given_name != null ? String(profile.given_name) : null,
        lastName: profile?.family_name != null ? String(profile.family_name) : null,
        displayName: profile?.name != null ? String(profile.name) : null,
        avatarUrl: profile?.picture != null ? String(profile.picture) : null,
    };
}

function buildLoginErrorRedirect(req: Request, next: string | null, code: string) {
    const base = appRedirectBase(req);
    const u = new URL(`${base}/login`);
    if (isInternalNext(next)) u.searchParams.set("next", next);
    u.searchParams.set("oauthError", code);
    return u.toString();
}

function buildCompleteRedirect(req: Request, state: string) {
    const base = appRedirectBase(req);
    const u = new URL(`${base}/oauth/complete`);
    u.searchParams.set("state", state);
    return u.toString();
}

function buildRedirectToNext(req: Request, next: string | null) {
    const base = appRedirectBase(req);
    if (isInternalNext(next)) return `${base}${next}`;
    return `${base}/`;
}

async function createSessionAndSetCookies(req: Request, res: Response, userRow: any) {
    const db = getDb(req);
    const sessionId = crypto.randomUUID();
    const refreshToken = signRefreshToken({ sub: String(userRow.id), sid: sessionId });
    const refreshHash = sha256Hex(refreshToken);
    const createdAt = nowIso();

    // Same sliding expiry logic as password login (importing it directly would create a circular dep),
    // so we keep a small copy here.
    const DAY_MS = 24 * 60 * 60 * 1000;
    const maxDays = Number.isFinite(config.jwtRefreshMaxTtlDays) && config.jwtRefreshMaxTtlDays > 0 ? config.jwtRefreshMaxTtlDays : config.jwtRefreshTtlDays;
    const slidingDays = Number.isFinite(config.jwtRefreshTtlDays) && config.jwtRefreshTtlDays > 0 ? config.jwtRefreshTtlDays : 30;
    const createdAtMs = Date.parse(createdAt);
    const nowMs = Date.now();
    const slidingExpiryMs = nowMs + slidingDays * DAY_MS;
    const hardCapMs = Number.isFinite(createdAtMs) ? createdAtMs + maxDays * DAY_MS : slidingExpiryMs;
    const expiresAt = new Date(Math.min(slidingExpiryMs, hardCapMs)).toISOString();

    db.prepare(
        `
INSERT INTO sessions(id,user_id,refresh_token_hash,created_at,last_used_at,expires_at,revoked_at,user_agent,ip)
VALUES(?,?,?,?,?,?,NULL,?,?)
`
    ).run(
        sessionId,
        userRow.id,
        refreshHash,
        createdAt,
        createdAt,
        expiresAt,
        req.headers["user-agent"] ?? null,
        getIp(req)
    );

    const accessToken = signAccessToken({ sub: String(userRow.id), email: String(userRow.email), sid: sessionId });
    setAuthCookies(res, accessToken, refreshToken);
}

const StartSchema = z.object({
    intent: z.enum(["signin", "signup"]).default("signin"),
    next: z.string().optional(),
});

router.get("/google/delete-account/start", requireAuth, (req: Request, res: Response) => {
    if (!ensureProviderConfigured("google")) return res.status(400).json({ error: "OAuth provider not configured" });
    const user = req.user!;

    const state = base64Url(crypto.randomBytes(24));
    const codeVerifier = base64Url(crypto.randomBytes(32));
    const codeChallenge = sha256Base64Url(codeVerifier);

    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const ip = getIp(req);
    const ua = (req.headers["user-agent"] ?? null) as any;

    const db = getDb(req);
    db.prepare(
        `
INSERT INTO oauth_states(state,provider,intent,user_id,next,code_verifier,created_at,expires_at,consumed_at,ip,user_agent)
VALUES(?,?,?,?,?,?,?,?,NULL,?,?)
`
    ).run(state, "google", "delete_account", user.id, "/", codeVerifier, createdAt, expiresAt, ip, ua);

    return res.redirect(buildGoogleAuthUrl(req, state, codeChallenge));
});

router.get("/:provider/start", async (req: Request, res: Response) => {
    const provider = String(req.params.provider ?? "").trim().toLowerCase() as ProviderId;
    if (provider !== "google") return res.status(404).send("Not found");
    if (!ensureProviderConfigured(provider)) return res.status(400).json({ error: "OAuth provider not configured" });

    const parsed = StartSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });

    const intent: Intent = parsed.data.intent;
    const next = isInternalNext(parsed.data.next ?? null) ? String(parsed.data.next) : null;

    const state = base64Url(crypto.randomBytes(24));
    const codeVerifier = base64Url(crypto.randomBytes(32));
    const codeChallenge = sha256Base64Url(codeVerifier);

    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const ip = getIp(req);
    const ua = (req.headers["user-agent"] ?? null) as any;

    const db = getDb(req);
    db.prepare(
        `
INSERT INTO oauth_states(state,provider,intent,user_id,next,code_verifier,created_at,expires_at,consumed_at,ip,user_agent)
VALUES(?,?,?,?,?,?,?,?,?,?,?)
`
    ).run(state, provider, intent, null, next, codeVerifier, createdAt, expiresAt, null, ip, ua);

    return res.redirect(buildGoogleAuthUrl(req, state, codeChallenge));
});

router.get("/:provider/callback", async (req: Request, res: Response) => {
    const provider = String(req.params.provider ?? "").trim().toLowerCase() as ProviderId;
    if (provider !== "google") return res.status(404).send("Not found");
    if (!ensureProviderConfigured(provider)) return res.status(400).json({ error: "OAuth provider not configured" });

    const state = String((req.query as any)?.state ?? "").trim();
    const providerErr = String((req.query as any)?.error ?? "").trim();
    if (providerErr) {
        // Common: user cancels at the provider (e.g. Google returns error=access_denied).
        const code = providerErr.toLowerCase().includes("denied") ? "OAUTH_DENIED" : "OAUTH_PROVIDER_ERROR";
        let next: string | null = null;
        if (state) {
            try {
                const db = getDb(req);
                const row = db
                    .prepare(
                        `
SELECT next
FROM oauth_states
WHERE state = ?
  AND provider = ?
LIMIT 1
`
                    )
                    .get(state, provider) as any | undefined;
                next = row?.next != null ? String(row.next) : null;
            } catch {
                // ignore
            }
        }
        return res.redirect(buildLoginErrorRedirect(req, next, code));
    }

    const code = String((req.query as any)?.code ?? "").trim();

    if (!code || !state) {
        return res.redirect(buildLoginErrorRedirect(req, null, "OAUTH_MISSING_CODE"));
    }

    const db = getDb(req);
    const row = db
        .prepare(
            `
SELECT state,provider,intent,user_id,next,code_verifier,expires_at,consumed_at
FROM oauth_states
WHERE state = ?
LIMIT 1
`
        )
        .get(state) as any | undefined;

    if (!row) return res.redirect(buildLoginErrorRedirect(req, null, "OAUTH_STATE_NOT_FOUND"));
    if (String(row.provider) !== provider) return res.redirect(buildLoginErrorRedirect(req, row.next ?? null, "OAUTH_STATE_MISMATCH"));
    if (row.consumed_at) return res.redirect(buildLoginErrorRedirect(req, row.next ?? null, "OAUTH_STATE_CONSUMED"));
    const expMs = Date.parse(String(row.expires_at ?? ""));
    if (!Number.isFinite(expMs) || expMs <= Date.now()) return res.redirect(buildLoginErrorRedirect(req, row.next ?? null, "OAUTH_STATE_EXPIRED"));

    // Mark consumed early to prevent replays (best-effort).
    try {
        db.prepare(`UPDATE oauth_states SET consumed_at = COALESCE(consumed_at, ?) WHERE state = ?`).run(nowIso(), state);
    } catch {
        // ignore
    }

    let profile:
        | {
            provider: ProviderId;
            providerUserId: string;
            email: string | null;
            emailVerified: boolean | null;
            firstName: string | null;
            lastName: string | null;
            displayName: string | null;
            avatarUrl: string | null;
        }
        | null = null;

    try {
        profile = await exchangeGoogleCode(req, code, String(row.code_verifier));
    } catch {
        return res.redirect(buildLoginErrorRedirect(req, row.next ?? null, "OAUTH_EXCHANGE_FAILED"));
    }

    if (!profile?.providerUserId) return res.redirect(buildLoginErrorRedirect(req, row.next ?? null, "OAUTH_PROFILE_INVALID"));

    if (String(row.intent) === "delete_account") {
        // Find the linked user for this Google identity.
        const ident = db
            .prepare(`SELECT user_id FROM oauth_identities WHERE provider = ? AND provider_user_id = ? LIMIT 1`)
            .get(profile.provider, profile.providerUserId) as any | undefined;
        const linkedUserId = ident?.user_id != null ? Number(ident.user_id) : NaN;
        const requestedUserId = row.user_id != null ? Number(row.user_id) : NaN;

        if (!Number.isFinite(linkedUserId) || !Number.isFinite(requestedUserId) || linkedUserId !== requestedUserId) {
            clearAuthCookies(res);
            return res.redirect(buildLoginErrorRedirect(req, "/", "OAUTH_PROVIDER_ERROR"));
        }

        // Perform deletion (no password; Google reauth is the confirmation).
        try {
            const u = db.prepare(`SELECT id,email,username FROM users WHERE id = ?`).get(linkedUserId) as any | undefined;
            if (u) {
                const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
                const now = nowIso();
                const tx = db.transaction(() => {
                    db.prepare(`INSERT INTO deleted_accounts(user_id,email_hash,username_hash,deleted_at,reason) VALUES(?,?,?,?,?)`).run(
                        Number(u.id),
                        sha256Hex(norm(u.email)),
                        sha256Hex(norm(u.username)),
                        now,
                        null
                    );
                    db.prepare(`DELETE FROM oauth_identities WHERE user_id = ?`).run(Number(u.id));
                    db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(Number(u.id));
                    db.prepare(`DELETE FROM users WHERE id = ?`).run(Number(u.id));
                });
                tx();
            }
        } catch {
            // ignore
        }

        clearAuthCookies(res);
        return res.redirect(buildRedirectToNext(req, "/"));
    }

    // Existing identity -> login immediately.
    const existingIdentity = db
        .prepare(
            `
SELECT oi.user_id as user_id
FROM oauth_identities oi
WHERE oi.provider = ?
  AND oi.provider_user_id = ?
LIMIT 1
`
        )
        .get(profile.provider, profile.providerUserId) as any | undefined;

    if (existingIdentity?.user_id != null) {
        const user = db
            .prepare(`SELECT id,email,username,is_admin,is_superadmin FROM users WHERE id = ?`)
            .get(Number(existingIdentity.user_id)) as any | undefined;
        if (!user) {
            // Stale link (e.g. account was deleted but oauth_identities row remains in an older DB without FK cascades).
            // Treat this as "account doesn't exist" and require signup again.
            try {
                db.prepare(`DELETE FROM oauth_identities WHERE provider = ? AND provider_user_id = ?`).run(profile.provider, profile.providerUserId);
            } catch {
                // ignore
            }
            // Continue as if no identity existed: create a pending record and redirect to complete signup.
        } else {
            await createSessionAndSetCookies(req, res, user);
            return res.redirect(buildRedirectToNext(req, row.next ?? null));
        }
    }

    // If provider supplied an email and it already exists, do NOT auto-link.
    const normEmail = profile.email != null ? String(profile.email).toLowerCase().trim() : null;
    if (normEmail) {
        const existingUser = db.prepare(`SELECT id FROM users WHERE lower(email)= lower(?)`).get(normEmail) as any | undefined;
        if (existingUser?.id != null) {
            return res.redirect(buildLoginErrorRedirect(req, row.next ?? null, "OAUTH_EMAIL_EXISTS"));
        }
    }

    // Create a pending record so the frontend can collect required fields (email/username/names).
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const profileJson = JSON.stringify({
        provider: profile.provider,
        providerUserId: profile.providerUserId,
        email: normEmail,
        firstName: profile.firstName,
        lastName: profile.lastName,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
    });

    try {
        db.prepare(`DELETE FROM oauth_pending WHERE state = ?`).run(state);
    } catch {
        // ignore
    }

    db.prepare(
        `
INSERT INTO oauth_pending(state,provider,provider_user_id,profile_json,created_at,expires_at)
VALUES(?,?,?,?,?,?)
`
    ).run(state, provider, profile.providerUserId, profileJson, createdAt, expiresAt);

    return res.redirect(buildCompleteRedirect(req, state));
});

const PendingCompleteSchema = z.object({
    state: z.string().min(8).max(512),
    email: z.string().email().max(320),
    username: z
        .string()
        .min(3)
        .max(20)
        .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters,numbers,and underscore"),
    firstName: z.string().min(1).max(80),
    lastName: z.string().min(1).max(80),
});

router.post("/pending/complete", async (req: Request, res: Response) => {
    const parsed = PendingCompleteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });

    const db = getDb(req);
    const state = parsed.data.state.trim();
    const normEmail = parsed.data.email.toLowerCase().trim();
    const normUsername = parsed.data.username.toLowerCase().trim();
    const firstName = parsed.data.firstName.trim();
    const lastName = parsed.data.lastName.trim();

    const stateRow = db
        .prepare(
            `
SELECT provider,next,expires_at
FROM oauth_states
WHERE state = ?
LIMIT 1
`
        )
        .get(state) as any | undefined;

    if (!stateRow) return res.status(400).json({ error: "Invalid or expired OAuth state" });
    const expMs = Date.parse(String(stateRow.expires_at ?? ""));
    if (!Number.isFinite(expMs) || expMs <= Date.now()) return res.status(400).json({ error: "Invalid or expired OAuth state" });

    const pendingRow = db
        .prepare(
            `
SELECT provider,provider_user_id,profile_json,expires_at
FROM oauth_pending
WHERE state = ?
LIMIT 1
`
        )
        .get(state) as any | undefined;
    if (!pendingRow) return res.status(400).json({ error: "OAuth signup not found or already completed" });
    const pendExpMs = Date.parse(String(pendingRow.expires_at ?? ""));
    if (!Number.isFinite(pendExpMs) || pendExpMs <= Date.now()) return res.status(400).json({ error: "OAuth signup expired" });

    // No auto-link: if email exists, block.
    const existingEmail = db.prepare(`SELECT id FROM users WHERE lower(email)= lower(?)`).get(normEmail) as any | undefined;
    if (existingEmail?.id != null) return res.status(409).json({ error: "Email already in use" });

    const existingUsername = db.prepare(`SELECT id FROM users WHERE lower(username)= lower(?)`).get(normUsername) as any | undefined;
    if (existingUsername?.id != null) return res.status(409).json({ error: "Username already in use" });

    // Create a random password hash so password-login will always fail unless you later implement "set password".
    const randomSecret = crypto.randomBytes(32).toString("hex");
    const passwordHash = await argon2.hash(randomSecret, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });

    const createdAt = nowIso();
    const tx = db.transaction(() => {
        const info = db
            .prepare(
                `
INSERT INTO users(email,username,first_name,last_name,password_hash,created_at,updated_at)
VALUES(?,?,?,?,?,?,?)
`
            )
            .run(normEmail, normUsername, firstName, lastName, passwordHash, createdAt, createdAt);

        const userId = Number(info.lastInsertRowid);

        db.prepare(
            `
INSERT INTO oauth_identities(id,provider,provider_user_id,user_id,email,created_at,updated_at)
VALUES(?,?,?,?,?,?,?)
`
        ).run(crypto.randomUUID(), String(pendingRow.provider), String(pendingRow.provider_user_id), userId, normEmail, createdAt, createdAt);

        db.prepare(`DELETE FROM oauth_pending WHERE state = ?`).run(state);
        return userId;
    });

    let userId: number;
    try {
        userId = tx();
    } catch {
        return res.status(400).json({ error: "Failed to complete OAuth signup" });
    }

    const user = db.prepare(`SELECT id,email,username,is_admin,is_superadmin FROM users WHERE id = ?`).get(userId) as any | undefined;
    if (!user) return res.status(400).json({ error: "User not found" });

    await createSessionAndSetCookies(req, res, user);
    const redirectTo = buildRedirectToNext(req, stateRow.next ?? null);

    return res.json({
        ok: true,
        redirectTo,
        user: { id: user.id, email: user.email, username: user.username, isAdmin: Boolean(Number(user.is_admin ?? 0)), isSuperadmin: Boolean(Number(user.is_superadmin ?? 0)) },
    });
});

// Helper endpoint: fetch pending profile to prefill fields.
router.get("/pending/:state", (req: Request, res: Response) => {
    const state = String(req.params.state ?? "").trim();
    if (!state) return res.status(400).json({ error: "Missing state" });
    const db = getDb(req);
    const pendingRow = db
        .prepare(
            `
SELECT profile_json,expires_at
FROM oauth_pending
WHERE state = ?
LIMIT 1
`
        )
        .get(state) as any | undefined;
    if (!pendingRow) return res.status(404).json({ error: "Not found" });
    const pendExpMs = Date.parse(String(pendingRow.expires_at ?? ""));
    if (!Number.isFinite(pendExpMs) || pendExpMs <= Date.now()) return res.status(400).json({ error: "OAuth signup expired" });

    let profile: any = null;
    try {
        profile = JSON.parse(String(pendingRow.profile_json ?? "{}"));
    } catch {
        profile = null;
    }

    return res.json({ ok: true, profile });
});

export default router;

