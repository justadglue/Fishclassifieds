// backend/src/server.ts
import express from "express";
import cors from "cors";
import { z } from "zod";
import { openDb, type ListingRow, type ListingStatus, type ListingResolution } from "./db.js";
import crypto from "crypto";
import multer from "multer";
import path from "path";
import fs from "fs";
import sharp from "sharp";

const app = express();
const db = openDb();

app.use(cors({ origin: process.env.CORS_ORIGIN ?? "http://localhost:5173" }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

// ---------- Uploads ----------
const UPLOADS_DIR = path.join(process.cwd(), "data", "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Serve uploaded files
app.use("/uploads", express.static(UPLOADS_DIR));

function extFromMimetype(mimetype: string) {
  if (mimetype === "image/jpeg") return ".jpg";
  if (mimetype === "image/png") return ".png";
  if (mimetype === "image/webp") return ".webp";
  return "";
}

/**
 * New canonical shape:
 * - fullUrl: original (only used by enlarge modal)
 * - medUrl: used for listing cards, my listings, main image on detail page
 * - thumbUrl: used only for tiny preview strip under main image
 */
type ImageAsset = { fullUrl: string; thumbUrl: string; medUrl: string };

function baseUrl(req: express.Request) {
  return `${req.protocol}://${req.get("host")}`;
}

function toAbs(req: express.Request, maybePath: string) {
  // If already absolute, leave it
  if (/^https?:\/\//i.test(maybePath)) return maybePath;
  // Ensure leading slash for relative paths we generate
  const p = maybePath.startsWith("/") ? maybePath : `/${maybePath}`;
  return `${baseUrl(req)}${p}`;
}

function toRelUploads(filename: string) {
  return `/uploads/${filename}`;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = extFromMimetype(file.mimetype);
      const name = crypto.randomUUID() + ext;
      cb(null, name);
    },
  }),
  limits: {
    fileSize: 6 * 1024 * 1024, // 6MB
  },
  fileFilter: (_req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
    cb(ok ? null : new Error("Only JPG/PNG/WebP images are allowed"), ok);
  },
});

async function makeDerivatives(absPath: string, baseNameNoExt: string): Promise<{ thumb: string; med: string }> {
  const thumbName = `${baseNameNoExt}_thumb.webp`;
  const medName = `${baseNameNoExt}_med.webp`;

  const thumbAbs = path.join(UPLOADS_DIR, thumbName);
  const medAbs = path.join(UPLOADS_DIR, medName);

  // Tiny strip thumbnails under the main image
  const THUMB_W = Number(process.env.IMG_THUMB_W ?? "440");
  // General-purpose "display" image (cards, detail main image)
  const MED_W = Number(process.env.IMG_MED_W ?? "1400");

  const common = sharp(absPath, { failOn: "none" }).rotate().withMetadata();

  await common
    .clone()
    .resize({
      width: THUMB_W,
      withoutEnlargement: true,
      fit: "inside",
      kernel: sharp.kernel.lanczos3,
    })
    .sharpen(0.6, 0.8, 1.2)
    .webp({
      quality: 80,
      effort: 6,
      smartSubsample: true,
      alphaQuality: 85,
    })
    .toFile(thumbAbs);

  await common
    .clone()
    .resize({
      width: MED_W,
      withoutEnlargement: true,
      fit: "inside",
      kernel: sharp.kernel.lanczos3,
    })
    .sharpen(0.4, 0.6, 1.0)
    .webp({
      quality: 85,
      effort: 6,
      smartSubsample: true,
      alphaQuality: 85,
    })
    .toFile(medAbs);

  return { thumb: toRelUploads(thumbName), med: toRelUploads(medName) };
}

// Upload endpoint
app.post("/api/uploads", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image uploaded" });

    const fullRel = toRelUploads(req.file.filename);
    const abs = path.join(UPLOADS_DIR, req.file.filename);

    const base = path.parse(req.file.filename).name;
    const d = await makeDerivatives(abs, base);

    const out: ImageAsset = {
      fullUrl: toAbs(req, fullRel),
      thumbUrl: toAbs(req, d.thumb),
      medUrl: toAbs(req, d.med),
    };

    return res.status(201).json(out);
  } catch (e: any) {
    const msg = e?.message ?? "Upload error";
    return res.status(400).json({ error: msg });
  }
});

// Helpful error handler for multer/fileFilter errors
app.use((err: any, _req: any, res: any, next: any) => {
  if (!err) return next();
  const msg = typeof err?.message === "string" ? err.message : "Upload error";
  return res.status(400).json({ error: msg });
});

// ---------- Ownership helper ----------
function requireOwner(req: express.Request, row: any) {
  const token = String(req.header("x-owner-token") ?? "").trim();
  return token && row?.owner_token && token === row.owner_token;
}

// ---------- Lifecycle + resolution model ----------
const StatusSchema = z.enum(["draft", "pending", "active", "paused", "expired", "deleted"]);
const ResolutionSchema = z.enum(["none", "sold"]);

const PUBLIC_LIFECYCLE: ListingStatus[] = ["active", "pending"];

function addDaysIso(isoNow: string, days: number) {
  const d = new Date(isoNow);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function nowIso() {
  return new Date().toISOString();
}

// Expire pass (run opportunistically)
function runAutoExpirePass() {
  const now = nowIso();
  db.prepare(
    `
    UPDATE listings
    SET status='expired', updated_at=?
    WHERE status <> 'deleted'
      AND status <> 'expired'
      AND expires_at IS NOT NULL
      AND expires_at <> ''
      AND expires_at < ?
  `
  ).run(now, now);
}

// ---------- Listings ----------
const ImageAssetSchema = z.object({
  fullUrl: z.string().min(1),
  thumbUrl: z.string().min(1),
  medUrl: z.string().min(1),
});

const ImagesInputSchema = z.array(z.union([z.string(), ImageAssetSchema])).max(6).optional().default([]);

function normalizeImages(input: (string | ImageAsset)[]): ImageAsset[] {
  return (input ?? []).map((x) => {
    if (typeof x === "string") {
      // If someone sends a plain URL, treat it as "full" and fall back for med/thumb.
      // (Uploads should come from /api/uploads and will already be full/med/thumb.)
      return { fullUrl: x, thumbUrl: x, medUrl: x };
    }
    return x;
  });
}

const CreateListingSchema = z.object({
  title: z.string().min(3).max(80),
  category: z.enum(["Fish", "Shrimp", "Snails", "Plants", "Equipment"]).default("Fish"),
  species: z.string().min(2).max(60),
  priceCents: z.number().int().min(0).max(5_000_000),
  location: z.string().min(2).max(80),
  description: z.string().min(1).max(1000),
  contact: z.string().max(200).optional().nullable(),

  images: ImagesInputSchema,

  // legacy optional single image (kept, but you said legacy doesn't matter)
  imageUrl: z.string().optional().nullable(),

  // optional for future; if provided, must be draft or active
  status: z.enum(["draft", "active"]).optional(),
});

const UpdateListingSchema = z.object({
  title: z.string().min(3).max(80).optional(),
  category: z.enum(["Fish", "Shrimp", "Snails", "Plants", "Equipment"]).optional(),
  species: z.string().min(2).max(60).optional(),
  priceCents: z.number().int().min(0).max(5_000_000).optional(),
  location: z.string().min(2).max(80).optional(),
  description: z.string().min(1).max(1000).optional(),
  contact: z.string().max(200).nullable().optional(),

  images: ImagesInputSchema.optional(),
  imageUrl: z.string().nullable().optional(), // legacy
});

app.post("/api/listings", (req, res) => {
  runAutoExpirePass();

  const parsed = CreateListingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const id = crypto.randomUUID();
  const now = nowIso();
  const ownerToken = crypto.randomUUID();

  const ttlDays = Number(process.env.LISTING_TTL_DAYS ?? "30");
  const expiresAt = addDaysIso(now, Number.isFinite(ttlDays) && ttlDays > 0 ? ttlDays : 30);

  const requireApproval = String(process.env.REQUIRE_APPROVAL ?? "").trim() === "1";

  const { title, category, species, priceCents, location, description, contact, images, imageUrl } = parsed.data;

  const requestedStatus = parsed.data.status;
  const status: ListingStatus = requestedStatus === "draft" ? "draft" : requireApproval ? "pending" : "active";

  db.prepare(
    `INSERT INTO listings (
        id, owner_token, title, category, species, price_cents, location, description, contact, image_url,
        status, expires_at, resolution, resolved_at, created_at, updated_at, deleted_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    ownerToken,
    title,
    category,
    species,
    priceCents,
    location,
    description,
    contact ?? null,
    imageUrl ?? null,
    status,
    expiresAt,
    "none",
    null,
    now,
    now,
    null
  );

  const insertImg = db.prepare(
    `INSERT INTO listing_images (id, listing_id, url, thumb_url, medium_url, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const normalized = normalizeImages(images ?? []);
  const fallback = imageUrl ? [{ fullUrl: imageUrl, thumbUrl: imageUrl, medUrl: imageUrl }] : [];
  const finalImages = (normalized.length ? normalized : fallback).slice(0, 6);

  finalImages.forEach((img, idx) => {
    insertImg.run(crypto.randomUUID(), id, img.fullUrl, img.thumbUrl, img.medUrl, idx);
  });

  const row = db.prepare<ListingRow & any>("SELECT * FROM listings WHERE id = ?").get(id);
  return res.status(201).json({ ...mapListing(req, row!), ownerToken });
});

app.get("/api/listings", (req, res) => {
  runAutoExpirePass();

  const q = String(req.query.q ?? "").trim().toLowerCase();
  const species = String(req.query.species ?? "").trim().toLowerCase();
  const category = String(req.query.category ?? "").trim();

  const min = req.query.minPriceCents ? Number(req.query.minPriceCents) : undefined;
  const max = req.query.maxPriceCents ? Number(req.query.maxPriceCents) : undefined;

  const sort = String(req.query.sort ?? "newest");

  const limitRaw = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw!))) : 24;

  const offsetRaw = req.query.offset !== undefined ? Number(req.query.offset) : undefined;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw!)) : 0;

  const where: string[] = [];
  const params: any[] = [];

  where.push(`status IN ('active','pending')`);
  where.push(`resolution = 'none'`);

  if (q) {
    where.push("(lower(title) LIKE ? OR lower(description) LIKE ? OR lower(location) LIKE ? OR lower(species) LIKE ?)");
    const pat = `%${q}%`;
    params.push(pat, pat, pat, pat);
  }
  if (species) {
    where.push("lower(species) = ?");
    params.push(species);
  }
  if (category) {
    where.push("category = ?");
    params.push(category);
  }
  if (Number.isFinite(min)) {
    where.push("price_cents >= ?");
    params.push(min);
  }
  if (Number.isFinite(max)) {
    where.push("price_cents <= ?");
    params.push(max);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const totalRow = db.prepare(`SELECT COUNT(*) as c FROM listings ${whereSql}`).get(...params) as any;
  const total = Number(totalRow?.c ?? 0);

  let orderBy = "created_at DESC, id DESC";
  if (sort === "price_asc") orderBy = "price_cents ASC, created_at DESC, id DESC";
  if (sort === "price_desc") orderBy = "price_cents DESC, created_at DESC, id DESC";

  const sql = `
    SELECT * FROM listings
    ${whereSql}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;

  const rows = db.prepare(sql).all(...params, limit, offset) as (ListingRow & any)[];

  return res.json({
    items: rows.map((r) => mapListing(req, r)),
    total,
    limit,
    offset,
  });
});

app.get("/api/listings/:id", (req, res) => {
  runAutoExpirePass();

  const id = req.params.id;
  const row = db.prepare<ListingRow & any>("SELECT * FROM listings WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Not found" });

  const isOwner = requireOwner(req, row);

  const status = String(row.status ?? "active") as ListingStatus;
  const resolution = String(row.resolution ?? "none") as ListingResolution;

  if (!isOwner && status === "deleted") return res.status(404).json({ error: "Not found" });

  const isPublic = PUBLIC_LIFECYCLE.includes(status) || resolution !== "none";
  if (!isOwner && !isPublic) return res.status(404).json({ error: "Not found" });

  return res.json(mapListing(req, row));
});

app.patch("/api/listings/:id", (req, res) => {
  runAutoExpirePass();

  const id = req.params.id;
  const row = db.prepare<(ListingRow & any)>("SELECT * FROM listings WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Not found" });

  if (!requireOwner(req, row)) return res.status(403).json({ error: "Not owner" });

  const parsed = UpdateListingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }
  const p = parsed.data;

  const currentStatus = String(row.status ?? "active") as ListingStatus;

  if (currentStatus === "deleted") return res.status(400).json({ error: "Listing is deleted" });
  if (currentStatus === "expired") return res.status(400).json({ error: "Listing is expired" });

  const sets: string[] = [];
  const params: any[] = [];

  const map: Record<string, any> = {
    title: p.title,
    category: p.category,
    species: p.species,
    price_cents: p.priceCents,
    location: p.location,
    description: p.description,
    contact: p.contact,
    image_url: p.imageUrl,
  };

  for (const [k, v] of Object.entries(map)) {
    if (v !== undefined) {
      sets.push(`${k} = ?`);
      params.push(v);
    }
  }

  const now = nowIso();
  sets.push(`updated_at = ?`);
  params.push(now);

  if (sets.length) {
    db.prepare(`UPDATE listings SET ${sets.join(", ")} WHERE id = ?`).run(...params, id);
  }

  if (p.images) {
    db.prepare(`DELETE FROM listing_images WHERE listing_id = ?`).run(id);
    const ins = db.prepare(
      `INSERT INTO listing_images (id, listing_id, url, thumb_url, medium_url, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    const normalized = normalizeImages(p.images ?? []).slice(0, 6);
    normalized.forEach((img, idx) => ins.run(crypto.randomUUID(), id, img.fullUrl, img.thumbUrl, img.medUrl, idx));
  }

  const updated = db.prepare<ListingRow & any>("SELECT * FROM listings WHERE id = ?").get(id);
  return res.json(mapListing(req, updated!));
});

app.delete("/api/listings/:id", (req, res) => {
  runAutoExpirePass();

  const id = req.params.id;
  const row = db.prepare<(ListingRow & any)>("SELECT * FROM listings WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Not found" });

  if (!requireOwner(req, row)) return res.status(403).json({ error: "Not owner" });

  const now = nowIso();

  db.prepare(`UPDATE listings SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ?`).run(now, now, id);
  return res.json({ ok: true });
});

// ---------- Action endpoints ----------
function loadOwnedListing(req: express.Request, res: express.Response) {
  const id = req.params.id;
  const row = db.prepare<(ListingRow & any)>("SELECT * FROM listings WHERE id = ?").get(id);
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return null;
  }
  if (!requireOwner(req, row)) {
    res.status(403).json({ error: "Not owner" });
    return null;
  }
  return row as ListingRow & any;
}

function setLifecycle(id: string, status: ListingStatus) {
  const now = nowIso();
  db.prepare(`UPDATE listings SET status=?, updated_at=? WHERE id=?`).run(status, now, id);
}

function setResolution(id: string, resolution: ListingResolution) {
  const now = nowIso();
  db.prepare(`UPDATE listings SET resolution=?, resolved_at=?, updated_at=? WHERE id=?`).run(resolution, now, now, id);
}

app.post("/api/listings/:id/pause", (req, res) => {
  runAutoExpirePass();
  const row = loadOwnedListing(req, res);
  if (!row) return;

  const status = String(row.status ?? "active") as ListingStatus;
  const resolution = String(row.resolution ?? "none") as ListingResolution;

  if (status === "deleted") return res.status(400).json({ error: "Listing is deleted" });
  if (status === "expired") return res.status(400).json({ error: "Listing is expired" });
  if (status === "paused") return res.json(mapListing(req, row));
  if (status === "draft") return res.status(400).json({ error: "Draft listings must be published first" });
  if (resolution !== "none") return res.status(400).json({ error: "Resolved listings cannot be paused" });

  setLifecycle(row.id, "paused");
  const updated = db.prepare<ListingRow & any>("SELECT * FROM listings WHERE id = ?").get(row.id);
  return res.json(mapListing(req, updated!));
});

app.post("/api/listings/:id/resume", (req, res) => {
  runAutoExpirePass();
  const row = loadOwnedListing(req, res);
  if (!row) return;

  const status = String(row.status ?? "active") as ListingStatus;
  const resolution = String(row.resolution ?? "none") as ListingResolution;

  if (status === "deleted") return res.status(400).json({ error: "Listing is deleted" });
  if (status === "expired") return res.status(400).json({ error: "Listing is expired" });
  if (resolution !== "none") return res.status(400).json({ error: "Resolved listings cannot be resumed" });

  if (status !== "paused") return res.status(400).json({ error: "Only paused listings can be resumed" });

  setLifecycle(row.id, "active");
  const updated = db.prepare<ListingRow & any>("SELECT * FROM listings WHERE id = ?").get(row.id);
  return res.json(mapListing(req, updated!));
});

app.post("/api/listings/:id/mark-sold", (req, res) => {
  runAutoExpirePass();
  const row = loadOwnedListing(req, res);
  if (!row) return;

  const status = String(row.status ?? "active") as ListingStatus;
  const resolution = String(row.resolution ?? "none") as ListingResolution;

  if (status === "deleted") return res.status(400).json({ error: "Listing is deleted" });
  if (status === "expired") return res.status(400).json({ error: "Listing is expired" });
  if (resolution !== "none") return res.status(400).json({ error: "Listing is already resolved" });

  setResolution(row.id, "sold");
  const updated = db.prepare<ListingRow & any>("SELECT * FROM listings WHERE id = ?").get(row.id);
  return res.json(mapListing(req, updated!));
});

// ---------- Images helpers ----------
function getImagesForListing(req: express.Request, listingId: string): ImageAsset[] {
  const rows = db
    .prepare(
      `SELECT url, thumb_url, medium_url
       FROM listing_images
       WHERE listing_id = ?
       ORDER BY sort_order ASC`
    )
    .all(listingId) as { url: string; thumb_url: string | null; medium_url: string | null }[];

  return rows.map((r) => {
    const full = r.url;
    const thumb = r.thumb_url ?? r.url;
    const med = r.medium_url ?? r.url;

    return {
      fullUrl: toAbs(req, full),
      thumbUrl: toAbs(req, thumb),
      medUrl: toAbs(req, med),
    };
  });
}

function mapListing(req: express.Request, row: ListingRow & any) {
  const images = getImagesForListing(req, row.id);

  const status = String(row.status ?? "active") as ListingStatus;
  const resolution = String(row.resolution ?? "none") as ListingResolution;

  return {
    id: row.id,
    title: row.title,
    category: row.category,
    species: row.species,
    priceCents: row.price_cents,
    location: row.location,
    description: row.description,
    contact: row.contact ?? null,

    // Legacy field kept (but you can stop using it)
    imageUrl: row.image_url ?? null,

    // New field the frontend should use
    images,

    status,
    resolution,
    expiresAt: row.expires_at ?? null,
    resolvedAt: row.resolved_at ?? null,

    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
