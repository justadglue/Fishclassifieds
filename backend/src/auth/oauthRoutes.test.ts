import { test } from "node:test";
import assert from "node:assert/strict";

// IMPORTANT: set env before importing app modules (config reads process.env at import time).
process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "test_access_secret";
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "test_refresh_secret";
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";
process.env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || "http://localhost:5173";

function isoPlusMs(ms: number) {
    return new Date(Date.now() + ms).toISOString();
}

async function loadDeps() {
    const [{ default: express }, { default: Database }, { default: oauthRoutes }] = await Promise.all([
        import("express"),
        import("better-sqlite3"),
        import("./oauthRoutes.js"),
    ]);
    return { express, Database, oauthRoutes };
}

function setupDb(Database: any) {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(`
CREATE TABLE users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  is_superadmin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions(
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  refresh_token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  user_agent TEXT,
  ip TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE oauth_states(
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  intent TEXT NOT NULL,
  next TEXT,
  code_verifier TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  ip TEXT,
  user_agent TEXT
);

CREATE TABLE oauth_pending(
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE oauth_identities(
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);
    return db;
}

async function withServer(express: any, oauthRoutes: any, db: any, fn: (baseUrl: string) => Promise<void>) {
    const app = express();
    app.use(express.json());
    (app as any).locals.db = db;
    app.use("/api/auth/oauth", oauthRoutes);

    const server = await new Promise<import("http").Server>((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });

    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
        await fn(baseUrl);
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}

test("POST /api/auth/oauth/pending/complete creates user + identity + session", async () => {
    const { express, Database, oauthRoutes } = await loadDeps();
    const db = setupDb(Database);
    const state = "state_test_1";

    db.prepare(
        `INSERT INTO oauth_states(state,provider,intent,next,code_verifier,created_at,expires_at,consumed_at,ip,user_agent)
     VALUES(?,?,?,?,?,?,?,NULL,NULL,NULL)`
    ).run(state, "google", "signup", "/me", "verifier", new Date().toISOString(), isoPlusMs(5 * 60_000));

    db.prepare(
        `INSERT INTO oauth_pending(state,provider,provider_user_id,profile_json,created_at,expires_at)
     VALUES(?,?,?,?,?,?)`
    ).run(
        state,
        "google",
        "g_123",
        JSON.stringify({ provider: "google", providerUserId: "g_123", email: null, firstName: "A", lastName: "B" }),
        new Date().toISOString(),
        isoPlusMs(5 * 60_000)
    );

    await withServer(express, oauthRoutes, db, async (baseUrl) => {
        const r = await fetch(`${baseUrl}/api/auth/oauth/pending/complete`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                state,
                email: "newuser@example.com",
                username: "newuser",
                firstName: "New",
                lastName: "User",
            }),
        });
        assert.equal(r.status, 200);
        const json = (await r.json()) as any;
        assert.equal(Boolean(json.ok), true);
        assert.equal(String(json.redirectTo), "http://localhost:5173/me");
    });

    const user = db.prepare(`SELECT id,email,username FROM users WHERE lower(email)=lower(?)`).get("newuser@example.com") as any;
    assert.ok(user?.id);
    assert.equal(user.email, "newuser@example.com");
    assert.equal(user.username, "newuser");

    const ident = db.prepare(`SELECT provider,provider_user_id,user_id FROM oauth_identities WHERE user_id = ?`).get(user.id) as any;
    assert.equal(ident.provider, "google");
    assert.equal(ident.provider_user_id, "g_123");

    const pending = db.prepare(`SELECT state FROM oauth_pending WHERE state = ?`).get(state) as any;
    assert.equal(pending, undefined);

    const sess = db.prepare(`SELECT id FROM sessions WHERE user_id = ?`).get(user.id) as any;
    assert.ok(sess?.id);
});

test("POST /api/auth/oauth/pending/complete blocks existing email (no auto-link)", async () => {
    const { express, Database, oauthRoutes } = await loadDeps();
    const db = setupDb(Database);
    const state = "state_test_2";

    // Existing account already owns this email.
    db.prepare(
        `INSERT INTO users(email,username,first_name,last_name,password_hash,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?)`
    ).run("exists@example.com", "exists", "E", "X", "hash", new Date().toISOString(), new Date().toISOString());

    db.prepare(
        `INSERT INTO oauth_states(state,provider,intent,next,code_verifier,created_at,expires_at,consumed_at,ip,user_agent)
     VALUES(?,?,?,?,?,?,?,NULL,NULL,NULL)`
    ).run(state, "google", "signup", "/me", "verifier", new Date().toISOString(), isoPlusMs(5 * 60_000));

    db.prepare(
        `INSERT INTO oauth_pending(state,provider,provider_user_id,profile_json,created_at,expires_at)
     VALUES(?,?,?,?,?,?)`
    ).run(state, "google", "g_999", JSON.stringify({ provider: "google", providerUserId: "g_999" }), new Date().toISOString(), isoPlusMs(5 * 60_000));

    await withServer(express, oauthRoutes, db, async (baseUrl) => {
        const r = await fetch(`${baseUrl}/api/auth/oauth/pending/complete`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                state,
                email: "exists@example.com",
                username: "newname",
                firstName: "A",
                lastName: "B",
            }),
        });
        assert.equal(r.status, 409);
    });
});

