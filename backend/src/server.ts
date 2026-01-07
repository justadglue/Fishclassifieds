import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { openDb, type ListingRow, type ListingStatus, type ListingResolution } from "./db.js";
import crypto from "crypto";
import multer from "multer";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import authRoutes from "./auth/authRoutes.js";
import { assertConfig, config } from "./config.js";
import { requireAuth } from "./auth/requireAuth.js";
import { clearAuthCookies } from "./auth/cookies.js";
import { nowIso as nowIsoSecurity } from "./security.js";
import argon2 from "argon2";

assertConfig();

const app = express();
const db = openDb();
(app as any).locals.db = db;

app.set("trust proxy", 1);

app.use(
  cors({
    origin: config.corsOrigin,
    credentials: true,
  })
);

app.use(helmet());

app.use(
  rateLimit({
    windowMs: 60_000,
    max: 240,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use(express.json());
app.use(cookieParser());

app.get("/health", (_req, res) => res.json({ ok: true }));

const UPLOADS_DIR = path.join(process.cwd(), "data", "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use("/uploads", express.static(UPLOADS_DIR));

function extFromMimetype(mimetype: string) {
  if (mimetype === "image/jpeg") return ".jpg";
  if (mimetype === "image/png") return ".png";
  if (mimetype === "image/webp") return ".webp";
  return "";
}

type ImageAsset = { fullUrl: string; thumbUrl: string; medUrl: string };

function baseUrl(req: express.Request) {
  return `${req.protocol}://${req.get("host")}`;
}

function toAbs(req: express.Request, maybePath: string) {
  if (/^https?:\/\//i.test(maybePath)) return maybePath;
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
    fileSize: 6 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
    if (ok) return cb(null, true);
    return cb(new Error("Only JPG/PNG/WebP images are allowed"));
  },
});

async function makeDerivatives(absPath: string, baseNameNoExt: string): Promise<{ thumb: string; med: string }> {
  const thumbName = `${baseNameNoExt}_thumb.webp`;
  const medName = `${baseNameNoExt}_med.webp`;
  const thumbAbs = path.join(UPLOADS_DIR, thumbName);
  const medAbs = path.join(UPLOADS_DIR, medName);

  const THUMB_W = Number(process.env.IMG_THUMB_W ?? "440");
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

app.use((err: any, _req: any, res: any, next: any) => {
  if (!err) return next();
  const msg = typeof err?.message === "string" ? err.message : "Upload error";
  return res.status(400).json({ error: msg });
});

function requireOwner(req: express.Request, row: any) {
  const token = String(req.header("x-owner-token") ?? "").trim();
  return token && row?.owner_token && token === row.owner_token;
}

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

function runAutoExpirePass() {
  const now = nowIso();
  db.prepare(
    `
UPDATE listings
SET status='expired',updated_at=?
WHERE status <> 'deleted'
AND status <> 'expired'
AND expires_at IS NOT NULL
AND expires_at <> ''
AND expires_at < ?
`
  ).run(now, now);
}

const ImageAssetSchema = z.object({
  fullUrl: z.string().min(1),
  thumbUrl: z.string().min(1),
  medUrl: z.string().min(1),
});
const ImagesInputSchema = z.array(z.union([z.string(), ImageAssetSchema])).max(6).optional().default([]);

function normalizeImages(input: (string | ImageAsset)[]): ImageAsset[] {
  return (input ?? []).map((x) => {
    if (typeof x === "string") {
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
  imageUrl: z.string().optional().nullable(),
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
  imageUrl: z.string().nullable().optional(),
});

app.use("/api/auth", authRoutes);

app.get("/api/me", requireAuth, (req, res) => {
  return res.json({ user: req.user });
});

const ProfileSchema = z.object({
  displayName: z.string().min(1).max(80),
  avatarUrl: z.string().max(500).nullable().optional(),
  location: z.string().max(120).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  website: z.string().max(300).nullable().optional(),
  bio: z.string().max(1000).nullable().optional(),
});

function mapProfileRow(row: any) {
  return {
    avatarUrl: row?.avatar_url ?? null,
    location: row?.location ?? null,
    phone: row?.phone ?? null,
    website: row?.website ?? null,
    bio: row?.bio ?? null,
  };
}

app.get("/api/profile", requireAuth, (req, res) => {
  const user = req.user!;
  const u = db.prepare(`SELECT id,email,username,display_name FROM users WHERE id = ?`).get(user.id) as any | undefined;
  if (!u) return res.status(404).json({ error: "User not found" });
  const p = db.prepare(`SELECT * FROM user_profiles WHERE user_id = ?`).get(user.id) as any | undefined;

  return res.json({
    user: {
      id: Number(u.id),
      email: String(u.email),
      username: String(u.username),
      displayName: String(u.display_name),
    },
    profile: mapProfileRow(p),
  });
});

app.put("/api/profile", requireAuth, (req, res) => {
  const user = req.user!;
  const parsed = ProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const { displayName, avatarUrl, location, phone, website, bio } = parsed.data;
  const now = nowIsoSecurity();

  const tx = db.transaction(() => {
    db.prepare(`UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?`).run(displayName, now, user.id);

    const existing = db.prepare(`SELECT user_id FROM user_profiles WHERE user_id = ?`).get(user.id) as any | undefined;

    if (!existing) {
      db.prepare(
        `
INSERT INTO user_profiles(user_id,avatar_url,location,phone,website,bio,created_at,updated_at)
VALUES(?,?,?,?,?,?,?,?)
`
      ).run(user.id, avatarUrl ?? null, location ?? null, phone ?? null, website ?? null, bio ?? null, now, now);
    } else {
      db.prepare(
        `
UPDATE user_profiles
SET avatar_url = ?, location = ?, phone = ?, website = ?, bio = ?, updated_at = ?
WHERE user_id = ?
`
      ).run(avatarUrl ?? null, location ?? null, phone ?? null, website ?? null, bio ?? null, now, user.id);
    }
  });

  try {
    tx();
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? "Failed to update profile" });
  }

  const u = db.prepare(`SELECT id,email,username,display_name FROM users WHERE id = ?`).get(user.id) as any | undefined;
  const p = db.prepare(`SELECT * FROM user_profiles WHERE user_id = ?`).get(user.id) as any | undefined;

  return res.json({
    user: {
      id: Number(u.id),
      email: String(u.email),
      username: String(u.username),
      displayName: String(u.display_name),
    },
    profile: mapProfileRow(p),
  });
});

const DeleteAccountSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(1).max(200),
});

app.delete("/api/account", requireAuth, async (req, res) => {
  const user = req.user!;
  const parsed = DeleteAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const now = nowIsoSecurity();
  const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
  const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

  const presentedUsername = norm(parsed.data.username);

  try {
    const row = db
      .prepare(`SELECT id,email,username,display_name,password_hash FROM users WHERE id = ?`)
      .get(user.id) as any | undefined;

    if (!row) return res.status(404).json({ error: "User not found" });

    if (norm(row.username) !== presentedUsername) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const ok = await argon2.verify(String(row.password_hash), parsed.data.password);
    if (!ok) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const tx = db.transaction(() => {
      db.prepare(
        `
INSERT INTO deleted_accounts(user_id,email_hash,username_hash,display_name_hash,deleted_at,reason)
VALUES(?,?,?,?,?,?)
`
      ).run(
        Number(row.id),
        sha256(norm(row.email)),
        sha256(norm(row.username)),
        sha256(norm(row.display_name)),
        now,
        null
      );

      db.prepare(`DELETE FROM users WHERE id = ?`).run(Number(row.id));
    });

    tx();
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? "Failed to delete account" });
  }

  clearAuthCookies(res);
  return res.json({ ok: true });
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
    `INSERT INTO listings(
id,owner_token,title,category,species,price_cents,location,description,contact,image_url,
status,expires_at,resolution,resolved_at,created_at,updated_at,deleted_at
)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
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
    `INSERT INTO listing_images(id,listing_id,url,thumb_url,medium_url,sort_order)
VALUES(?,?,?,?,?,?)`
  );

  const normalized = normalizeImages(images ?? []);
  const fallback = imageUrl ? [{ fullUrl: imageUrl, thumbUrl: imageUrl, medUrl: imageUrl }] : [];
  const finalImages = (normalized.length ? normalized : fallback).slice(0, 6);

  finalImages.forEach((img, idx) => {
    insertImg.run(crypto.randomUUID(), id, img.fullUrl, img.thumbUrl, img.medUrl, idx);
  });

  const row = db.prepare("SELECT * FROM listings WHERE id = ?").get(id) as (ListingRow & any) | undefined;
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
  where.push(`status IN('active','pending')`);
  where.push(`resolution = 'none'`);

  if (q) {
    where.push("(lower(title)LIKE ? OR lower(description)LIKE ? OR lower(location)LIKE ? OR lower(species)LIKE ?)");
    const pat = `%${q}%`;
    params.push(pat, pat, pat, pat);
  }
  if (species) {
    where.push("lower(species)= ?");
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
  const totalRow = db.prepare(`SELECT COUNT(*)as c FROM listings ${whereSql}`).get(...params) as any;
  const total = Number(totalRow?.c ?? 0);

  let orderBy = "created_at DESC,id DESC";
  if (sort === "price_asc") orderBy = "price_cents ASC,created_at DESC,id DESC";
  if (sort === "price_desc") orderBy = "price_cents DESC,created_at DESC,id DESC";

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
  const row = db.prepare("SELECT * FROM listings WHERE id = ?").get(id) as (ListingRow & any) | undefined;
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
  const row = db.prepare("SELECT * FROM listings WHERE id = ?").get(id) as (ListingRow & any) | undefined;
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
      sets.push(`${k}= ?`);
      params.push(v);
    }
  }

  const now = nowIso();
  sets.push(`updated_at = ?`);
  params.push(now);

  if (sets.length) {
    db.prepare(`UPDATE listings SET ${sets.join(",")}WHERE id = ?`).run(...params, id);
  }

  if (p.images) {
    db.prepare(`DELETE FROM listing_images WHERE listing_id = ?`).run(id);

    const ins = db.prepare(
      `INSERT INTO listing_images(id,listing_id,url,thumb_url,medium_url,sort_order)
VALUES(?,?,?,?,?,?)`
    );

    const normalized = normalizeImages(p.images ?? []).slice(0, 6);
    normalized.forEach((img, idx) => ins.run(crypto.randomUUID(), id, img.fullUrl, img.thumbUrl, img.medUrl, idx));
  }

  const updated = db.prepare("SELECT * FROM listings WHERE id = ?").get(id) as (ListingRow & any) | undefined;
  return res.json(mapListing(req, updated!));
});

app.delete("/api/listings/:id", (req, res) => {
  runAutoExpirePass();
  const id = req.params.id;
  const row = db.prepare("SELECT * FROM listings WHERE id = ?").get(id) as (ListingRow & any) | undefined;
  if (!row) return res.status(404).json({ error: "Not found" });
  if (!requireOwner(req, row)) return res.status(403).json({ error: "Not owner" });

  const now = nowIso();
  db.prepare(`UPDATE listings SET status = 'deleted',deleted_at = ?,updated_at = ? WHERE id = ?`).run(now, now, id);
  return res.json({ ok: true });
});

function loadOwnedListing(req: express.Request, res: express.Response) {
  const id = req.params.id;
  const row = db.prepare("SELECT * FROM listings WHERE id = ?").get(id) as (ListingRow & any) | undefined;
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
  db.prepare(`UPDATE listings SET status=?,updated_at=? WHERE id=?`).run(status, now, id);
}

function setResolution(id: string, resolution: ListingResolution) {
  const now = nowIso();
  db.prepare(`UPDATE listings SET resolution=?,resolved_at=?,updated_at=? WHERE id=?`).run(resolution, now, now, id);
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
  const updated = db.prepare("SELECT * FROM listings WHERE id = ?").get(row.id) as (ListingRow & any) | undefined;
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
  const updated = db.prepare("SELECT * FROM listings WHERE id = ?").get(row.id) as (ListingRow & any) | undefined;
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
  const updated = db.prepare("SELECT * FROM listings WHERE id = ?").get(row.id) as (ListingRow & any) | undefined;
  return res.json(mapListing(req, updated!));
});

function getImagesForListing(req: express.Request, listingId: string): ImageAsset[] {
  const rows = db
    .prepare(
      `SELECT url,thumb_url,medium_url
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
    imageUrl: row.image_url ?? null,
    images,
    status,
    resolution,
    expiresAt: row.expires_at ?? null,
    resolvedAt: row.resolved_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

app.listen(config.port, () => {
  console.log(`API running on http://localhost:${config.port}`);
});
