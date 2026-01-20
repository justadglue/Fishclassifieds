import type { Request } from "express";
import { Router } from "express";
import type Database from "better-sqlite3";
import crypto from "crypto";
import { z } from "zod";
import { nowIso } from "../security.js";
import { requireAuth } from "../auth/requireAuth.js";
import { requireAdmin, requireSuperadmin } from "./requireAdmin.js";

const router = Router();

function getDb(req: Request): Database.Database {
  const db = (req.app as any)?.locals?.db as Database.Database | undefined;
  if (!db) throw new Error("DB not available on app.locals.db");
  return db;
}

function audit(db: Database.Database, actorUserId: number, action: string, targetKind: string, targetId: string, meta: any) {
  try {
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO admin_audit(id,actor_user_id,action,target_kind,target_id,meta_json,created_at)
       VALUES(?,?,?,?,?,?,?)`
    ).run(id, actorUserId, action, targetKind, targetId, meta == null ? null : JSON.stringify(meta), nowIso());
  } catch {
    // Best-effort; ignore.
  }
}

router.use(requireAuth);
router.use(requireAdmin);

// --- Approvals ---
router.get("/approvals", (req, res) => {
  const kindRaw = String(req.query.kind ?? "all").trim();
  const kind = kindRaw === "sale" || kindRaw === "wanted" ? kindRaw : "all";

  const db = getDb(req);
  const where: string[] = [`l.status = 'pending'`];
  const params: any[] = [];
  if (kind === "sale") where.push(`l.listing_type = 0`);
  if (kind === "wanted") where.push(`l.listing_type = 1`);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = db
    .prepare(
      `
SELECT l.id,l.listing_type,l.title,l.category,l.location,l.created_at,l.updated_at,
       l.wanted_status,
       u.id as user_id,u.username as user_username,u.email as user_email
FROM listings l
JOIN users u ON u.id = l.user_id
${whereSql}
ORDER BY l.created_at DESC, l.id DESC
LIMIT 500
`
    )
    .all(...params) as any[];

  const items = rows.map((r) => ({
    kind: Number(r.listing_type) === 1 ? ("wanted" as const) : ("sale" as const),
    id: String(r.id),
    title: String(r.title ?? ""),
    category: String(r.category ?? ""),
    location: String(r.location ?? ""),
    wantedStatus: Number(r.listing_type) === 1 ? String(r.wanted_status ?? "open") : null,
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
    user: {
      id: Number(r.user_id),
      username: String(r.user_username ?? ""),
      email: String(r.user_email ?? ""),
    },
  }));

  return res.json({ items });
});

router.post("/approvals/:kind/:id/approve", (req, res) => {
  const kind = String(req.params.kind ?? "").trim();
  const id = String(req.params.id ?? "").trim();
  if (kind !== "sale" && kind !== "wanted") return res.status(400).json({ error: "Invalid kind" });
  if (!id) return res.status(400).json({ error: "Missing id" });

  const db = getDb(req);
  const lt = kind === "sale" ? 0 : 1;
  const row = db.prepare(`SELECT id,status FROM listings WHERE id = ? AND listing_type = ?`).get(id, lt) as any | undefined;
  if (!row) return res.status(404).json({ error: "Not found" });

  const now = nowIso();
  db.prepare(`UPDATE listings SET status = 'active', updated_at = ? WHERE id = ? AND listing_type = ?`).run(now, id, lt);
  audit(db, req.user!.id, "approve", kind, id, { prevStatus: row.status });
  return res.json({ ok: true });
});

const RejectSchema = z.object({ note: z.string().max(500).optional().nullable() });
router.post("/approvals/:kind/:id/reject", (req, res) => {
  const kind = String(req.params.kind ?? "").trim();
  const id = String(req.params.id ?? "").trim();
  if (kind !== "sale" && kind !== "wanted") return res.status(400).json({ error: "Invalid kind" });
  if (!id) return res.status(400).json({ error: "Missing id" });
  const parsed = RejectSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });

  const db = getDb(req);
  const lt = kind === "sale" ? 0 : 1;
  const row = db.prepare(`SELECT id,status FROM listings WHERE id = ? AND listing_type = ?`).get(id, lt) as any | undefined;
  if (!row) return res.status(404).json({ error: "Not found" });

  const now = nowIso();
  db.prepare(`UPDATE listings SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ? AND listing_type = ?`).run(now, now, id, lt);
  audit(db, req.user!.id, "reject", kind, id, { prevStatus: row.status, note: parsed.data.note ?? null });
  return res.json({ ok: true });
});

// --- Reports ---
router.get("/reports", (req, res) => {
  const statusRaw = String(req.query.status ?? "open").trim();
  const status = statusRaw === "resolved" ? "resolved" : "open";

  const db = getDb(req);
  const rows = db
    .prepare(
      `
SELECT r.*,
       u.username as reporter_username,u.email as reporter_email
FROM reports r
JOIN users u ON u.id = r.reporter_user_id
WHERE r.status = ?
ORDER BY r.created_at DESC
LIMIT 500
`
    )
    .all(status) as any[];

  const items = rows.map((r) => ({
    id: String(r.id),
    status: String(r.status),
    targetKind: String(r.target_kind),
    targetId: String(r.target_id),
    reason: String(r.reason),
    details: r.details ? String(r.details) : "",
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    reporter: { userId: Number(r.reporter_user_id), username: String(r.reporter_username ?? ""), email: String(r.reporter_email ?? "") },
    resolvedByUserId: r.resolved_by_user_id != null ? Number(r.resolved_by_user_id) : null,
    resolvedNote: r.resolved_note != null ? String(r.resolved_note) : null,
  }));

  return res.json({ items });
});

router.get("/reports/:id", (req, res) => {
  const id = String(req.params.id ?? "").trim();
  if (!id) return res.status(400).json({ error: "Missing id" });
  const db = getDb(req);
  const r = db
    .prepare(
      `
SELECT r.*,
       u.username as reporter_username,u.email as reporter_email
FROM reports r
JOIN users u ON u.id = r.reporter_user_id
WHERE r.id = ?
`
    )
    .get(id) as any | undefined;
  if (!r) return res.status(404).json({ error: "Not found" });
  return res.json({
    item: {
      id: String(r.id),
      status: String(r.status),
      targetKind: String(r.target_kind),
      targetId: String(r.target_id),
      reason: String(r.reason),
      details: r.details ? String(r.details) : "",
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      reporter: { userId: Number(r.reporter_user_id), username: String(r.reporter_username ?? ""), email: String(r.reporter_email ?? "") },
      resolvedByUserId: r.resolved_by_user_id != null ? Number(r.resolved_by_user_id) : null,
      resolvedNote: r.resolved_note != null ? String(r.resolved_note) : null,
    },
  });
});

const ResolveReportSchema = z.object({ note: z.string().max(800).optional().nullable() });
router.post("/reports/:id/resolve", (req, res) => {
  const id = String(req.params.id ?? "").trim();
  if (!id) return res.status(400).json({ error: "Missing id" });
  const parsed = ResolveReportSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });

  const db = getDb(req);
  const row = db.prepare(`SELECT id,status FROM reports WHERE id = ?`).get(id) as any | undefined;
  if (!row) return res.status(404).json({ error: "Not found" });

  const now = nowIso();
  db.prepare(
    `UPDATE reports
     SET status='resolved', resolved_by_user_id = ?, resolved_note = ?, updated_at = ?
     WHERE id = ?`
  ).run(req.user!.id, parsed.data.note ?? null, now, id);

  audit(db, req.user!.id, "resolve_report", "report", id, { prevStatus: row.status, note: parsed.data.note ?? null });
  return res.json({ ok: true });
});

// --- Users (superadmin only) ---
router.get("/users", requireSuperadmin, (req, res) => {
  const q = String(req.query.query ?? "").trim().toLowerCase();
  const limitRaw = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw!))) : 50;
  const offsetRaw = req.query.offset !== undefined ? Number(req.query.offset) : undefined;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw!)) : 0;

  const db = getDb(req);
  const where: string[] = [];
  const params: any[] = [];
  if (q) {
    where.push(`(lower(email) LIKE ? OR lower(username) LIKE ?)`);
    params.push(`%${q}%`, `%${q}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const totalRow = db.prepare(`SELECT COUNT(*) as c FROM users ${whereSql}`).get(...params) as any;
  const total = Number(totalRow?.c ?? 0);

  const rows = db
    .prepare(
      `
SELECT id,email,username,is_admin,is_superadmin,created_at,updated_at
FROM users
${whereSql}
ORDER BY id DESC
LIMIT ? OFFSET ?
`
    )
    .all(...params, limit, offset) as any[];

  return res.json({
    items: rows.map((u) => ({
      id: Number(u.id),
      email: String(u.email),
      username: String(u.username),
      isAdmin: Boolean(Number(u.is_admin ?? 0)),
      isSuperadmin: Boolean(Number(u.is_superadmin ?? 0)),
      createdAt: String(u.created_at ?? ""),
      updatedAt: String(u.updated_at ?? ""),
    })),
    total,
    limit,
    offset,
  });
});

const SetAdminSchema = z.object({ isAdmin: z.boolean() });
router.post("/users/:id/set-admin", requireSuperadmin, (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: "Invalid user id" });
  const parsed = SetAdminSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });

  const db = getDb(req);
  const row = db.prepare(`SELECT id,is_admin,is_superadmin FROM users WHERE id = ?`).get(userId) as any | undefined;
  if (!row) return res.status(404).json({ error: "User not found" });

  db.prepare(`UPDATE users SET is_admin = ?, updated_at = ? WHERE id = ?`).run(parsed.data.isAdmin ? 1 : 0, nowIso(), userId);
  audit(db, req.user!.id, "set_admin", "user", String(userId), { prevIsAdmin: row.is_admin, nextIsAdmin: parsed.data.isAdmin });
  return res.json({ ok: true });
});

const SetSuperSchema = z.object({ isSuperadmin: z.boolean() });
router.post("/users/:id/set-superadmin", requireSuperadmin, (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: "Invalid user id" });
  const parsed = SetSuperSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });

  const db = getDb(req);
  const row = db.prepare(`SELECT id,is_superadmin FROM users WHERE id = ?`).get(userId) as any | undefined;
  if (!row) return res.status(404).json({ error: "User not found" });

  if (!parsed.data.isSuperadmin) {
    const cRow = db.prepare(`SELECT COUNT(*) as c FROM users WHERE is_superadmin = 1`).get() as any;
    const c = Number(cRow?.c ?? 0);
    if (c <= 1 && Number(row.is_superadmin ?? 0) === 1) {
      return res.status(400).json({ error: "Cannot remove the last superadmin" });
    }
  }

  // Superadmins are implicitly admins too.
  const nextSuper = parsed.data.isSuperadmin ? 1 : 0;
  const nextAdmin = parsed.data.isSuperadmin ? 1 : undefined;
  const now = nowIso();
  if (nextAdmin === 1) db.prepare(`UPDATE users SET is_superadmin = 1, is_admin = 1, updated_at = ? WHERE id = ?`).run(now, userId);
  else db.prepare(`UPDATE users SET is_superadmin = ?, updated_at = ? WHERE id = ?`).run(nextSuper, now, userId);

  audit(db, req.user!.id, "set_superadmin", "user", String(userId), { prevIsSuperadmin: row.is_superadmin, nextIsSuperadmin: parsed.data.isSuperadmin });
  return res.json({ ok: true });
});

export default router;

