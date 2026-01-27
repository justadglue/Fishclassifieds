import type { Request } from "express";
import { Router } from "express";
import type Database from "better-sqlite3";
import crypto from "crypto";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { nowIso } from "../security.js";
import { requireAuth } from "../auth/requireAuth.js";
import { requireAdmin, requireSuperadmin } from "./requireAdmin.js";
import { requireReauth } from "./requireReauth.js";
import { decryptSecret, encryptSecret } from "../llm/secretBox.js";
import { generatePopularSearchesOpenAI } from "../llm/openai.js";
import { generatePopularSearchesGemini } from "../llm/gemini.js";
import type { PopularSearchCandidate } from "../llm/types.js";
import { DEFAULT_POPULAR_SEARCHES_META_PROMPT } from "../llm/defaultMetaPrompt.js";

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

function notify(db: Database.Database, toUserId: number, kind: string, title: string, body: string | null, meta: any) {
  try {
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO notifications(id,user_id,kind,title,body,meta_json,is_read,created_at)
       VALUES(?,?,?,?,?,?,0,?)`
    ).run(id, toUserId, kind, title, body, meta == null ? null : JSON.stringify(meta), nowIso());
  } catch {
    // Best-effort; ignore.
  }
}

function listingStatusTitle(status: string) {
  switch (status) {
    case "active":
      return "Listing active";
    case "paused":
      return "Listing paused";
    case "sold":
      return "Listing sold";
    case "closed":
      return "Listing closed";
    case "expired":
      return "Listing expired";
    case "deleted":
      return "Listing deleted";
    case "pending":
      return "Listing pending";
    case "draft":
      return "Listing draft";
    default:
      return "Listing updated";
  }
}

function listingStatusBodyForUser(
  prevStatusRaw: string | null | undefined,
  nextStatusRaw: string | null | undefined,
  opts?: { actor?: "admin" | "system"; reason?: string | null }
) {
  const prevStatus = prevStatusRaw != null ? String(prevStatusRaw).trim().toLowerCase() : "";
  const nextStatus = nextStatusRaw != null ? String(nextStatusRaw).trim().toLowerCase() : "";
  const actor = opts?.actor ?? "admin";
  const byAdmin = actor === "admin" ? " by an admin" : "";
  const reason = opts?.reason != null && String(opts.reason).trim() ? String(opts.reason).trim() : null

  // Keep this copy user-friendly; the pills already show raw statuses.
  const base = (() => {
    switch (nextStatus) {
      case "deleted":
        return `Your listing was deleted${byAdmin}.`;
      case "paused":
        return `Your listing was paused${byAdmin}.`;
      case "active":
        if (prevStatus === "paused") return `Your listing was restored and is now live.`;
        if (prevStatus === "deleted") return `Your listing was restored and is now live.`;
        if (prevStatus === "pending") return `Your listing was approved and is now live.`;
        return `Your listing is now live.`;
      case "sold":
        return `Your listing was marked as sold${byAdmin}.`;
      case "closed":
        return `Your listing was closed${byAdmin}.`;
      case "expired":
        return actor === "admin" ? `Your listing was marked as expired by an admin.` : `Your listing has expired.`;
      case "pending":
        return `Your listing is pending review.`;
      case "draft":
        return `Your listing was moved back to draft${byAdmin}.`;
      default:
        return `Your listing status was updated.`;
    }
  })();

  if (!reason) return base;
  return `${base}\n\nReason: ${reason}`;
}

function withListingTitle(prefix: string, title: string) {
  const t = String(title ?? "").trim();
  if (!t) return prefix;
  return `${prefix} — ${t}`;
}

function parseSortDir(raw: any, fallback: "asc" | "desc" = "desc"): "asc" | "desc" {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "asc" || s === "desc") return s;
  return fallback;
}

function sortDirSql(dir: "asc" | "desc") {
  return dir === "asc" ? "ASC" : "DESC";
}

function escapeSqlLike(raw: string) {
  // Escape LIKE wildcards so user input behaves like a literal substring match.
  // SQLite supports "ESCAPE '\'".
  return String(raw ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

router.use(requireAuth);
router.use(requireAdmin);

const ListingStatusSchema = z.enum(["draft", "pending", "active", "paused", "sold", "closed", "expired", "deleted"]);

const AdminSetRestrictionsSchema = z.object({
  blockEdit: z.boolean(),
  blockPauseResume: z.boolean(),
  blockStatusChanges: z.boolean(),
  blockFeaturing: z.boolean(),
  reason: z.string().max(400).optional().nullable(),
});

// --- Admin overview stats ---
router.get("/stats", (req, res) => {
  const db = getDb(req);

  const daysRaw = req.query.days !== undefined ? Number(req.query.days) : undefined;
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(365, Math.floor(daysRaw!))) : 7;
  const cutoffIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const pendingRow = db
    .prepare(
      `
SELECT
  SUM(CASE WHEN listing_type = 0 THEN 1 ELSE 0 END) as pending_sale,
  SUM(CASE WHEN listing_type = 1 THEN 1 ELSE 0 END) as pending_wanted,
  COUNT(*) as pending_total
FROM listings
WHERE status = 'pending'
`
    )
    .get() as any;

  const openReportsRow = db.prepare(`SELECT COUNT(*) as c FROM reports WHERE status = 'open'`).get() as any;

  const activeListingsRow = db
    .prepare(
      `
SELECT
  SUM(CASE WHEN listing_type = 0 THEN 1 ELSE 0 END) as active_sale,
  SUM(CASE WHEN listing_type = 1 THEN 1 ELSE 0 END) as active_wanted,
  COUNT(*) as active_total
FROM listings
WHERE status = 'active'
`
    )
    .get() as any;

  const listingsTotalRow = db.prepare(`SELECT COUNT(*) as c FROM listings WHERE status <> 'deleted'`).get() as any;

  const usersTotalRow = db.prepare(`SELECT COUNT(*) as c FROM users`).get() as any;
  const usersNewRow = db.prepare(`SELECT COUNT(*) as c FROM users WHERE created_at >= ?`).get(cutoffIso) as any;

  const viewsRow = db.prepare(`SELECT COALESCE(SUM(views), 0) as s FROM listings`).get() as any;

  const dbPath = path.join(process.cwd(), "data", "app.db");
  const sizeBytes = (() => {
    try {
      return fs.statSync(dbPath).size;
    } catch {
      return null;
    }
  })();

  return res.json({
    windowDays: days,
    approvals: {
      pendingTotal: Number(pendingRow?.pending_total ?? 0),
      pendingSale: Number(pendingRow?.pending_sale ?? 0),
      pendingWanted: Number(pendingRow?.pending_wanted ?? 0),
    },
    reports: {
      open: Number(openReportsRow?.c ?? 0),
    },
    listings: {
      total: Number(listingsTotalRow?.c ?? 0),
      activeTotal: Number(activeListingsRow?.active_total ?? 0),
      activeSale: Number(activeListingsRow?.active_sale ?? 0),
      activeWanted: Number(activeListingsRow?.active_wanted ?? 0),
    },
    users: {
      total: Number(usersTotalRow?.c ?? 0),
      newLastWindow: Number(usersNewRow?.c ?? 0),
    },
    views: {
      total: Number(viewsRow?.s ?? 0),
    },
    db: {
      path: dbPath,
      sizeBytes,
    },
    server: {
      uptimeSec: Math.floor(process.uptime()),
      nowIso: nowIso(),
    },
  });
});

// --- Listings (admin read; superadmin for edits/actions will be added separately) ---
router.get("/listings", (req, res) => {
  const db = getDb(req);

  const q = String(req.query.q ?? "").trim().toLowerCase();
  const kindRaw = String(req.query.kind ?? "all").trim();
  const kind = kindRaw === "sale" || kindRaw === "wanted" ? kindRaw : "all";
  const statusRaw = String(req.query.status ?? "all").trim();
  const status = statusRaw === "all" ? null : ListingStatusSchema.safeParse(statusRaw).success ? (statusRaw as any) : null;
  const featured = String(req.query.featured ?? "").trim() === "1";
  const includeDeleted = String(req.query.includeDeleted ?? "").trim() === "1";
  const userQuery = String(req.query.user ?? "").trim().toLowerCase();
  const restrictionsRaw = String(req.query.restrictions ?? "all").trim();
  const restrictions =
    restrictionsRaw === "any" || restrictionsRaw === "none" || restrictionsRaw === "edit" || restrictionsRaw === "status" || restrictionsRaw === "featuring"
      ? restrictionsRaw
      : "all";

  const limitRaw = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw!))) : 50;
  const offsetRaw = req.query.offset !== undefined ? Number(req.query.offset) : undefined;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw!)) : 0;

  const sortKey = String(req.query.sortKey ?? "").trim();
  const sortDir = parseSortDir(req.query.sortDir, "desc");
  const dirSql = sortDirSql(sortDir);

  const orderBySql = (() => {
    const statusRankExpr = `CASE l.status
      WHEN 'pending' THEN 0
      WHEN 'active' THEN 1
      WHEN 'paused' THEN 2
      WHEN 'draft' THEN 3
      WHEN 'expired' THEN 4
      WHEN 'sold' THEN 5
      WHEN 'closed' THEN 6
      WHEN 'deleted' THEN 7
      ELSE 8
    END`;

    const restrictionsCountExpr = `(COALESCE(l.owner_block_edit,0)+COALESCE(l.owner_block_pause_resume,0)+COALESCE(l.owner_block_status_changes,0)+COALESCE(l.owner_block_featuring,0))`;
    const priceExpr = `(CASE WHEN l.listing_type = 0 THEN l.price_cents ELSE l.budget_cents END)`;

    const nullLast = (expr: string) => `CASE WHEN ${expr} IS NULL THEN 1 ELSE 0 END ASC, ${expr} ${dirSql}`;

    switch (sortKey) {
      case "listing":
        return `lower(COALESCE(l.title,'')) ${dirSql}, l.id ${dirSql}`;
      case "fullName":
        return `lower(trim(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,''))) ${dirSql}, l.id ${dirSql}`;
      case "username":
        return `lower(COALESCE(u.username,'')) ${dirSql}, l.id ${dirSql}`;
      case "email":
        return `lower(COALESCE(u.email,'')) ${dirSql}, l.id ${dirSql}`;
      case "phone":
        return `lower(COALESCE(l.phone,'')) ${dirSql}, l.id ${dirSql}`;
      case "restrictions":
        return `${restrictionsCountExpr} ${dirSql}, l.id ${dirSql}`;
      case "price":
        // Null last regardless of direction (matches UI behavior).
        return `${nullLast(priceExpr)}, l.id ${dirSql}`;
      case "views":
        return `COALESCE(l.views,0) ${dirSql}, l.id ${dirSql}`;
      case "status":
        // Secondary: updated newest first (matches UI behavior).
        return `${statusRankExpr} ${dirSql}, l.updated_at DESC, l.id DESC`;
      case "published":
        return `${nullLast("l.published_at")}, l.id ${dirSql}`;
      case "created":
        return `l.created_at ${dirSql}, l.id ${dirSql}`;
      case "updated":
        return `l.updated_at ${dirSql}, l.id ${dirSql}`;
      case "expiresIn":
        return `${nullLast("l.expires_at")}, l.id ${dirSql}`;
      default:
        return `COALESCE(l.published_at, l.created_at) DESC, l.id DESC`;
    }
  })();

  const where: string[] = [];
  const params: any[] = [];

  if (kind === "sale") where.push(`l.listing_type = 0`);
  if (kind === "wanted") where.push(`l.listing_type = 1`);

  if (!includeDeleted) where.push(`l.status <> 'deleted'`);
  if (status) {
    where.push(`l.status = ?`);
    params.push(status);
  }

  if (featured) {
    where.push(`l.featured_until IS NOT NULL`);
    where.push(`l.featured_until > ?`);
    params.push(Date.now());
  }

  if (q) {
    // Search broadly (title/species/description/location)
    where.push(`(lower(l.title) LIKE ? OR lower(l.species) LIKE ? OR lower(l.description) LIKE ? OR lower(l.location) LIKE ?)`);
    const pat = `%${q}%`;
    params.push(pat, pat, pat, pat);
  }

  if (userQuery) {
    // Search across user identity fields + profile phone, plus listing contact phone for convenience.
    //
    // Important: support multi-word searches like "adam g" by tokenizing and requiring all tokens
    // to match across ANY of the user fields (e.g., token1 hits first_name, token2 hits last_name).
    const tokens = userQuery.split(/\s+/g).map((t) => t.trim()).filter(Boolean).slice(0, 6);
    const tokenClauses: string[] = [];
    for (const tok of tokens) {
      tokenClauses.push(
        `(lower(u.username) LIKE ? OR lower(u.email) LIKE ? OR lower(u.first_name) LIKE ? OR lower(u.last_name) LIKE ? OR lower(COALESCE(p.phone, '')) LIKE ? OR lower(COALESCE(l.phone, '')) LIKE ?)`
      );
      const pat = `%${tok}%`;
      params.push(pat, pat, pat, pat, pat, pat);
    }

    // Also allow matching the full string against "first last" and "last first" for convenience.
    const full = `%${userQuery}%`;
    tokenClauses.push(`(lower(trim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, ''))) LIKE ? OR lower(trim(COALESCE(u.last_name, '') || ' ' || COALESCE(u.first_name, ''))) LIKE ?)`);
    params.push(full, full);

    where.push(`(${tokenClauses.join(" AND ")})`);
  }

  if (restrictions === "any") {
    where.push(
      `(COALESCE(l.owner_block_edit,0)=1 OR COALESCE(l.owner_block_pause_resume,0)=1 OR COALESCE(l.owner_block_status_changes,0)=1 OR COALESCE(l.owner_block_featuring,0)=1)`
    );
  } else if (restrictions === "none") {
    where.push(
      `(COALESCE(l.owner_block_edit,0)=0 AND COALESCE(l.owner_block_pause_resume,0)=0 AND COALESCE(l.owner_block_status_changes,0)=0 AND COALESCE(l.owner_block_featuring,0)=0)`
    );
  } else if (restrictions === "edit") {
    where.push(`(COALESCE(l.owner_block_edit,0)=1 OR COALESCE(l.owner_block_pause_resume,0)=1)`);
  } else if (restrictions === "status") {
    where.push(`COALESCE(l.owner_block_status_changes,0)=1`);
  } else if (restrictions === "featuring") {
    where.push(`COALESCE(l.owner_block_featuring,0)=1`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const totalRow = db
    .prepare(
      `
SELECT COUNT(*) as c
FROM listings l
LEFT JOIN users u ON u.id = l.user_id
LEFT JOIN user_profiles p ON p.user_id = l.user_id
${whereSql}
`
    )
    .get(...params) as any;
  const total = Number(totalRow?.c ?? 0);

  const nowMs = Date.now();
  const sinceMs = nowMs - 24 * 60 * 60 * 1000;

  const rows = db
    .prepare(
      `
SELECT
  l.id,l.user_id,l.listing_type,l.status,l.title,l.category,l.species,l.sex,l.water_type,l.size,
  l.shipping_offered,l.quantity,l.price_cents,l.budget_cents,l.location,l.phone,l.views,
  COALESCE(v24.views_24h, 0) as views_today,
  l.owner_block_edit,l.owner_block_pause_resume,l.owner_block_status_changes,l.owner_block_featuring,l.owner_block_reason,l.owner_block_updated_at,l.owner_block_actor_user_id,
  l.featured_until,l.published_at,l.expires_at,l.created_at,l.updated_at,l.deleted_at,
  u.username as user_username,u.email as user_email,u.first_name as user_first_name,u.last_name as user_last_name,
  li.thumb_url as hero_thumb_url, li.medium_url as hero_medium_url, li.url as hero_url
FROM listings l
LEFT JOIN users u ON u.id = l.user_id
LEFT JOIN user_profiles p ON p.user_id = l.user_id
LEFT JOIN (
  SELECT listing_id, SUM(views) as views_24h
  FROM listing_views_hourly
  WHERE hour_start_ms >= ?
  GROUP BY listing_id
) v24 ON v24.listing_id = l.id
LEFT JOIN listing_images li
  ON li.listing_id = l.id
 AND li.sort_order = (
   SELECT MIN(sort_order) FROM listing_images WHERE listing_id = l.id
 )
${whereSql}
ORDER BY ${orderBySql}
LIMIT ? OFFSET ?
`
    )
    .all(sinceMs, ...params, limit, offset) as any[];

  const items = rows.map((r) => ({
    kind: Number(r.listing_type) === 1 ? ("wanted" as const) : ("sale" as const),
    id: String(r.id),
    user:
      r.user_id == null
        ? null
        : {
          id: Number(r.user_id),
          username: r.user_username ? String(r.user_username) : null,
          email: r.user_email ? String(r.user_email) : null,
          firstName: r.user_first_name ? String(r.user_first_name) : "",
          lastName: r.user_last_name ? String(r.user_last_name) : "",
        },
    status: String(r.status ?? "active"),
    title: String(r.title ?? ""),
    category: String(r.category ?? ""),
    species: r.species != null ? String(r.species) : null,
    sex: String(r.sex ?? "Unknown"),
    waterType: r.water_type != null ? String(r.water_type) : null,
    size: String(r.size ?? ""),
    shippingOffered: Boolean(Number(r.shipping_offered ?? 0)),
    quantity: Number.isFinite(Number(r.quantity)) ? Math.max(1, Math.floor(Number(r.quantity))) : 1,
    priceCents: Number(r.price_cents ?? 0),
    budgetCents: r.budget_cents != null ? Number(r.budget_cents) : null,
    location: String(r.location ?? ""),
    phone: r.phone != null ? String(r.phone) : "",
    views: Number(r.views ?? 0),
    viewsToday: Number((r as any).views_today ?? 0),
    featuredUntil: r.featured_until != null ? Number(r.featured_until) : null,
    publishedAt: r.published_at != null ? String(r.published_at) : null,
    expiresAt: r.expires_at != null ? String(r.expires_at) : null,
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
    deletedAt: r.deleted_at != null ? String(r.deleted_at) : null,
    ownerBlockEdit: Boolean(Number((r as any).owner_block_edit ?? 0)),
    ownerBlockPauseResume: Boolean(Number((r as any).owner_block_pause_resume ?? 0)),
    ownerBlockStatusChanges: Boolean(Number(r.owner_block_status_changes ?? 0)),
    ownerBlockFeaturing: Boolean(Number(r.owner_block_featuring ?? 0)),
    ownerBlockReason: r.owner_block_reason != null ? String(r.owner_block_reason) : null,
    ownerBlockUpdatedAt: r.owner_block_updated_at != null ? String(r.owner_block_updated_at) : null,
    ownerBlockActorUserId: r.owner_block_actor_user_id != null ? Number(r.owner_block_actor_user_id) : null,
    heroUrl: r.hero_thumb_url != null ? String(r.hero_thumb_url) : r.hero_medium_url != null ? String(r.hero_medium_url) : r.hero_url != null ? String(r.hero_url) : null,
  }));

  return res.json({ items, total, limit, offset });
});

router.get("/listings/:id", (req, res) => {
  const db = getDb(req);
  const id = String(req.params.id ?? "").trim();
  if (!id) return res.status(400).json({ error: "Missing id" });

  const row = db
    .prepare(
      `
SELECT
  l.*,
  u.username as user_username,u.email as user_email
FROM listings l
LEFT JOIN users u ON u.id = l.user_id
WHERE l.id = ?
LIMIT 1
`
    )
    .get(id) as any | undefined;

  if (!row) return res.status(404).json({ error: "Not found" });

  const images = db
    .prepare(
      `SELECT id,url,thumb_url,medium_url,sort_order
FROM listing_images
WHERE listing_id = ?
ORDER BY sort_order ASC`
    )
    .all(id) as any[];

  return res.json({
    item: {
      kind: Number(row.listing_type) === 1 ? ("wanted" as const) : ("sale" as const),
      id: String(row.id),
      user: row.user_id == null ? null : { id: Number(row.user_id), username: row.user_username ? String(row.user_username) : null, email: row.user_email ? String(row.user_email) : null },
      status: String(row.status ?? "active"),
      title: String(row.title ?? ""),
      category: String(row.category ?? ""),
      species: row.species != null ? String(row.species) : null,
      sex: String(row.sex ?? "Unknown"),
      waterType: row.water_type != null ? String(row.water_type) : null,
      size: String(row.size ?? ""),
      shippingOffered: Boolean(Number(row.shipping_offered ?? 0)),
      quantity: Number.isFinite(Number(row.quantity)) ? Math.max(1, Math.floor(Number(row.quantity))) : 1,
      priceCents: Number(row.price_cents ?? 0),
      budgetCents: row.budget_cents != null ? Number(row.budget_cents) : null,
      location: String(row.location ?? ""),
      phone: row.phone != null ? String(row.phone) : "",
      views: Number(row.views ?? 0),
      featuredUntil: row.featured_until != null ? Number(row.featured_until) : null,
      publishedAt: row.published_at != null ? String(row.published_at) : null,
      expiresAt: row.expires_at != null ? String(row.expires_at) : null,
      createdAt: String(row.created_at ?? ""),
      updatedAt: String(row.updated_at ?? ""),
      deletedAt: row.deleted_at != null ? String(row.deleted_at) : null,
      description: String(row.description ?? ""),
      ownerBlockEdit: Boolean(Number((row as any).owner_block_edit ?? 0)),
      ownerBlockPauseResume: Boolean(Number((row as any).owner_block_pause_resume ?? 0)),
      ownerBlockStatusChanges: Boolean(Number(row.owner_block_status_changes ?? 0)),
      ownerBlockFeaturing: Boolean(Number(row.owner_block_featuring ?? 0)),
      ownerBlockReason: row.owner_block_reason != null ? String(row.owner_block_reason) : null,
      ownerBlockUpdatedAt: row.owner_block_updated_at != null ? String(row.owner_block_updated_at) : null,
      ownerBlockActorUserId: row.owner_block_actor_user_id != null ? Number(row.owner_block_actor_user_id) : null,
      images: images.map((im) => ({
        id: String(im.id),
        url: String(im.url),
        thumbUrl: im.thumb_url != null ? String(im.thumb_url) : null,
        mediumUrl: im.medium_url != null ? String(im.medium_url) : null,
        sortOrder: Number(im.sort_order ?? 0),
      })),
    },
  });
});

const AdminSetStatusSchema = z.object({ status: ListingStatusSchema, reason: z.string().max(400).optional().nullable() });
router.post("/listings/:id/set-status", (req, res) => {
  const db = getDb(req);
  const id = String(req.params.id ?? "").trim();
  if (!id) return res.status(400).json({ error: "Missing id" });
  const parsed = AdminSetStatusSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });

  const row = db
    .prepare(
      `SELECT id,user_id,title,status,listing_type,
              owner_block_reason
       FROM listings WHERE id = ?`
    )
    .get(id) as any | undefined;
  if (!row) return res.status(404).json({ error: "Not found" });

  const ownerUserId = row.user_id != null ? Number(row.user_id) : null;
  const prevStatus = String(row.status ?? "active");
  const nextStatus = String(parsed.data.status);
  const reason = parsed.data.reason != null && String(parsed.data.reason).trim() ? String(parsed.data.reason).trim() : null;
  const now = nowIso();

  if (nextStatus === "deleted") {
    db.prepare(`UPDATE listings SET status='deleted', deleted_at = COALESCE(deleted_at, ?), updated_at = ? WHERE id = ?`).run(now, now, id);
  } else {
    db.prepare(`UPDATE listings SET status = ?, deleted_at = CASE WHEN status='deleted' THEN NULL ELSE deleted_at END, updated_at = ? WHERE id = ?`).run(
      nextStatus,
      now,
      id
    );
  }

  // Default restrictions derived from admin status actions.
  // paused -> block resume + featuring. active -> clear all restrictions.
  if (nextStatus === "paused") {
    db.prepare(
      `UPDATE listings
       SET owner_block_pause_resume = 1,
           owner_block_status_changes = 0,
           owner_block_featuring = 1,
           owner_block_updated_at = ?,
           owner_block_actor_user_id = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(now, req.user!.id, now, id);
  } else if (nextStatus === "active") {
    db.prepare(
      `UPDATE listings
       SET owner_block_edit = 0,
           owner_block_pause_resume = 0,
           owner_block_status_changes = 0,
           owner_block_featuring = 0,
           owner_block_reason = NULL,
           owner_block_updated_at = ?,
           owner_block_actor_user_id = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(now, req.user!.id, now, id);
  }

  audit(db, req.user!.id, "set_listing_status", "listing", id, { prevStatus, nextStatus, reason });
  if (ownerUserId != null && Number.isFinite(ownerUserId) && ownerUserId !== req.user!.id) {
    const title = String(row.title ?? "").trim() || "your listing";
    const notifTitle = withListingTitle(listingStatusTitle(nextStatus), title);
    const body = listingStatusBodyForUser(prevStatus, nextStatus, { actor: "admin", reason });
    notify(
      db,
      ownerUserId,
      "listing_status_changed",
      notifTitle,
      body,
      { listingId: id, listingType: Number(row.listing_type ?? 0) === 1 ? "wanted" : "sale", prevStatus, nextStatus, reason }
    );
  }
  return res.json({ ok: true });
});

const AdminSetFeaturedSchema = z.object({ featuredUntil: z.number().int().min(0).nullable() });
router.post("/listings/:id/set-featured", requireSuperadmin, (req, res) => {
  const db = getDb(req);
  const id = String(req.params.id ?? "").trim();
  if (!id) return res.status(400).json({ error: "Missing id" });
  const parsed = AdminSetFeaturedSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });

  const row = db
    .prepare(
      `SELECT id,user_id,title,featured_until,status,listing_type,
              owner_block_edit,owner_block_pause_resume,owner_block_status_changes,owner_block_featuring,owner_block_reason
       FROM listings WHERE id = ?`
    )
    .get(id) as any | undefined;
  if (!row) return res.status(404).json({ error: "Not found" });

  const ownerUserId = row.user_id != null ? Number(row.user_id) : null;
  const prev = row.featured_until != null ? Number(row.featured_until) : null;
  const next = parsed.data.featuredUntil;
  const now = nowIso();

  if (next === null) {
    db.prepare(`UPDATE listings SET featured = 0, featured_until = NULL, updated_at = ? WHERE id = ?`).run(now, id);
  } else {
    db.prepare(`UPDATE listings SET featured = 1, featured_until = ?, updated_at = ? WHERE id = ?`).run(next, now, id);
  }

  // Default restriction derived from admin "unfeature": block owner from featuring until admin clears.
  if (next === null) {
    db.prepare(
      `UPDATE listings
       SET owner_block_featuring = 1,
           owner_block_updated_at = ?,
           owner_block_actor_user_id = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(now, req.user!.id, now, id);
  }

  audit(db, req.user!.id, "set_listing_featured", "listing", id, { prevFeaturedUntil: prev, nextFeaturedUntil: next });
  if (ownerUserId != null && Number.isFinite(ownerUserId) && ownerUserId !== req.user!.id) {
    const title = String(row.title ?? "").trim() || "your listing";
    const notifTitle = withListingTitle(next == null ? "Featured removed" : "Featured enabled", title);
    const msg = next == null ? "Featured removed." : "Featured enabled.";
    notify(
      db,
      ownerUserId,
      "listing_featured_changed",
      notifTitle,
      msg,
      { listingId: id, listingType: Number(row.listing_type ?? 0) === 1 ? "wanted" : "sale", prevFeaturedUntil: prev, nextFeaturedUntil: next }
    );
  }
  return res.json({ ok: true });
});

router.post("/listings/:id/set-restrictions", (req, res) => {
  const db = getDb(req);
  const id = String(req.params.id ?? "").trim();
  if (!id) return res.status(400).json({ error: "Missing id" });
  const parsed = AdminSetRestrictionsSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });

  const row = db
    .prepare(
      `SELECT id,user_id,title,listing_type,
              owner_block_edit,owner_block_pause_resume,owner_block_status_changes,owner_block_featuring,owner_block_reason
       FROM listings WHERE id = ?`
    )
    .get(id) as any | undefined;
  if (!row) return res.status(404).json({ error: "Not found" });

  const ownerUserId = row.user_id != null ? Number(row.user_id) : null;
  const prev = {
    blockEdit: Boolean(Number(row.owner_block_edit ?? 0)),
    blockPauseResume: Boolean(Number(row.owner_block_pause_resume ?? 0)),
    blockStatusChanges: Boolean(Number(row.owner_block_status_changes ?? 0)),
    blockFeaturing: Boolean(Number(row.owner_block_featuring ?? 0)),
    reason: row.owner_block_reason != null ? String(row.owner_block_reason) : null,
  };
  const next = {
    blockEdit: Boolean(parsed.data.blockEdit),
    blockPauseResume: Boolean(parsed.data.blockPauseResume),
    blockStatusChanges: Boolean(parsed.data.blockStatusChanges),
    blockFeaturing: Boolean(parsed.data.blockFeaturing),
    reason: parsed.data.reason != null ? String(parsed.data.reason) : null,
  };

  // If there are no restrictions enabled, drop any reason to avoid "reason-only" notifications/UI.
  if (!next.blockEdit && !next.blockPauseResume && !next.blockStatusChanges && !next.blockFeaturing) {
    next.reason = null;
  }

  const now = nowIso();
  db.prepare(
    `UPDATE listings
     SET owner_block_edit = ?,
         owner_block_pause_resume = ?,
         owner_block_status_changes = ?,
         owner_block_featuring = ?,
         owner_block_reason = ?,
         owner_block_updated_at = ?,
         owner_block_actor_user_id = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(
    next.blockEdit ? 1 : 0,
    next.blockPauseResume ? 1 : 0,
    next.blockStatusChanges ? 1 : 0,
    next.blockFeaturing ? 1 : 0,
    next.reason,
    now,
    req.user!.id,
    now,
    id
  );

  audit(db, req.user!.id, "set_listing_restrictions", "listing", id, { prev, next });

  return res.json({ ok: true });
});

// --- User directory + moderation (admins). Privilege toggles remain superadmin-only. ---
router.get("/users-directory", (req, res) => {
  const q = String(req.query.query ?? "").trim().toLowerCase();
  const limitRaw = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw!))) : 50;
  const offsetRaw = req.query.offset !== undefined ? Number(req.query.offset) : undefined;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw!)) : 0;

  const sortKey = String(req.query.sortKey ?? "").trim();
  const sortDir = parseSortDir(req.query.sortDir, "desc");
  const dirSql = sortDirSql(sortDir);
  const orderBySql = (() => {
    switch (sortKey) {
      case "user":
        return `lower(COALESCE(u.username,'') || '\n' || COALESCE(u.email,'')) ${dirSql}, u.id ${dirSql}`;
      case "lastActive": {
        // UI puts null last for asc and null first for desc.
        if (sortDir === "asc") return `(s.last_active_at IS NULL) ASC, s.last_active_at ASC, u.id ASC`;
        return `(s.last_active_at IS NULL) DESC, s.last_active_at DESC, u.id DESC`;
      }
      case "moderation":
        return `lower(COALESCE(m.status,'active')) ${dirSql}, u.id ${dirSql}`;
      case "admin":
        return `COALESCE(u.is_admin,0) ${dirSql}, u.id ${dirSql}`;
      case "superadmin":
        return `COALESCE(u.is_superadmin,0) ${dirSql}, u.id ${dirSql}`;
      default:
        return `u.id DESC`;
    }
  })();

  const db = getDb(req);
  const where: string[] = [];
  const params: any[] = [];
  if (q) {
    where.push(`(lower(u.email) LIKE ? OR lower(u.username) LIKE ?)`);
    params.push(`%${q}%`, `%${q}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const totalRow = db
    .prepare(
      `
SELECT COUNT(*) as c
FROM users u
${whereSql}
`
    )
    .get(...params) as any;
  const total = Number(totalRow?.c ?? 0);

  const rows = db
    .prepare(
      `
SELECT u.id,u.email,u.username,u.is_admin,u.is_superadmin,u.created_at,u.updated_at,
       p.avatar_url as avatar_url,
       m.status as mod_status, m.reason as mod_reason, m.suspended_until as mod_suspended_until, m.updated_at as mod_updated_at,
       s.last_active_at as last_active_at
FROM users u
LEFT JOIN user_profiles p ON p.user_id = u.id
LEFT JOIN user_moderation m ON m.user_id = u.id
LEFT JOIN (
  SELECT user_id, MAX(last_used_at) as last_active_at
  FROM sessions
  GROUP BY user_id
) s ON s.user_id = u.id
${whereSql}
ORDER BY ${orderBySql}
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
      lastActiveAt: u.last_active_at ? String(u.last_active_at) : null,
      avatarUrl: u.avatar_url ? String(u.avatar_url) : null,
      moderation: {
        status: u.mod_status ? String(u.mod_status) : "active",
        reason: u.mod_reason ? String(u.mod_reason) : null,
        suspendedUntil: u.mod_suspended_until != null ? Number(u.mod_suspended_until) : null,
        updatedAt: u.mod_updated_at ? String(u.mod_updated_at) : null,
      },
    })),
    total,
    limit,
    offset,
  });
});

router.get("/users/:id", (req, res) => {
  const db = getDb(req);
  const userId = Number(req.params.id);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: "Invalid user id" });

  const row = db
    .prepare(
      `
SELECT u.id,u.email,u.username,u.first_name,u.last_name,u.is_admin,u.is_superadmin,u.created_at,u.updated_at,
       p.avatar_url,p.location,p.phone,p.website,p.bio,p.created_at as profile_created_at,p.updated_at as profile_updated_at,
       m.status as mod_status, m.reason as mod_reason, m.suspended_until as mod_suspended_until, m.created_at as mod_created_at, m.updated_at as mod_updated_at
FROM users u
LEFT JOIN user_profiles p ON p.user_id = u.id
LEFT JOIN user_moderation m ON m.user_id = u.id
WHERE u.id = ?
`
    )
    .get(userId) as any | undefined;
  if (!row) return res.status(404).json({ error: "User not found" });

  const listingsRow = db
    .prepare(
      `
SELECT
  COUNT(*) as total,
  SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
  SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
  SUM(CASE WHEN status = 'deleted' THEN 1 ELSE 0 END) as deleted,
  SUM(CASE WHEN listing_type = 0 THEN 1 ELSE 0 END) as sale_total,
  SUM(CASE WHEN listing_type = 1 THEN 1 ELSE 0 END) as wanted_total
FROM listings
WHERE user_id = ?
`
    )
    .get(userId) as any;

  const reportsRow = db.prepare(`SELECT COUNT(*) as reported_by_user FROM reports WHERE reporter_user_id = ?`).get(userId) as any;

  const sessionsRow = db
    .prepare(
      `
SELECT
  COUNT(*) as total,
  SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END) as active
FROM sessions
WHERE user_id = ?
`
    )
    .get(userId) as any;

  const lastActiveRow = db.prepare(`SELECT MAX(last_used_at) as last_active_at FROM sessions WHERE user_id = ?`).get(userId) as any;

  return res.json({
    user: {
      id: Number(row.id),
      email: String(row.email),
      username: String(row.username),
      firstName: String(row.first_name ?? ""),
      lastName: String(row.last_name ?? ""),
      isAdmin: Boolean(Number(row.is_admin ?? 0)),
      isSuperadmin: Boolean(Number(row.is_superadmin ?? 0)),
      createdAt: String(row.created_at ?? ""),
      updatedAt: String(row.updated_at ?? ""),
      lastActiveAt: lastActiveRow?.last_active_at ? String(lastActiveRow.last_active_at) : null,
    },
    profile: {
      avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
      location: row.location != null ? String(row.location) : null,
      phone: row.phone != null ? String(row.phone) : null,
      website: row.website != null ? String(row.website) : null,
      bio: row.bio != null ? String(row.bio) : null,
      createdAt: row.profile_created_at ? String(row.profile_created_at) : null,
      updatedAt: row.profile_updated_at ? String(row.profile_updated_at) : null,
    },
    moderation: {
      status: row.mod_status ? String(row.mod_status) : "active",
      reason: row.mod_reason ? String(row.mod_reason) : null,
      suspendedUntil: row.mod_suspended_until != null ? Number(row.mod_suspended_until) : null,
      createdAt: row.mod_created_at ? String(row.mod_created_at) : null,
      updatedAt: row.mod_updated_at ? String(row.mod_updated_at) : null,
    },
    stats: {
      listings: {
        total: Number(listingsRow?.total ?? 0),
        active: Number(listingsRow?.active ?? 0),
        pending: Number(listingsRow?.pending ?? 0),
        deleted: Number(listingsRow?.deleted ?? 0),
        saleTotal: Number(listingsRow?.sale_total ?? 0),
        wantedTotal: Number(listingsRow?.wanted_total ?? 0),
      },
      reports: {
        reportedByUser: Number(reportsRow?.reported_by_user ?? 0),
      },
      sessions: {
        total: Number(sessionsRow?.total ?? 0),
        active: Number(sessionsRow?.active ?? 0),
      },
    },
  });
});

const ModerationStatusSchema = z.enum(["active", "suspended", "banned"]);
const SetUserModerationSchema = z.object({
  status: ModerationStatusSchema,
  reason: z.string().max(800).optional().nullable(),
  suspendedUntil: z.number().int().min(0).optional().nullable(),
});
router.post("/users/:id/moderation", (req, res) => {
  const db = getDb(req);
  const userId = Number(req.params.id);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: "Invalid user id" });
  const parsed = SetUserModerationSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });

  const target = db.prepare(`SELECT id,is_superadmin FROM users WHERE id = ?`).get(userId) as any | undefined;
  if (!target) return res.status(404).json({ error: "User not found" });
  if (Number(target.is_superadmin ?? 0) === 1 && !req.user!.isSuperadmin) {
    return res.status(403).json({ error: "Only superadmin can moderate a superadmin" });
  }

  const prev = db.prepare(`SELECT status,reason,suspended_until FROM user_moderation WHERE user_id = ?`).get(userId) as any | undefined;
  const prevStatus = prev?.status ? String(prev.status) : "active";
  const prevReason = prev?.reason ? String(prev.reason) : null;
  const prevSusp = prev?.suspended_until != null ? Number(prev.suspended_until) : null;

  const now = nowIso();
  const nextStatus = parsed.data.status;
  const reason = parsed.data.reason ?? null;
  const suspendedUntil = nextStatus === "suspended" ? (parsed.data.suspendedUntil ?? null) : null;

  if (nextStatus === "active") {
    db.prepare(`DELETE FROM user_moderation WHERE user_id = ?`).run(userId);
  } else {
    const existing = db.prepare(`SELECT user_id FROM user_moderation WHERE user_id = ?`).get(userId) as any | undefined;
    if (!existing) {
      db.prepare(`INSERT INTO user_moderation(user_id,status,reason,suspended_until,created_at,updated_at) VALUES(?,?,?,?,?,?)`).run(
        userId,
        nextStatus,
        reason,
        suspendedUntil,
        now,
        now
      );
    } else {
      db.prepare(`UPDATE user_moderation SET status=?, reason=?, suspended_until=?, updated_at=? WHERE user_id=?`).run(
        nextStatus,
        reason,
        suspendedUntil,
        now,
        userId
      );
    }
  }

  if (nextStatus !== "active") {
    db.prepare(`UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ?`).run(now, userId);
  }

  audit(db, req.user!.id, "set_user_moderation", "user", String(userId), {
    prev: { status: prevStatus, reason: prevReason, suspendedUntil: prevSusp },
    next: { status: nextStatus, reason, suspendedUntil },
  });
  return res.json({ ok: true });
});

router.post("/users/:id/revoke-sessions", (req, res) => {
  const db = getDb(req);
  const userId = Number(req.params.id);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: "Invalid user id" });

  const target = db.prepare(`SELECT id,is_superadmin FROM users WHERE id = ?`).get(userId) as any | undefined;
  if (!target) return res.status(404).json({ error: "User not found" });
  if (Number(target.is_superadmin ?? 0) === 1 && !req.user!.isSuperadmin) {
    return res.status(403).json({ error: "Only superadmin can revoke sessions for a superadmin" });
  }

  const now = nowIso();
  const info = db.prepare(`UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ?`).run(now, userId) as any;
  audit(db, req.user!.id, "revoke_sessions", "user", String(userId), { changes: info?.changes ?? null });
  return res.json({ ok: true });
});

const AdminDeleteUserSchema = z.object({ reason: z.string().max(800).optional().nullable() });
router.post("/users/:id/delete-account", requireSuperadmin, (req, res) => {
  const db = getDb(req);
  const userId = Number(req.params.id);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: "Invalid user id" });
  const parsed = AdminDeleteUserSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });

  const row = db.prepare(`SELECT id,email,username,is_superadmin FROM users WHERE id = ?`).get(userId) as any | undefined;
  if (!row) return res.status(404).json({ error: "User not found" });
  if (Number(row.is_superadmin ?? 0) === 1) return res.status(400).json({ error: "Cannot delete a superadmin account" });

  const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
  const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
  const now = nowIso();

  const tx = db.transaction(() => {
    db.prepare(`UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ?`).run(now, userId);
    db.prepare(`INSERT INTO deleted_accounts(user_id,email_hash,username_hash,deleted_at,reason) VALUES(?,?,?,?,?)`).run(
      userId,
      sha256(norm(row.email)),
      sha256(norm(row.username)),
      now,
      parsed.data.reason ?? null
    );
    db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
  });

  try {
    tx();
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? "Failed to delete account" });
  }

  audit(db, req.user!.id, "delete_user_account", "user", String(userId), { reason: parsed.data.reason ?? null });
  return res.json({ ok: true });
});

// --- Audit log viewer ---
router.get("/audit", (req, res) => {
  const db = getDb(req);

  const actorRaw = String(req.query.actorUserId ?? "").trim();
  const actorUserId = actorRaw ? Number(actorRaw) : null;
  const actorQuery = actorRaw && !(actorUserId != null && Number.isFinite(actorUserId)) ? actorRaw : "";
  const action = String(req.query.action ?? "").trim();
  const targetKind = String(req.query.targetKind ?? "").trim();
  const targetId = String(req.query.targetId ?? "").trim();

  const limitRaw = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw!))) : 50;
  const offsetRaw = req.query.offset !== undefined ? Number(req.query.offset) : undefined;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw!)) : 0;

  const sortKey = String(req.query.sortKey ?? "").trim();
  const sortDir = parseSortDir(req.query.sortDir, "desc");
  const dirSql = sortDirSql(sortDir);
  const orderBySql = (() => {
    switch (sortKey) {
      case "when":
        return `a.created_at ${dirSql}, a.id ${dirSql}`;
      case "actor":
        return `lower(COALESCE(u.username,'') || '\n' || COALESCE(u.email,'')) ${dirSql}, a.id ${dirSql}`;
      case "action":
        return `lower(COALESCE(a.action,'')) ${dirSql}, a.id ${dirSql}`;
      case "target":
        return `lower(COALESCE(a.target_kind,'') || ':' || COALESCE(a.target_id,'')) ${dirSql}, a.id ${dirSql}`;
      case "meta":
        return `CASE WHEN a.meta_json IS NULL THEN 0 ELSE 1 END ${dirSql}, a.created_at DESC, a.id DESC`;
      default:
        return `a.created_at DESC, a.id DESC`;
    }
  })();

  const where: string[] = [];
  const params: any[] = [];

  if (actorUserId != null && Number.isFinite(actorUserId)) {
    where.push(`a.actor_user_id = ?`);
    params.push(actorUserId);
  }
  if (actorQuery) {
    const pat = `%${escapeSqlLike(actorQuery.toLowerCase())}%`;
    where.push(`(lower(COALESCE(u.username,'')) LIKE ? ESCAPE '\\' OR lower(COALESCE(u.email,'')) LIKE ? ESCAPE '\\')`);
    params.push(pat, pat);
  }
  if (action) {
    where.push(`lower(a.action) LIKE ? ESCAPE '\\'`);
    params.push(`%${escapeSqlLike(action.toLowerCase())}%`);
  }
  if (targetKind) {
    where.push(`lower(a.target_kind) LIKE ? ESCAPE '\\'`);
    params.push(`%${escapeSqlLike(targetKind.toLowerCase())}%`);
  }
  if (targetId) {
    where.push(`lower(a.target_id) LIKE ? ESCAPE '\\'`);
    params.push(`%${escapeSqlLike(targetId.toLowerCase())}%`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const totalRow = db
    .prepare(
      `
SELECT COUNT(*) as c
FROM admin_audit a
LEFT JOIN users u ON u.id = a.actor_user_id
${whereSql}
`
    )
    .get(...params) as any;
  const total = Number(totalRow?.c ?? 0);

  const rows = db
    .prepare(
      `
SELECT a.*,
       u.username as actor_username, u.email as actor_email
FROM admin_audit a
LEFT JOIN users u ON u.id = a.actor_user_id
${whereSql}
ORDER BY ${orderBySql}
LIMIT ? OFFSET ?
`
    )
    .all(...params, limit, offset) as any[];

  return res.json({
    items: rows.map((r) => ({
      id: String(r.id),
      actor: { userId: Number(r.actor_user_id), username: r.actor_username ? String(r.actor_username) : null, email: r.actor_email ? String(r.actor_email) : null },
      action: String(r.action),
      targetKind: String(r.target_kind),
      targetId: String(r.target_id),
      metaJson: r.meta_json != null ? String(r.meta_json) : null,
      createdAt: String(r.created_at),
    })),
    total,
    limit,
    offset,
  });
});

// --- Site settings (superadmin only) ---
const SiteSettingsSchema = z.object({
  requireApproval: z.boolean().optional(),
  listingTtlDays: z.number().int().min(1).max(365).optional(),
  rateLimitWindowMs: z.number().int().min(5_000).max(300_000).optional(),
  rateLimitMax: z.number().int().min(10).max(10_000).optional(),
  featuredMaxDays: z.number().int().min(1).max(3650).optional(),
});

function parseJsonValue(raw: any) {
  if (raw == null) return null;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

function getSiteSetting(db: Database.Database, key: string) {
  const row = db.prepare(`SELECT value_json FROM site_settings WHERE key = ?`).get(key) as any | undefined;
  return parseJsonValue(row?.value_json);
}

function upsertSiteSetting(db: Database.Database, key: string, value: any, actorUserId: number) {
  const now = nowIso();
  db.prepare(
    `
INSERT INTO site_settings(key,value_json,updated_at,updated_by_user_id)
VALUES(?,?,?,?)
ON CONFLICT(key) DO UPDATE SET
  value_json=excluded.value_json,
  updated_at=excluded.updated_at,
  updated_by_user_id=excluded.updated_by_user_id
`
  ).run(key, JSON.stringify(value), now, actorUserId);
}

function sanitizePopularSearchLabel(raw: unknown) {
  let s = String(raw ?? "").trim();
  if (!s) return "";
  // Minimal sanitization only: collapse whitespace and enforce max length.
  s = s.replace(/\s+/g, " ").trim();
  // Ensure max length.
  if (s.length > 80) s = s.slice(0, 80).trim();
  return s;
}

function labelFromParams(params: any) {
  const raw =
    params && typeof params === "object"
      ? String((params as any).species ?? (params as any).q ?? "")
      : "";
  const base = raw.trim();
  if (!base) return "";
  // Title-case-ish for display
  const titled = base
    .split(/\s+/g)
    .map((w) => {
      const lw = w.toLowerCase();
      if (lw === "co2") return "CO2";
      if (/[0-9]/.test(w) && w.length <= 6) return w.toUpperCase();
      return lw ? lw[0]!.toUpperCase() + lw.slice(1) : lw;
    })
    .join(" ");
  const category = params && typeof params === "object" ? String((params as any).category ?? "").trim() : "";
  const out = category && category !== "Fish" ? `${titled} (${category})` : titled;
  return out.slice(0, 80).trim();
}

function deriveParamsFromIncludedTerms(input: {
  label: string;
  includedTerms: string[];
  candidateStatsByTerm: Map<string, { saleUnique: number; wantedUnique: number; saleCount: number; wantedCount: number; topCategory: string | null }>;
}) {
  // Heuristic: choose browse type based on which side has more unique interest for the included terms.
  // Default to sale if unknown.
  let saleU = 0;
  let wantedU = 0;
  let saleC = 0;
  let wantedC = 0;
  const categoryVotes = new Map<string, number>();

  for (const t of input.includedTerms) {
    const s = input.candidateStatsByTerm.get(String(t).toLowerCase()) ?? null;
    if (!s) continue;
    saleU += s.saleUnique;
    wantedU += s.wantedUnique;
    saleC += s.saleCount;
    wantedC += s.wantedCount;
    if (s.topCategory) categoryVotes.set(s.topCategory, (categoryVotes.get(s.topCategory) ?? 0) + 1);
  }

  const type = wantedU > saleU ? "wanted" : "sale";
  const q = String(input.label ?? "").trim();

  // Category: pick the most voted, but avoid setting blank categories.
  let category: string | undefined = undefined;
  let bestCat = "";
  let bestVotes = 0;
  for (const [k, v] of categoryVotes.entries()) {
    if (!k) continue;
    if (v > bestVotes) {
      bestVotes = v;
      bestCat = k;
    }
  }
  if (bestCat) category = bestCat;

  // We intentionally use q (not species) to keep results broad/community-driven.
  const params: Record<string, string> = { type, q };
  if (category) params.category = category;
  return params;
}

router.get("/settings", requireSuperadmin, (req, res) => {
  const db = getDb(req);
  const rows = db.prepare(`SELECT key,value_json,updated_at,updated_by_user_id FROM site_settings`).all() as any[];
  const map = new Map<string, any>();
  for (const r of rows) map.set(String(r.key), parseJsonValue(r.value_json));

  const defaults = {
    requireApproval: false,
    listingTtlDays: 30,
    rateLimitWindowMs: 60_000,
    rateLimitMax: 240,
    featuredMaxDays: 365,
  };

  return res.json({
    settings: {
      requireApproval: typeof map.get("requireApproval") === "boolean" ? map.get("requireApproval") : defaults.requireApproval,
      listingTtlDays: Number.isFinite(Number(map.get("listingTtlDays"))) ? Number(map.get("listingTtlDays")) : defaults.listingTtlDays,
      rateLimitWindowMs: Number.isFinite(Number(map.get("rateLimitWindowMs"))) ? Number(map.get("rateLimitWindowMs")) : defaults.rateLimitWindowMs,
      rateLimitMax: Number.isFinite(Number(map.get("rateLimitMax"))) ? Number(map.get("rateLimitMax")) : defaults.rateLimitMax,
      featuredMaxDays: Number.isFinite(Number(map.get("featuredMaxDays"))) ? Number(map.get("featuredMaxDays")) : defaults.featuredMaxDays,
    },
  });
});

router.post("/settings", requireSuperadmin, (req, res) => {
  const parsed = SiteSettingsSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });

  const db = getDb(req);
  const now = nowIso();

  const changes: Record<string, any> = {};
  const upsert = db.prepare(
    `
INSERT INTO site_settings(key,value_json,updated_at,updated_by_user_id)
VALUES(?,?,?,?)
ON CONFLICT(key) DO UPDATE SET
  value_json=excluded.value_json,
  updated_at=excluded.updated_at,
  updated_by_user_id=excluded.updated_by_user_id
`
  );

  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(parsed.data)) {
      changes[k] = v;
      upsert.run(k, JSON.stringify(v), now, req.user!.id);
    }
  });

  try {
    tx();
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? "Failed to update settings" });
  }

  try {
    (req.app as any)?.locals?.invalidateSettingsCache?.();
  } catch {
    // ignore
  }

  audit(db, req.user!.id, "update_settings", "settings", "site", { changes });
  return res.json({ ok: true });
});

// --- Popular searches (LLM-curated; superadmin only) ---
const PopularLlmProviderSchema = z.enum(["openai", "gemini"]);
const SavePopularLlmSettingsSchema = z.object({
  provider: PopularLlmProviderSchema,
  model: z.string().min(1).max(120),
  apiKey: z.string().min(1).max(500).optional(),
  metaPrompt: z.string().min(10).max(10_000).optional(),
});

router.get("/popular-searches/settings", requireSuperadmin, (req, res) => {
  const db = getDb(req);
  const provider = getSiteSetting(db, "popularSearchesLlmProvider");
  const model = getSiteSetting(db, "popularSearchesLlmModel");
  const apiKeyEnc = getSiteSetting(db, "popularSearchesLlmApiKeyEnc");
  const metaPrompt = getSiteSetting(db, "popularSearchesLlmMetaPrompt");
  return res.json({
    provider: typeof provider === "string" ? provider : null,
    model: typeof model === "string" ? model : null,
    apiKeySet: typeof apiKeyEnc === "string" && apiKeyEnc.trim().length > 0,
    metaPrompt: typeof metaPrompt === "string" && metaPrompt.trim() ? metaPrompt : DEFAULT_POPULAR_SEARCHES_META_PROMPT,
  });
});

router.post("/popular-searches/settings", requireSuperadmin, (req, res) => {
  const parsed = SavePopularLlmSettingsSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });

  const db = getDb(req);

  const nextMetaPrompt = parsed.data.metaPrompt !== undefined ? String(parsed.data.metaPrompt).trim() : undefined;

  const nextApiKeyEnc = (() => {
    if (parsed.data.apiKey === undefined) return undefined;
    try {
      return encryptSecret(parsed.data.apiKey);
    } catch (e: any) {
      return { error: e?.message ?? "Failed to encrypt API key" } as any;
    }
  })();

  if (nextApiKeyEnc && typeof nextApiKeyEnc === "object" && "error" in nextApiKeyEnc) {
    return res.status(400).json({ error: String((nextApiKeyEnc as any).error) });
  }

  const tx = db.transaction(() => {
    upsertSiteSetting(db, "popularSearchesLlmProvider", parsed.data.provider, req.user!.id);
    upsertSiteSetting(db, "popularSearchesLlmModel", parsed.data.model, req.user!.id);
    if (nextApiKeyEnc !== undefined) upsertSiteSetting(db, "popularSearchesLlmApiKeyEnc", nextApiKeyEnc, req.user!.id);
    if (nextMetaPrompt !== undefined) upsertSiteSetting(db, "popularSearchesLlmMetaPrompt", nextMetaPrompt, req.user!.id);
  });

  try {
    tx();
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? "Failed to save LLM settings" });
  }

  audit(db, req.user!.id, "popular_searches_llm_settings", "settings", "popular-searches-llm", {
    provider: parsed.data.provider,
    model: parsed.data.model,
    apiKeySet: true,
    metaPromptUpdated: nextMetaPrompt !== undefined,
  });

  return res.json({ ok: true });
});

const GeneratePopularDraftSchema = z.object({
  windowHours: z.number().int().min(1).max(168).optional().default(24),
  candidateLimit: z.number().int().min(20).max(500).optional().default(200),
  outputLimit: z.number().int().min(1).max(50).optional().default(12),
});

function looksSensitiveOrJunk(term: string): boolean {
  const s = String(term ?? "").trim();
  if (!s) return true;
  if (s.length > 80) return true;
  if (/https?:\/\//i.test(s)) return true;
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(s)) return true;
  // Phone-ish: many digits with optional separators.
  const digits = s.replace(/\D/g, "");
  if (digits.length >= 9 && digits.length <= 15) return true;
  // Mostly numeric / punctuation
  const alphaNum = s.replace(/[^a-z0-9]/gi, "");
  if (!alphaNum) return true;
  const letters = alphaNum.replace(/[^a-z]/gi, "").length;
  const nums = alphaNum.replace(/[^0-9]/g, "").length;
  if (letters === 0 && nums > 0) return true;
  return false;
}

function normalizeCandidateTerm(speciesNorm: string, qNorm: string) {
  const base = (speciesNorm || qNorm || "").trim().toLowerCase();
  return base.slice(0, 80);
}

function loadPopularLlmSettingsOrThrow(db: Database.Database) {
  const providerRaw = getSiteSetting(db, "popularSearchesLlmProvider");
  const modelRaw = getSiteSetting(db, "popularSearchesLlmModel");
  const apiKeyEncRaw = getSiteSetting(db, "popularSearchesLlmApiKeyEnc");
  const metaPromptRaw = getSiteSetting(db, "popularSearchesLlmMetaPrompt");
  const provider = PopularLlmProviderSchema.safeParse(providerRaw).success ? (providerRaw as any) : null;
  const model = typeof modelRaw === "string" ? String(modelRaw).trim() : "";
  const apiKeyEnc = typeof apiKeyEncRaw === "string" ? String(apiKeyEncRaw).trim() : "";
  if (!provider) throw new Error("LLM provider is not configured");
  if (!model) throw new Error("LLM model is not configured");
  if (!apiKeyEnc) throw new Error("LLM API key is not configured");
  const apiKey = decryptSecret(apiKeyEnc);
  if (!apiKey) throw new Error("LLM API key could not be decrypted");
  const metaPrompt = typeof metaPromptRaw === "string" && metaPromptRaw.trim() ? String(metaPromptRaw) : DEFAULT_POPULAR_SEARCHES_META_PROMPT;
  return { provider, model, apiKey, metaPrompt };
}

type PopularLlmCfg = { provider: "openai" | "gemini"; model: string; apiKey: string; metaPrompt: string };

let lastPopularGenerateAtMs = 0;
router.post("/popular-searches/generate", requireSuperadmin, (req, res) => {
  const nowMs = Date.now();
  if (nowMs - lastPopularGenerateAtMs < 10_000) {
    return res.status(429).json({ error: "Please wait a moment before generating again." });
  }
  lastPopularGenerateAtMs = nowMs;

  const parsed = GeneratePopularDraftSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });

  const db = getDb(req);

  let cfg: PopularLlmCfg;
  try {
    cfg = loadPopularLlmSettingsOrThrow(db);
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? "LLM settings not configured" });
  }

  const windowEndIso = new Date().toISOString();
  const windowStartIso = new Date(Date.now() - parsed.data.windowHours * 60 * 60 * 1000).toISOString();

  const rows = db
    .prepare(
      `
SELECT
  browse_type,
  category,
  q_norm,
  species_norm,
  COUNT(*) as c,
  COUNT(DISTINCT ip_hash) as u
FROM search_events
WHERE created_at >= ?
  AND created_at <= ?
  AND (q_norm <> '' OR species_norm <> '')
GROUP BY browse_type, category, q_norm, species_norm
ORDER BY u DESC, c DESC
LIMIT ?
`
    )
    .all(windowStartIso, windowEndIso, parsed.data.candidateLimit) as any[];

  let dropped = 0;
  const candidates: PopularSearchCandidate[] = [];
  for (const r of rows) {
    const browseType = String(r?.browse_type ?? "sale") === "wanted" ? ("wanted" as const) : ("sale" as const);
    const category = String(r?.category ?? "").trim().slice(0, 60);
    const qNorm = String(r?.q_norm ?? "").trim().slice(0, 80);
    const speciesNorm = String(r?.species_norm ?? "").trim().slice(0, 80);
    const term = normalizeCandidateTerm(speciesNorm, qNorm);
    const count = Number(r?.c ?? 0);
    const unique = Number(r?.u ?? 0);

    if (!term || looksSensitiveOrJunk(term)) {
      dropped += 1;
      continue;
    }

    candidates.push({
      term,
      browseType,
      category,
      count: Number.isFinite(count) ? count : 0,
      unique: Number.isFinite(unique) ? unique : 0,
    });
  }

  if (candidates.length === 0) {
    return res.status(400).json({ error: "Not enough safe search data to generate popular searches." });
  }

  (async () => {
    const outputLimit = parsed.data.outputLimit;

    let llmRawText = "";
    let llmOut: any = null;
    try {
      if (cfg.provider === "openai") {
        const r = await generatePopularSearchesOpenAI({
          apiKey: cfg.apiKey,
          model: cfg.model,
          metaPrompt: cfg.metaPrompt,
          candidates,
          outputLimit,
        });
        llmOut = r.output;
        llmRawText = r.rawText;
      } else {
        const r = await generatePopularSearchesGemini({
          apiKey: cfg.apiKey,
          model: cfg.model,
          metaPrompt: cfg.metaPrompt,
          candidates,
          outputLimit,
        });
        llmOut = r.output;
        llmRawText = r.rawText;
      }
    } catch (e: any) {
      return res.status(400).json({ error: e?.message ?? "LLM generation failed" });
    }

    const setId = crypto.randomUUID();
    const now = nowIso();

    // Build candidate stats index for derived params + expandable raw term details.
    const categoryVotesByTerm = new Map<string, Map<string, number>>();
    const candidateStatsByTerm = new Map<
      string,
      { saleUnique: number; wantedUnique: number; saleCount: number; wantedCount: number; topCategory: string | null }
    >();

    for (const c of candidates) {
      const t = String(c.term ?? "").trim().toLowerCase();
      if (!t) continue;
      const cur = candidateStatsByTerm.get(t) ?? { saleUnique: 0, wantedUnique: 0, saleCount: 0, wantedCount: 0, topCategory: null };
      if (c.browseType === "wanted") {
        cur.wantedUnique += Number(c.unique ?? 0) || 0;
        cur.wantedCount += Number(c.count ?? 0) || 0;
      } else {
        cur.saleUnique += Number(c.unique ?? 0) || 0;
        cur.saleCount += Number(c.count ?? 0) || 0;
      }
      candidateStatsByTerm.set(t, cur);

      const cat = String(c.category ?? "").trim();
      if (cat) {
        const m = categoryVotesByTerm.get(t) ?? new Map<string, number>();
        m.set(cat, (m.get(cat) ?? 0) + 1);
        categoryVotesByTerm.set(t, m);
      }
    }

    for (const [t, stats] of candidateStatsByTerm.entries()) {
      const votes = categoryVotesByTerm.get(t) ?? null;
      if (votes) {
        let best = "";
        let bestV = 0;
        for (const [k, v] of votes.entries()) {
          if (v > bestV) {
            bestV = v;
            best = k;
          }
        }
        stats.topCategory = best || null;
      }
    }

    // Build items (sanitize params and enforce either q or species).
    const items = (llmOut?.items ?? [])
      .map((it: any, idx: number) => {
        const includeTermsRaw = Array.isArray(it?.include_terms) ? it.include_terms.map((x: any) => String(x)).filter(Boolean) : [];
        const includeTerms = includeTermsRaw.map((x: string) => x.trim()).filter(Boolean).slice(0, 80);
        const label = sanitizePopularSearchLabel(it?.label) || sanitizePopularSearchLabel(includeTerms[0] ?? "") || sanitizePopularSearchLabel("");
        if (!label) return null;

        const conf = it?.confidence != null && Number.isFinite(Number(it.confidence)) ? Number(it.confidence) : null;

        // Build candidate stats index (term -> aggregate) once per request.
        // (closed over via outer scope below)
        const includedLower = includeTerms.map((t: string) => t.toLowerCase());
        const params = deriveParamsFromIncludedTerms({
          label,
          includedTerms: includedLower.length ? includedLower : [label.toLowerCase()],
          candidateStatsByTerm,
        });

        const includedDetails = (includedLower.length ? includedLower : [label.toLowerCase()]).map((t: string) => {
          const s = candidateStatsByTerm.get(t);
          return {
            term: t,
            saleUnique: s?.saleUnique ?? 0,
            wantedUnique: s?.wantedUnique ?? 0,
            saleCount: s?.saleCount ?? 0,
            wantedCount: s?.wantedCount ?? 0,
            topCategory: s?.topCategory ?? null,
          };
        });

        return {
          id: crypto.randomUUID(),
          setId,
          rank: idx + 1,
          label,
          params,
          paramsJson: JSON.stringify(params),
          includedTermsJson: includedDetails.length ? JSON.stringify(includedDetails) : null,
          confidence: conf,
          enabled: 1,
        };
      })
      .filter(Boolean) as any[];

    if (items.length === 0) {
      return res.status(400).json({ error: "LLM returned no valid items." });
    }

    const tx = db.transaction(() => {
      db.prepare(
        `
INSERT INTO popular_search_sets(
  id, window_start_iso, window_end_iso, provider, model, status, raw_llm_output_json, created_at, updated_at, created_by_user_id
) VALUES(?,?,?,?,?,'draft',?,?,?,?)
`
      ).run(
        setId,
        windowStartIso,
        windowEndIso,
        cfg.provider,
        cfg.model,
        JSON.stringify({ rawText: llmRawText, parsed: llmOut }),
        now,
        now,
        req.user!.id
      );

      const ins = db.prepare(
        `
INSERT INTO popular_search_items(
  id,set_id,rank,label,params_json,included_terms_json,confidence,enabled
) VALUES(?,?,?,?,?,?,?,?)
`
      );
      for (const it of items) {
        ins.run(it.id, setId, it.rank, it.label, it.paramsJson, it.includedTermsJson, it.confidence, it.enabled);
      }
    });

    try {
      tx();
    } catch (e: any) {
      return res.status(400).json({ error: e?.message ?? "Failed to save draft" });
    }

    audit(db, req.user!.id, "popular_searches_generate", "popular_search_set", setId, {
      provider: cfg.provider,
      model: cfg.model,
      windowStartIso,
      windowEndIso,
      candidatesTotal: rows.length,
      candidatesUsed: candidates.length,
      candidatesDropped: dropped,
      outputItems: items.length,
    });

    return res.json({
      set: {
        id: setId,
        windowStartIso,
        windowEndIso,
        provider: cfg.provider,
        model: cfg.model,
        status: "draft",
        createdAt: now,
        updatedAt: now,
      },
      items: items.map((it) => ({
        id: it.id,
        rank: it.rank,
        label: it.label,
        includedTerms: it.includedTermsJson ? (JSON.parse(it.includedTermsJson) as any[]) : [],
        confidence: it.confidence,
        enabled: Boolean(it.enabled),
      })),
      inputSummary: {
        windowHours: parsed.data.windowHours,
        candidatesTotal: rows.length,
        candidatesUsed: candidates.length,
        candidatesDropped: dropped,
      },
    });
  })();
});

router.get("/popular-searches/sets/:id", requireSuperadmin, (req, res) => {
  const db = getDb(req);
  const id = String(req.params.id ?? "").trim();
  if (!id) return res.status(400).json({ error: "Missing id" });

  const set = db.prepare(`SELECT * FROM popular_search_sets WHERE id = ?`).get(id) as any | undefined;
  if (!set) return res.status(404).json({ error: "Not found" });

  const rows = db.prepare(`SELECT * FROM popular_search_items WHERE set_id = ? ORDER BY rank ASC`).all(id) as any[];
  return res.json({
    set: {
      id: String(set.id),
      windowStartIso: String(set.window_start_iso),
      windowEndIso: String(set.window_end_iso),
      provider: String(set.provider),
      model: String(set.model),
      status: String(set.status),
      createdAt: String(set.created_at),
      updatedAt: String(set.updated_at),
    },
    items: rows.map((r) => ({
      id: String(r.id),
      rank: Number(r.rank ?? 0),
      label: String(r.label ?? ""),
      includedTerms: (() => {
        try {
          return r.included_terms_json ? (JSON.parse(String(r.included_terms_json)) as any[]) : [];
        } catch {
          return [];
        }
      })(),
      confidence: r.confidence != null ? Number(r.confidence) : null,
      enabled: Boolean(Number(r.enabled ?? 0)),
    })),
  });
});

router.get("/popular-searches/latest-draft", requireSuperadmin, (req, res) => {
  const db = getDb(req);
  const set = db
    .prepare(
      `
SELECT *
FROM popular_search_sets
WHERE status = 'draft'
ORDER BY updated_at DESC
LIMIT 1
`
    )
    .get() as any | undefined;

  if (!set) return res.json({ set: null, items: [] });

  const setId = String(set.id);
  const rows = db.prepare(`SELECT * FROM popular_search_items WHERE set_id = ? ORDER BY rank ASC`).all(setId) as any[];

  return res.json({
    set: {
      id: setId,
      windowStartIso: String(set.window_start_iso),
      windowEndIso: String(set.window_end_iso),
      provider: String(set.provider),
      model: String(set.model),
      status: String(set.status),
      createdAt: String(set.created_at),
      updatedAt: String(set.updated_at),
    },
    items: rows.map((r) => ({
      id: String(r.id),
      rank: Number(r.rank ?? 0),
      label: String(r.label ?? ""),
      includedTerms: (() => {
        try {
          return r.included_terms_json ? (JSON.parse(String(r.included_terms_json)) as any[]) : [];
        } catch {
          return [];
        }
      })(),
      confidence: r.confidence != null ? Number(r.confidence) : null,
      enabled: Boolean(Number(r.enabled ?? 0)),
    })),
  });
});

router.get("/popular-searches/latest-published", requireSuperadmin, (req, res) => {
  const db = getDb(req);
  const set = db
    .prepare(
      `
SELECT id, window_start_iso, window_end_iso, provider, model, status, created_at, updated_at
FROM popular_search_sets
WHERE status = 'published'
ORDER BY updated_at DESC
LIMIT 1
`
    )
    .get() as any | undefined;

  if (!set) return res.json({ set: null });
  return res.json({
    set: {
      id: String(set.id),
      windowStartIso: String(set.window_start_iso),
      windowEndIso: String(set.window_end_iso),
      provider: String(set.provider) as any,
      model: String(set.model),
      status: "published" as const,
      createdAt: String(set.created_at),
      updatedAt: String(set.updated_at),
    },
  });
});

const PopularSearchDraftItemEditSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(80),
  enabled: z.boolean().optional().default(true),
});
const UpdatePopularSearchSetSchema = z.object({
  items: z.array(PopularSearchDraftItemEditSchema).max(50),
});

router.put("/popular-searches/sets/:id", requireSuperadmin, (req, res) => {
  const id = String(req.params.id ?? "").trim();
  if (!id) return res.status(400).json({ error: "Missing id" });

  const parsed = UpdatePopularSearchSetSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });

  const db = getDb(req);
  const set = db.prepare(`SELECT id,status FROM popular_search_sets WHERE id = ?`).get(id) as any | undefined;
  if (!set) return res.status(404).json({ error: "Not found" });
  if (String(set.status) !== "draft") return res.status(400).json({ error: "Only draft sets can be edited" });

  const now = nowIso();

  const existing = db.prepare(`SELECT * FROM popular_search_items WHERE set_id = ?`).all(id) as any[];
  const byId = new Map<string, any>();
  for (const r of existing) byId.set(String(r.id), r);

  function paramsJsonFromLabel(label: string) {
    const raw = String(label ?? "").trim();
    const m = raw.match(/^(.*)\s+\(([^)]+)\)\s*$/);
    const q = (m ? String(m[1] ?? "").trim() : raw).trim();
    const category = (m ? String(m[2] ?? "").trim() : "").trim();
    const params: Record<string, string> = { type: "sale" };
    if (category) params.category = category;
    if (q) params.q = q;
    return JSON.stringify(params);
  }

  const items = parsed.data.items
    .map((it, idx) => {
      const prev = byId.get(String(it.id));
      return {
        id: String(it.id),
        rank: idx + 1,
        label: sanitizePopularSearchLabel(it.label),
        paramsJson: prev ? String(prev.params_json ?? "{}") : paramsJsonFromLabel(it.label),
        includedTermsJson: prev && prev.included_terms_json != null ? String(prev.included_terms_json) : null,
        confidence: prev && prev.confidence != null ? Number(prev.confidence) : null,
        enabled: it.enabled ? 1 : 0,
      };
    })
    .filter(Boolean) as any[];

  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM popular_search_items WHERE set_id = ?`).run(id);
    const ins = db.prepare(
      `
INSERT INTO popular_search_items(id,set_id,rank,label,params_json,included_terms_json,confidence,enabled)
VALUES(?,?,?,?,?,?,?,?)
`
    );
    for (const it of items) ins.run(it.id, id, it.rank, it.label, it.paramsJson, it.includedTermsJson, it.confidence, it.enabled);
    db.prepare(`UPDATE popular_search_sets SET updated_at = ? WHERE id = ?`).run(now, id);
  });

  try {
    tx();
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? "Failed to update draft" });
  }

  audit(db, req.user!.id, "popular_searches_update_draft", "popular_search_set", id, { items: items.length });
  return res.json({ ok: true });
});

router.post("/popular-searches/sets/:id/publish", requireSuperadmin, (req, res) => {
  const id = String(req.params.id ?? "").trim();
  if (!id) return res.status(400).json({ error: "Missing id" });

  const db = getDb(req);
  const set = db.prepare(`SELECT id,status FROM popular_search_sets WHERE id = ?`).get(id) as any | undefined;
  if (!set) return res.status(404).json({ error: "Not found" });
  if (String(set.status) !== "draft") return res.status(400).json({ error: "Set is not a draft" });

  const now = nowIso();
  const tx = db.transaction(() => {
    db.prepare(`UPDATE popular_search_sets SET status = 'draft', updated_at = ? WHERE status = 'published'`).run(now);
    db.prepare(`UPDATE popular_search_sets SET status = 'published', updated_at = ? WHERE id = ?`).run(now, id);
  });

  try {
    tx();
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? "Failed to publish" });
  }

  audit(db, req.user!.id, "popular_searches_publish", "popular_search_set", id, {});
  return res.json({ ok: true });
});

// --- Approvals ---
router.get("/approvals", (req, res) => {
  const kindRaw = String(req.query.kind ?? "all").trim();
  const kind = kindRaw === "sale" || kindRaw === "wanted" ? kindRaw : "all";

  const db = getDb(req);

  const limitRaw = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw!))) : 50;
  const offsetRaw = req.query.offset !== undefined ? Number(req.query.offset) : undefined;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw!)) : 0;

  const sortKey = String(req.query.sortKey ?? "").trim();
  const sortDir = parseSortDir(req.query.sortDir, "desc");
  const dirSql = sortDirSql(sortDir);
  const orderBySql = (() => {
    switch (sortKey) {
      case "createdAt":
        return `l.created_at ${dirSql}, l.id ${dirSql}`;
      case "kind":
        return `l.listing_type ${dirSql}, l.created_at DESC, l.id DESC`;
      case "title":
        return `lower(COALESCE(l.title,'')) ${dirSql}, l.id ${dirSql}`;
      case "category":
        return `lower(COALESCE(l.category,'')) ${dirSql}, l.id ${dirSql}`;
      case "location":
        return `lower(COALESCE(l.location,'')) ${dirSql}, l.id ${dirSql}`;
      case "user":
        return `lower(COALESCE(u.username,'') || '\n' || COALESCE(u.email,'')) ${dirSql}, l.id ${dirSql}`;
      default:
        return `l.created_at DESC, l.id DESC`;
    }
  })();

  const where: string[] = [`l.status = 'pending'`];
  const params: any[] = [];
  if (kind === "sale") where.push(`l.listing_type = 0`);
  if (kind === "wanted") where.push(`l.listing_type = 1`);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const totalRow = db
    .prepare(
      `
SELECT COUNT(*) as c
FROM listings l
${whereSql}
`
    )
    .get(...params) as any;
  const total = Number(totalRow?.c ?? 0);

  const rows = db
    .prepare(
      `
SELECT l.id,l.listing_type,l.title,l.category,l.location,l.created_at,l.updated_at,
       u.id as user_id,u.username as user_username,u.email as user_email
FROM listings l
JOIN users u ON u.id = l.user_id
${whereSql}
ORDER BY ${orderBySql}
LIMIT ? OFFSET ?
`
    )
    .all(...params, limit, offset) as any[];

  const items = rows.map((r) => ({
    kind: Number(r.listing_type) === 1 ? ("wanted" as const) : ("sale" as const),
    id: String(r.id),
    title: String(r.title ?? ""),
    category: String(r.category ?? ""),
    location: String(r.location ?? ""),
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
    user: {
      id: Number(r.user_id),
      username: String(r.user_username ?? ""),
      email: String(r.user_email ?? ""),
    },
  }));

  return res.json({ items, total, limit, offset });
});

router.post("/approvals/:kind/:id/approve", (req, res) => {
  const kind = String(req.params.kind ?? "").trim();
  const id = String(req.params.id ?? "").trim();
  if (kind !== "sale" && kind !== "wanted") return res.status(400).json({ error: "Invalid kind" });
  if (!id) return res.status(400).json({ error: "Missing id" });

  const db = getDb(req);
  const lt = kind === "sale" ? 0 : 1;
  const row = db.prepare(`SELECT id,user_id,title,status FROM listings WHERE id = ? AND listing_type = ?`).get(id, lt) as any | undefined;
  if (!row) return res.status(404).json({ error: "Not found" });

  const now = nowIso();
  db.prepare(
    `
UPDATE listings
SET status = 'active',
    published_at = COALESCE(published_at, ?),
    updated_at = ?
WHERE id = ?
AND listing_type = ?
`
  ).run(now, now, id, lt);
  audit(db, req.user!.id, "approve", kind, id, { prevStatus: row.status });
  const ownerUserId = row.user_id != null ? Number(row.user_id) : null;
  if (ownerUserId != null && Number.isFinite(ownerUserId) && ownerUserId !== req.user!.id) {
    const title = String(row.title ?? "").trim() || "your listing";
    notify(
      db,
      ownerUserId,
      "listing_approved",
      withListingTitle("Listing approved", title),
      "Your listing was approved and is now live.",
      { listingId: id, listingType: kind }
    );
  }
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
  const row = db.prepare(`SELECT id,user_id,title,status FROM listings WHERE id = ? AND listing_type = ?`).get(id, lt) as any | undefined;
  if (!row) return res.status(404).json({ error: "Not found" });

  const now = nowIso();
  db.prepare(`UPDATE listings SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ? AND listing_type = ?`).run(now, now, id, lt);
  audit(db, req.user!.id, "reject", kind, id, { prevStatus: row.status, note: parsed.data.note ?? null });
  const ownerUserId = row.user_id != null ? Number(row.user_id) : null;
  if (ownerUserId != null && Number.isFinite(ownerUserId) && ownerUserId !== req.user!.id) {
    const title = String(row.title ?? "").trim() || "your listing";
    const note = parsed.data.note ?? null;
    const body = note ? `Your listing was rejected by an admin.\n\nNote: ${note}` : "Your listing was rejected by an admin.";
    notify(
      db,
      ownerUserId,
      "listing_rejected",
      withListingTitle("Listing rejected", title),
      body,
      { listingId: id, listingType: kind, note }
    );
  }
  return res.json({ ok: true });
});

// --- Reports ---
router.get("/reports", (req, res) => {
  const statusRaw = String(req.query.status ?? "open").trim();
  const status = statusRaw === "resolved" ? "resolved" : "open";

  const db = getDb(req);

  const limitRaw = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw!))) : 50;
  const offsetRaw = req.query.offset !== undefined ? Number(req.query.offset) : undefined;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw!)) : 0;

  const sortKey = String(req.query.sortKey ?? "").trim();
  const sortDir = parseSortDir(req.query.sortDir, "desc");
  const dirSql = sortDirSql(sortDir);
  const orderBySql = (() => {
    switch (sortKey) {
      case "createdAt":
        return `r.created_at ${dirSql}, r.id ${dirSql}`;
      case "target":
        return `lower(COALESCE(r.target_kind,'') || ':' || COALESCE(r.target_id,'')) ${dirSql}, r.id ${dirSql}`;
      case "reason":
        return `lower(COALESCE(r.reason,'')) ${dirSql}, r.id ${dirSql}`;
      case "reporter":
        return `lower(COALESCE(u.username,'') || '\n' || COALESCE(u.email,'')) ${dirSql}, r.id ${dirSql}`;
      case "owner":
        return `lower(COALESCE(ou.username,'') || '\n' || COALESCE(ou.email,'')) ${dirSql}, r.id ${dirSql}`;
      default:
        return `r.created_at DESC, r.id DESC`;
    }
  })();

  const totalRow = db.prepare(`SELECT COUNT(*) as c FROM reports r WHERE r.status = ?`).get(status) as any;
  const total = Number(totalRow?.c ?? 0);

  const rows = db
    .prepare(
      `
SELECT r.*,
       u.username as reporter_username,u.email as reporter_email,
       ou.id as owner_user_id, ou.username as owner_username, ou.email as owner_email
FROM reports r
JOIN users u ON u.id = r.reporter_user_id
LEFT JOIN listings l ON l.id = r.target_id AND l.listing_type = (CASE WHEN r.target_kind = 'wanted' THEN 1 ELSE 0 END)
LEFT JOIN users ou ON ou.id = l.user_id
WHERE r.status = ?
ORDER BY ${orderBySql}
LIMIT ? OFFSET ?
`
    )
    .all(status, limit, offset) as any[];

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
    owner:
      r.owner_user_id != null
        ? { userId: Number(r.owner_user_id), username: String(r.owner_username ?? ""), email: String(r.owner_email ?? "") }
        : null,
    resolvedByUserId: r.resolved_by_user_id != null ? Number(r.resolved_by_user_id) : null,
    resolvedNote: r.resolved_note != null ? String(r.resolved_note) : null,
  }));

  return res.json({ items, total, limit, offset });
});

router.get("/reports/:id", (req, res) => {
  const id = String(req.params.id ?? "").trim();
  if (!id) return res.status(400).json({ error: "Missing id" });
  const db = getDb(req);
  const r = db
    .prepare(
      `
SELECT r.*,
       u.username as reporter_username,u.email as reporter_email,
       ou.id as owner_user_id, ou.username as owner_username, ou.email as owner_email
FROM reports r
JOIN users u ON u.id = r.reporter_user_id
LEFT JOIN listings l ON l.id = r.target_id AND l.listing_type = (CASE WHEN r.target_kind = 'wanted' THEN 1 ELSE 0 END)
LEFT JOIN users ou ON ou.id = l.user_id
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
      owner:
        r.owner_user_id != null
          ? { userId: Number(r.owner_user_id), username: String(r.owner_username ?? ""), email: String(r.owner_email ?? "") }
          : null,
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
  const row = db.prepare(`SELECT id,status,reporter_user_id,target_kind,target_id FROM reports WHERE id = ?`).get(id) as any | undefined;
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

const ReportActionSchema = z.object({
  action: z.enum(["resolve_only", "hide_listing", "warn_user", "suspend_user", "ban_user"]),
  note: z.string().max(800).optional().nullable(),
  suspendDays: z.number().int().min(1).max(3650).optional().nullable(),
});

router.post("/reports/:id/action", (req, res) => {
  const id = String(req.params.id ?? "").trim();
  if (!id) return res.status(400).json({ error: "Missing id" });
  const parsed = ReportActionSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });

  const db = getDb(req);
  const report = db.prepare(`SELECT * FROM reports WHERE id = ?`).get(id) as any | undefined;
  if (!report) return res.status(404).json({ error: "Not found" });
  if (String(report.status) !== "open") return res.status(400).json({ error: "Report is not open" });

  const action = parsed.data.action;
  const note = parsed.data.note ?? null;
  const now = nowIso();

  const targetKind = String(report.target_kind ?? "");
  const targetId = String(report.target_id ?? "");
  const lt = targetKind === "wanted" ? 1 : 0;

  const listing = db.prepare(`SELECT id,user_id,listing_type,status,title FROM listings WHERE id = ? AND listing_type = ?`).get(targetId, lt) as any | undefined;
  const targetUserId = listing?.user_id != null ? Number(listing.user_id) : null;

  const tx = db.transaction(() => {
    // Content action(s)
    if (action === "hide_listing") {
      if (!listing) throw new Error("Target listing not found");
      db.prepare(`UPDATE listings SET status='deleted', deleted_at = COALESCE(deleted_at, ?), updated_at = ? WHERE id = ? AND listing_type = ?`).run(
        now,
        now,
        targetId,
        lt
      );
    }

    // User action(s)
    if (action === "ban_user" || action === "suspend_user" || action === "warn_user") {
      if (!Number.isFinite(targetUserId as any)) throw new Error("Target user not found");
      const targetUser = db.prepare(`SELECT id,is_superadmin FROM users WHERE id = ?`).get(targetUserId) as any | undefined;
      if (!targetUser) throw new Error("Target user not found");
      if (Number(targetUser.is_superadmin ?? 0) === 1 && !req.user!.isSuperadmin) {
        throw new Error("Only superadmin can moderate a superadmin");
      }

      if (action === "ban_user") {
        const existing = db.prepare(`SELECT user_id FROM user_moderation WHERE user_id = ?`).get(targetUserId) as any | undefined;
        if (!existing) {
          db.prepare(`INSERT INTO user_moderation(user_id,status,reason,suspended_until,created_at,updated_at) VALUES(?,?,?,?,?,?)`).run(
            targetUserId,
            "banned",
            note,
            null,
            now,
            now
          );
        } else {
          db.prepare(`UPDATE user_moderation SET status='banned', reason=?, suspended_until=NULL, updated_at=? WHERE user_id=?`).run(note, now, targetUserId);
        }
        db.prepare(`UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ?`).run(now, targetUserId);
      }

      if (action === "suspend_user") {
        const days = parsed.data.suspendDays ?? null;
        const until = days == null ? null : Date.now() + days * 24 * 60 * 60 * 1000;
        const existing = db.prepare(`SELECT user_id FROM user_moderation WHERE user_id = ?`).get(targetUserId) as any | undefined;
        if (!existing) {
          db.prepare(`INSERT INTO user_moderation(user_id,status,reason,suspended_until,created_at,updated_at) VALUES(?,?,?,?,?,?)`).run(
            targetUserId,
            "suspended",
            note,
            until,
            now,
            now
          );
        } else {
          db.prepare(`UPDATE user_moderation SET status='suspended', reason=?, suspended_until=?, updated_at=? WHERE user_id=?`).run(
            note,
            until,
            now,
            targetUserId
          );
        }
        db.prepare(`UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ?`).run(now, targetUserId);
      }

      // warn_user is implemented as audit-only (no state change), but still resolves the report.
    }

    // Resolve report (always)
    const resolvedNote = JSON.stringify({ action, note, suspendDays: parsed.data.suspendDays ?? null });
    db.prepare(
      `UPDATE reports
       SET status='resolved', resolved_by_user_id = ?, resolved_note = ?, updated_at = ?
       WHERE id = ?`
    ).run(req.user!.id, resolvedNote, now, id);
  });

  try {
    tx();
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? "Failed to apply report action" });
  }

  audit(db, req.user!.id, "report_action", "report", id, {
    action,
    note,
    suspendDays: parsed.data.suspendDays ?? null,
    target: { kind: targetKind, id: targetId, listingStatus: listing?.status ?? null, userId: targetUserId },
  });

  const reporterUserId = report.reporter_user_id != null ? Number(report.reporter_user_id) : null;

  // If the report action affected the target user/listing owner, notify them too (best-effort).
  if (targetUserId != null && Number.isFinite(targetUserId) && targetUserId !== req.user!.id && targetUserId !== reporterUserId) {
    const listingTitle = listing?.title ? String(listing.title) : "a listing";
    const notifTitle =
      action === "hide_listing"
        ? withListingTitle("Listing removed", listingTitle)
        : action === "suspend_user"
          ? withListingTitle("Account suspended", listingTitle)
          : action === "ban_user"
            ? withListingTitle("Account banned", listingTitle)
            : withListingTitle("Report reviewed", listingTitle);
    const body =
      action === "hide_listing"
        ? "This listing is no longer visible."
        : action === "suspend_user"
          ? "Your account was suspended."
          : action === "ban_user"
            ? "Your account was banned."
            : "A report related to this listing was reviewed.";
    notify(db, targetUserId, "report_moderation", notifTitle, body, { reportId: id, targetKind, targetId, action, note });
  }

  return res.json({ ok: true });
});

// --- Users (superadmin only) ---
router.get("/users", requireSuperadmin, (req, res) => {
  const q = String(req.query.query ?? "").trim().toLowerCase();
  const limitRaw = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw!))) : 50;
  const offsetRaw = req.query.offset !== undefined ? Number(req.query.offset) : undefined;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw!)) : 0;

  const sortKey = String(req.query.sortKey ?? "").trim();
  const sortDir = parseSortDir(req.query.sortDir, "desc");
  const dirSql = sortDirSql(sortDir);
  const orderBySql = (() => {
    switch (sortKey) {
      case "user":
        return `lower(COALESCE(u.username,'') || '\n' || COALESCE(u.email,'')) ${dirSql}, u.id ${dirSql}`;
      case "admin":
        return `COALESCE(u.is_admin,0) ${dirSql}, u.id ${dirSql}`;
      case "superadmin":
        return `COALESCE(u.is_superadmin,0) ${dirSql}, u.id ${dirSql}`;
      default:
        return `u.id DESC`;
    }
  })();

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
SELECT u.id,u.email,u.username,u.is_admin,u.is_superadmin,u.created_at,u.updated_at,
       p.avatar_url as avatar_url,
       s.last_active_at as last_active_at
FROM users u
LEFT JOIN user_profiles p ON p.user_id = u.id
LEFT JOIN (
  SELECT user_id, MAX(last_used_at) as last_active_at
  FROM sessions
  GROUP BY user_id
) s ON s.user_id = u.id
${whereSql}
ORDER BY ${orderBySql}
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
      lastActiveAt: u.last_active_at ? String(u.last_active_at) : null,
      avatarUrl: u.avatar_url ? String(u.avatar_url) : null,
    })),
    total,
    limit,
    offset,
  });
});

const SetAdminSchema = z.object({ isAdmin: z.boolean() });
router.post("/users/:id/set-admin", requireSuperadmin, requireReauth, (req, res) => {
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
router.post("/users/:id/set-superadmin", requireSuperadmin, requireReauth, (req, res) => {
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

