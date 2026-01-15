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
import { optionalAuth } from "./auth/optionalAuth.js";
import { clearAuthCookies } from "./auth/cookies.js";
import { nowIso as nowIsoSecurity } from "./security.js";
import { LISTING_CATEGORIES, LISTING_SEXES } from "./listingOptions.js";
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

// Allow frontend (different origin/port) to load uploaded images from /uploads.
// Helmet's default CORP policy is "same-origin", which blocks these assets in the browser.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

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

// Public meta/options endpoint for dropdowns (single source of truth).
app.get("/api/meta/options", (_req, res) => {
  return res.json({
    categories: LISTING_CATEGORIES,
    listingSexes: LISTING_SEXES,
  });
});

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

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 4 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
    if (ok) return cb(null, true);
    return cb(new Error("Only JPG/PNG/WebP images are allowed"));
  },
});

function tryDeleteLocalUpload(maybeUploadsUrl: unknown) {
  try {
    const raw = typeof maybeUploadsUrl === "string" ? maybeUploadsUrl : "";
    if (!raw.startsWith("/uploads/")) return;
    const file = path.basename(raw);
    const abs = path.join(UPLOADS_DIR, file);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch {
    // ignore
  }
}

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

function isListingOwner(req: express.Request, row: any) {
  const u = req.user;
  if (!u) return false;
  if (row?.user_id === undefined || row?.user_id === null) return false;
  return Number(row.user_id) === u.id;
}

function assertListingOwner(req: express.Request, res: express.Response, row: any) {
  const u = req.user;
  if (!u) {
    res.status(401).json({ error: "Not authenticated" });
    return false;
  }
  if (row?.user_id === undefined || row?.user_id === null) {
    res.status(400).json({ error: "Listing is not linked to an account" });
    return false;
  }
  if (Number(row.user_id) !== u.id) {
    res.status(403).json({ error: "Not owner" });
    return false;
  }
  return true;
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

const ListingSexSchema = z.enum(LISTING_SEXES).default("Unknown");

const CreateListingSchema = z.object({
  title: z.string().min(3).max(80),
  category: z.enum(LISTING_CATEGORIES).default("Fish"),
  species: z.string().min(2).max(60),
  sex: ListingSexSchema,
  priceCents: z.number().int().min(0).max(5_000_000),
  location: z.string().min(2).max(80),
  description: z.string().min(1).max(1000),
  phone: z.string().min(6).max(30),
  images: ImagesInputSchema,
  imageUrl: z.string().optional().nullable(),
  status: z.enum(["draft", "active"]).optional(),
});

const UpdateListingSchema = z.object({
  title: z.string().min(3).max(80).optional(),
  category: z.enum(LISTING_CATEGORIES).optional(),
  species: z.string().min(2).max(60).optional(),
  sex: ListingSexSchema.optional(),
  priceCents: z.number().int().min(0).max(5_000_000).optional(),
  location: z.string().min(2).max(80).optional(),
  description: z.string().min(1).max(1000).optional(),
  phone: z.string().min(6).max(30).optional(),
  images: ImagesInputSchema.optional(),
  imageUrl: z.string().nullable().optional(),
  featured: z.boolean().optional(),
  featuredUntil: z.number().int().min(0).nullable().optional(),
});

const WantedStatusSchema = z.enum(["open", "closed"]);

const CreateWantedSchema = z.object({
  title: z.string().min(3).max(80),
  category: z.enum(LISTING_CATEGORIES).default("Fish"),
  species: z.string().min(2).max(60).optional().nullable(),
  budgetMinCents: z.number().int().min(0).max(5_000_000).optional().nullable(),
  budgetMaxCents: z.number().int().min(0).max(5_000_000).optional().nullable(),
  location: z.string().min(2).max(80),
  description: z.string().min(1).max(1000),
});

const UpdateWantedSchema = z.object({
  title: z.string().min(3).max(80).optional(),
  category: z.enum(LISTING_CATEGORIES).optional(),
  species: z.string().min(2).max(60).nullable().optional(),
  budgetMinCents: z.number().int().min(0).max(5_000_000).nullable().optional(),
  budgetMaxCents: z.number().int().min(0).max(5_000_000).nullable().optional(),
  location: z.string().min(2).max(80).optional(),
  description: z.string().min(1).max(1000).optional(),
});

app.use("/api/auth", authRoutes);

app.get("/api/me", requireAuth, (req, res) => {
  return res.json({ user: req.user });
});

const ProfileSchema = z.object({
  firstName: z.string().min(1).max(80).optional(),
  lastName: z.string().min(1).max(80).optional(),
  location: z.string().max(120).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  website: z.string().max(300).nullable().optional(),
  bio: z.string().max(200).nullable().optional(),
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
  const u = db
    .prepare(`SELECT id,email,username,first_name,last_name FROM users WHERE id = ?`)
    .get(user.id) as any | undefined;
  if (!u) return res.status(404).json({ error: "User not found" });
  const p = db.prepare(`SELECT * FROM user_profiles WHERE user_id = ?`).get(user.id) as any | undefined;

  return res.json({
    user: {
      id: Number(u.id),
      email: String(u.email),
      username: String(u.username),
    },
    account: {
      firstName: String(u.first_name),
      lastName: String(u.last_name),
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

  const { firstName, lastName, location, phone, website, bio } = parsed.data;
  const now = nowIsoSecurity();

  const tx = db.transaction(() => {
    const userSets: string[] = [];
    const userParams: any[] = [];

    if (firstName !== undefined) {
      userSets.push(`first_name = ?`);
      userParams.push(String(firstName).trim());
    }
    if (lastName !== undefined) {
      userSets.push(`last_name = ?`);
      userParams.push(String(lastName).trim());
    }

    userSets.push(`updated_at = ?`);
    userParams.push(now);

    db.prepare(`UPDATE users SET ${userSets.join(", ")} WHERE id = ?`).run(...userParams, user.id);

    const existing = db.prepare(`SELECT user_id FROM user_profiles WHERE user_id = ?`).get(user.id) as any | undefined;

    if (!existing) {
      db.prepare(
        `
INSERT INTO user_profiles(user_id,avatar_url,location,phone,website,bio,created_at,updated_at)
VALUES(?,?,?,?,?,?,?,?)
`
      ).run(user.id, null, location ?? null, phone ?? null, website ?? null, bio ?? null, now, now);
    } else {
      db.prepare(
        `
UPDATE user_profiles
SET location = ?, phone = ?, website = ?, bio = ?, updated_at = ?
WHERE user_id = ?
`
      ).run(location ?? null, phone ?? null, website ?? null, bio ?? null, now, user.id);
    }
  });

  try {
    tx();
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? "Failed to update profile" });
  }

  const u = db
    .prepare(`SELECT id,email,username,first_name,last_name FROM users WHERE id = ?`)
    .get(user.id) as any | undefined;
  const p = db.prepare(`SELECT * FROM user_profiles WHERE user_id = ?`).get(user.id) as any | undefined;

  return res.json({
    user: {
      id: Number(u.id),
      email: String(u.email),
      username: String(u.username),
    },
    account: {
      firstName: String(u.first_name),
      lastName: String(u.last_name),
    },
    profile: mapProfileRow(p),
  });
});

app.post("/api/profile/avatar", requireAuth, avatarUpload.single("image"), async (req, res) => {
  const user = req.user!;
  try {
    if (!req.file) return res.status(400).json({ error: "No image uploaded" });

    const now = nowIsoSecurity();

    // Capture previous avatar for cleanup (only if it was a local /uploads/ file)
    const existing = db.prepare(`SELECT avatar_url FROM user_profiles WHERE user_id = ?`).get(user.id) as any | undefined;
    const prevAvatar = existing?.avatar_url ? String(existing.avatar_url) : null;

    const THUMB_W = Number(process.env.IMG_THUMB_W ?? "440");

    const outName = `avatar_${user.id}_${crypto.randomUUID()}.webp`;
    const outAbs = path.join(UPLOADS_DIR, outName);

    await sharp(req.file.buffer, { failOn: "none" })
      .rotate()
      .resize({
        width: THUMB_W,
        height: THUMB_W,
        fit: "cover",
        position: "centre",
        withoutEnlargement: true,
        kernel: sharp.kernel.lanczos3,
      })
      .sharpen(0.6, 0.8, 1.2)
      .webp({ quality: 80, effort: 6, smartSubsample: true, alphaQuality: 85 })
      .toFile(outAbs);

    const rel = toRelUploads(outName);

    const tx = db.transaction(() => {
      const row = db.prepare(`SELECT user_id FROM user_profiles WHERE user_id = ?`).get(user.id) as any | undefined;
      if (!row) {
        db.prepare(
          `
INSERT INTO user_profiles(user_id,avatar_url,location,phone,website,bio,created_at,updated_at)
VALUES(?,?,?,?,?,?,?,?)
`
        ).run(user.id, rel, null, null, null, null, now, now);
      } else {
        db.prepare(`UPDATE user_profiles SET avatar_url = ?, updated_at = ? WHERE user_id = ?`).run(rel, now, user.id);
      }
    });
    tx();

    if (prevAvatar && prevAvatar !== rel) tryDeleteLocalUpload(prevAvatar);

    const u = db
      .prepare(`SELECT id,email,username,first_name,last_name FROM users WHERE id = ?`)
      .get(user.id) as any | undefined;
    const p = db.prepare(`SELECT * FROM user_profiles WHERE user_id = ?`).get(user.id) as any | undefined;

    return res.json({
      user: {
        id: Number(u.id),
        email: String(u.email),
        username: String(u.username),
      },
      account: {
        firstName: String(u.first_name),
        lastName: String(u.last_name),
      },
      profile: mapProfileRow(p),
    });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? "Failed to upload avatar" });
  }
});

app.delete("/api/profile/avatar", requireAuth, (req, res) => {
  const user = req.user!;
  try {
    const now = nowIsoSecurity();
    const existing = db.prepare(`SELECT avatar_url FROM user_profiles WHERE user_id = ?`).get(user.id) as any | undefined;
    const prevAvatar = existing?.avatar_url ? String(existing.avatar_url) : null;

    const tx = db.transaction(() => {
      const row = db.prepare(`SELECT user_id FROM user_profiles WHERE user_id = ?`).get(user.id) as any | undefined;
      if (!row) {
        db.prepare(
          `
INSERT INTO user_profiles(user_id,avatar_url,location,phone,website,bio,created_at,updated_at)
VALUES(?,?,?,?,?,?,?,?)
`
        ).run(user.id, null, null, null, null, null, now, now);
      } else {
        db.prepare(`UPDATE user_profiles SET avatar_url = ?, updated_at = ? WHERE user_id = ?`).run(null, now, user.id);
      }
    });
    tx();

    if (prevAvatar) tryDeleteLocalUpload(prevAvatar);

    const u = db
      .prepare(`SELECT id,email,username,first_name,last_name FROM users WHERE id = ?`)
      .get(user.id) as any | undefined;
    const p = db.prepare(`SELECT * FROM user_profiles WHERE user_id = ?`).get(user.id) as any | undefined;

    return res.json({
      user: {
        id: Number(u.id),
        email: String(u.email),
        username: String(u.username),
      },
      account: {
        firstName: String(u.first_name),
        lastName: String(u.last_name),
      },
      profile: mapProfileRow(p),
    });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? "Failed to remove avatar" });
  }
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
      .prepare(`SELECT id,email,username,password_hash FROM users WHERE id = ?`)
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
INSERT INTO deleted_accounts(user_id,email_hash,username_hash,deleted_at,reason)
VALUES(?,?,?,?,?)
`
      ).run(Number(row.id), sha256(norm(row.email)), sha256(norm(row.username)), now, null);

      db.prepare(`DELETE FROM users WHERE id = ?`).run(Number(row.id));
    });

    tx();
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? "Failed to delete account" });
  }

  clearAuthCookies(res);
  return res.json({ ok: true });
});

app.post("/api/listings", requireAuth, (req, res) => {
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
  const user = req.user!;

  const { title, category, species, sex, priceCents, location, description, phone, images, imageUrl } = parsed.data;
  const requestedStatus = parsed.data.status;
  const status: ListingStatus = requestedStatus === "draft" ? "draft" : requireApproval ? "pending" : "active";

  db.prepare(
    `INSERT INTO listings(
id,user_id,owner_token,title,category,species,sex,price_cents,location,description,phone,image_url,
status,expires_at,resolution,resolved_at,created_at,updated_at,deleted_at
)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id,
    user.id,
    ownerToken,
    title,
    category,
    species,
    sex,
    priceCents,
    location,
    description,
    phone,
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

  const row = db.prepare("SELECT * FROM listings WHERE id = ? AND listing_type = 0").get(id) as (ListingRow & any) | undefined;
  return res.status(201).json(mapListing(req, row!));
});

app.get("/api/my/listings", requireAuth, (req, res) => {
  runAutoExpirePass();
  const includeDeleted = String(req.query.includeDeleted ?? "").trim() === "1";
  const limitRaw = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw!))) : 100;
  const offsetRaw = req.query.offset !== undefined ? Number(req.query.offset) : undefined;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw!)) : 0;

  const user = req.user!;

  const where: string[] = [];
  const params: any[] = [];
  where.push(`listing_type = 0`);
  where.push(`user_id = ?`);
  params.push(user.id);
  if (!includeDeleted) where.push(`status <> 'deleted'`);

  const whereSql = `WHERE ${where.join(" AND ")}`;

  const totalRow = db.prepare(`SELECT COUNT(*)as c FROM listings ${whereSql}`).get(...params) as any;
  const total = Number(totalRow?.c ?? 0);

  const rows = db
    .prepare(
      `
SELECT * FROM listings
${whereSql}
ORDER BY updated_at DESC, created_at DESC, id DESC
LIMIT ? OFFSET ?
`
    )
    .all(...params, limit, offset) as (ListingRow & any)[];

  return res.json({
    items: rows.map((r) => mapListing(req, r)),
    total,
    limit,
    offset,
  });
});

app.get("/api/listings", (req, res) => {
  runAutoExpirePass();
  const q = String(req.query.q ?? "").trim().toLowerCase();
  const species = String(req.query.species ?? "").trim().toLowerCase();
  const category = String(req.query.category ?? "").trim();
  const featured = String(req.query.featured ?? "").trim();
  const min = req.query.minPriceCents ? Number(req.query.minPriceCents) : undefined;
  const max = req.query.maxPriceCents ? Number(req.query.maxPriceCents) : undefined;
  const sort = String(req.query.sort ?? "newest");
  const limitRaw = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw!))) : 24;
  const offsetRaw = req.query.offset !== undefined ? Number(req.query.offset) : undefined;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw!)) : 0;

  const where: string[] = [];
  const params: any[] = [];
  where.push(`listing_type = 0`);
  where.push(`status IN('active','pending')`);
  where.push(`resolution = 'none'`);

  if (featured === "1") {
    where.push(`featured = 1`);
    // Only show currently-featured items to the public “featured carousel”.
    where.push(`(featured_until IS NULL OR featured_until > ?)`);
    params.push(Date.now());
  }

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

app.get("/api/listings/:id", optionalAuth, (req, res) => {
  runAutoExpirePass();
  const id = req.params.id;
  let row = db.prepare("SELECT * FROM listings WHERE id = ? AND listing_type = 0").get(id) as (ListingRow & any) | undefined;
  if (!row) return res.status(404).json({ error: "Not found" });

  const isOwner = isListingOwner(req, row);
  const status = String(row.status ?? "active") as ListingStatus;
  const resolution = String(row.resolution ?? "none") as ListingResolution;

  if (!isOwner && status === "deleted") return res.status(404).json({ error: "Not found" });

  const isPublic = PUBLIC_LIFECYCLE.includes(status) || resolution !== "none";
  if (!isOwner && !isPublic) return res.status(404).json({ error: "Not found" });

  // Track views for public (non-owner) listing detail views.
  if (!isOwner && isPublic) {
    db.prepare(`UPDATE listings SET views = COALESCE(views, 0) + 1 WHERE id = ? AND listing_type = 0`).run(id);
    row = db.prepare("SELECT * FROM listings WHERE id = ? AND listing_type = 0").get(id) as (ListingRow & any) | undefined;
  }

  return res.json(mapListing(req, row));
});

app.patch("/api/listings/:id", requireAuth, (req, res) => {
  runAutoExpirePass();
  const id = req.params.id;
  const row = db.prepare("SELECT * FROM listings WHERE id = ? AND listing_type = 0").get(id) as (ListingRow & any) | undefined;
  if (!row) return res.status(404).json({ error: "Not found" });
  if (!assertListingOwner(req, res, row)) return;

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
    sex: p.sex,
    price_cents: p.priceCents,
    location: p.location,
    description: p.description,
    phone: p.phone,
    image_url: p.imageUrl,
  };

  if (p.featuredUntil !== undefined) {
    map.featured_until = p.featuredUntil;
    // If client sets/clears featured_until but doesn't explicitly set featured, keep them in sync.
    if (p.featured === undefined) {
      map.featured = p.featuredUntil === null ? 0 : 1;
    }
  }

  if (p.featured !== undefined) {
    map.featured = p.featured ? 1 : 0;
    // Turning off featuring clears the timer unless explicitly provided.
    if (!p.featured && p.featuredUntil === undefined) {
      map.featured_until = null;
    }
  }

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

  const updated = db.prepare("SELECT * FROM listings WHERE id = ? AND listing_type = 0").get(id) as (ListingRow & any) | undefined;
  return res.json(mapListing(req, updated!));
});

app.delete("/api/listings/:id", requireAuth, (req, res) => {
  runAutoExpirePass();
  const id = req.params.id;
  const row = db.prepare("SELECT * FROM listings WHERE id = ? AND listing_type = 0").get(id) as (ListingRow & any) | undefined;
  if (!row) return res.status(404).json({ error: "Not found" });
  if (!assertListingOwner(req, res, row)) return;

  const now = nowIso();
  db.prepare(`UPDATE listings SET status = 'deleted',deleted_at = ?,updated_at = ? WHERE id = ?`).run(now, now, id);
  return res.json({ ok: true });
});

function mapWantedRow(row: any) {
  return {
    id: String(row.id),
    userId: Number(row.user_id),
    username: row.user_username ? String(row.user_username) : null,
    title: String(row.title),
    category: String(row.category),
    species: row.species && String(row.species).trim() ? String(row.species) : null,
    budgetMinCents: row.budget_min_cents != null ? Number(row.budget_min_cents) : null,
    budgetMaxCents: row.budget_max_cents != null ? Number(row.budget_max_cents) : null,
    location: String(row.location),
    status: WantedStatusSchema.parse(String(row.wanted_status ?? "open")),
    description: String(row.description),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function requireWantedOwner(req: express.Request, row: any) {
  const u = req.user;
  if (!u) return false;
  return Number(row?.user_id) === u.id;
}

app.get("/api/wanted", (req, res) => {
  const q = String(req.query.q ?? "").trim().toLowerCase();
  const species = String(req.query.species ?? "").trim().toLowerCase();
  const category = String(req.query.category ?? "").trim();
  const location = String(req.query.location ?? "").trim().toLowerCase();
  const statusRaw = String(req.query.status ?? "open").trim();
  const status = statusRaw ? WantedStatusSchema.safeParse(statusRaw) : { success: true as const, data: "open" as const };

  if (!status.success) return res.status(400).json({ error: "Invalid status filter" });

  const minRaw = req.query.minBudgetCents ?? req.query.min;
  const maxRaw = req.query.maxBudgetCents ?? req.query.max;
  const min = minRaw !== undefined ? Number(minRaw) : undefined;
  const max = maxRaw !== undefined ? Number(maxRaw) : undefined;

  const limitRaw = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw!))) : 24;
  const offsetRaw = req.query.offset !== undefined ? Number(req.query.offset) : undefined;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw!)) : 0;

  const where: string[] = [];
  const params: any[] = [];
  where.push(`l.listing_type = 1`);

  if (status.data) {
    where.push(`l.wanted_status = ?`);
    params.push(status.data);
  }

  if (q) {
    where.push("(lower(l.title)LIKE ? OR lower(l.description)LIKE ? OR lower(l.location)LIKE ? OR lower(l.species)LIKE ?)");
    const pat = `%${q}%`;
    params.push(pat, pat, pat, pat);
  }

  if (species) {
    where.push("lower(l.species)= ?");
    params.push(species);
  }

  if (category) {
    where.push("l.category = ?");
    params.push(category);
  }

  if (location) {
    where.push("lower(l.location)LIKE ?");
    params.push(`%${location}%`);
  }

  if (Number.isFinite(min)) {
    where.push("(l.budget_max_cents IS NULL OR l.budget_max_cents >= ?)");
    params.push(Math.floor(min!));
  }

  if (Number.isFinite(max)) {
    where.push("(l.budget_min_cents IS NULL OR l.budget_min_cents <= ?)");
    params.push(Math.floor(max!));
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const totalRow = db
    .prepare(
      `
SELECT COUNT(*)as c
FROM listings l
${whereSql}
`
    )
    .get(...params) as any;
  const total = Number(totalRow?.c ?? 0);

  const rows = db
    .prepare(
      `
SELECT l.*, u.username as user_username
FROM listings l
JOIN users u ON u.id = l.user_id
${whereSql}
ORDER BY l.created_at DESC, l.id DESC
LIMIT ? OFFSET ?
`
    )
    .all(...params, limit, offset) as any[];

  return res.json({
    items: rows.map(mapWantedRow),
    total,
    limit,
    offset,
  });
});

app.get("/api/wanted/:id", (req, res) => {
  const id = req.params.id;
  const row = db
    .prepare(
      `
SELECT l.*, u.username as user_username
FROM listings l
JOIN users u ON u.id = l.user_id
WHERE l.id = ?
AND l.listing_type = 1
`
    )
    .get(id) as any | undefined;
  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json(mapWantedRow(row));
});

app.post("/api/wanted", requireAuth, (req, res) => {
  const parsed = CreateWantedSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });

  const { title, category, location, description } = parsed.data;
  const species = parsed.data.species ? String(parsed.data.species).trim() : "";
  const budgetMinCents = parsed.data.budgetMinCents ?? null;
  const budgetMaxCents = parsed.data.budgetMaxCents ?? null;

  if (budgetMinCents != null && budgetMaxCents != null && budgetMinCents > budgetMaxCents) {
    return res.status(400).json({ error: "Budget min cannot be greater than budget max" });
  }

  const id = crypto.randomUUID();
  const now = nowIso();
  const user = req.user!;
  const ownerToken = `wanted:${user.id}:${crypto.randomUUID()}`;

  db.prepare(
    `
INSERT INTO listings(
  id,user_id,owner_token,listing_type,
  title,description,category,species,sex,price_cents,
  budget_min_cents,budget_max_cents,wanted_status,
  location,phone,image_url,
  status,expires_at,resolution,resolved_at,created_at,updated_at,deleted_at
)
VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`
  ).run(
    id,
    user.id,
    ownerToken,
    1,
    title,
    description,
    category,
    species ? species : "",
    "Unknown",
    0,
    budgetMinCents,
    budgetMaxCents,
    "open",
    location,
    "",
    null,
    "active",
    null,
    "none",
    null,
    now,
    now,
    null
  );

  const row = db
    .prepare(
      `
SELECT l.*, u.username as user_username
FROM listings l
JOIN users u ON u.id = l.user_id
WHERE l.id = ?
AND l.listing_type = 1
`
    )
    .get(id) as any | undefined;

  return res.status(201).json(mapWantedRow(row));
});

app.patch("/api/wanted/:id", requireAuth, (req, res) => {
  const id = req.params.id;
  const row = db.prepare(`SELECT * FROM listings WHERE id = ? AND listing_type = 1`).get(id) as any | undefined;
  if (!row) return res.status(404).json({ error: "Not found" });
  if (!requireWantedOwner(req, row)) return res.status(403).json({ error: "Not owner" });

  const parsed = UpdateWantedSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });

  const p = parsed.data;

  const nextMin = p.budgetMinCents !== undefined ? p.budgetMinCents : row.budget_min_cents ?? null;
  const nextMax = p.budgetMaxCents !== undefined ? p.budgetMaxCents : row.budget_max_cents ?? null;
  if (nextMin != null && nextMax != null && nextMin > nextMax) {
    return res.status(400).json({ error: "Budget min cannot be greater than budget max" });
  }

  const sets: string[] = [];
  const params: any[] = [];

  const map: Record<string, any> = {
    title: p.title,
    category: p.category,
    location: p.location,
    description: p.description,
    species: p.species === undefined ? undefined : p.species ? String(p.species).trim() : "",
    budget_min_cents: p.budgetMinCents,
    budget_max_cents: p.budgetMaxCents,
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
    db.prepare(`UPDATE listings SET ${sets.join(",")} WHERE id = ? AND listing_type = 1`).run(...params, id);
  }

  const updated = db
    .prepare(
      `
SELECT l.*, u.username as user_username
FROM listings l
JOIN users u ON u.id = l.user_id
WHERE l.id = ?
AND l.listing_type = 1
`
    )
    .get(id) as any | undefined;

  return res.json(mapWantedRow(updated));
});

app.post("/api/wanted/:id/close", requireAuth, (req, res) => {
  const id = req.params.id;
  const row = db.prepare(`SELECT * FROM listings WHERE id = ? AND listing_type = 1`).get(id) as any | undefined;
  if (!row) return res.status(404).json({ error: "Not found" });
  if (!requireWantedOwner(req, row)) return res.status(403).json({ error: "Not owner" });

  const now = nowIso();
  db.prepare(`UPDATE listings SET wanted_status='closed',updated_at=? WHERE id = ? AND listing_type = 1`).run(now, id);

  const updated = db
    .prepare(
      `
SELECT l.*, u.username as user_username
FROM listings l
JOIN users u ON u.id = l.user_id
WHERE l.id = ?
AND l.listing_type = 1
`
    )
    .get(id) as any | undefined;

  return res.json(mapWantedRow(updated));
});

app.post("/api/wanted/:id/reopen", requireAuth, (req, res) => {
  const id = req.params.id;
  const row = db.prepare(`SELECT * FROM listings WHERE id = ? AND listing_type = 1`).get(id) as any | undefined;
  if (!row) return res.status(404).json({ error: "Not found" });
  if (!requireWantedOwner(req, row)) return res.status(403).json({ error: "Not owner" });

  const now = nowIso();
  db.prepare(`UPDATE listings SET wanted_status='open',updated_at=? WHERE id = ? AND listing_type = 1`).run(now, id);

  const updated = db
    .prepare(
      `
SELECT l.*, u.username as user_username
FROM listings l
JOIN users u ON u.id = l.user_id
WHERE l.id = ?
AND l.listing_type = 1
`
    )
    .get(id) as any | undefined;

  return res.json(mapWantedRow(updated));
});

app.delete("/api/wanted/:id", requireAuth, (req, res) => {
  const id = req.params.id;
  const row = db.prepare(`SELECT * FROM listings WHERE id = ? AND listing_type = 1`).get(id) as any | undefined;
  if (!row) return res.status(404).json({ error: "Not found" });
  if (!requireWantedOwner(req, row)) return res.status(403).json({ error: "Not owner" });

  db.prepare(`DELETE FROM listings WHERE id = ? AND listing_type = 1`).run(id);
  return res.json({ ok: true });
});

function loadOwnedListing(req: express.Request, res: express.Response) {
  const id = req.params.id;
  const row = db.prepare("SELECT * FROM listings WHERE id = ? AND listing_type = 0").get(id) as (ListingRow & any) | undefined;
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return null;
  }
  if (!assertListingOwner(req, res, row)) return null;
  return row as ListingRow & any;
}

function setLifecycle(id: string, status: ListingStatus) {
  const now = nowIso();
  db.prepare(`UPDATE listings SET status=?,updated_at=? WHERE id=? AND listing_type = 0`).run(status, now, id);
}

function setResolution(id: string, resolution: ListingResolution) {
  const now = nowIso();
  db.prepare(`UPDATE listings SET resolution=?,resolved_at=?,updated_at=? WHERE id=? AND listing_type = 0`).run(resolution, now, now, id);
}

app.post("/api/listings/:id/pause", requireAuth, (req, res) => {
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
  const updated = db.prepare("SELECT * FROM listings WHERE id = ? AND listing_type = 0").get(row.id) as (ListingRow & any) | undefined;
  return res.json(mapListing(req, updated!));
});

app.post("/api/listings/:id/resume", requireAuth, (req, res) => {
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
  const updated = db.prepare("SELECT * FROM listings WHERE id = ? AND listing_type = 0").get(row.id) as (ListingRow & any) | undefined;
  return res.json(mapListing(req, updated!));
});

app.post("/api/listings/:id/mark-sold", requireAuth, (req, res) => {
  runAutoExpirePass();
  const row = loadOwnedListing(req, res);
  if (!row) return;

  const status = String(row.status ?? "active") as ListingStatus;
  const resolution = String(row.resolution ?? "none") as ListingResolution;

  if (status === "deleted") return res.status(400).json({ error: "Listing is deleted" });
  if (status === "expired") return res.status(400).json({ error: "Listing is expired" });
  if (resolution !== "none") return res.status(400).json({ error: "Listing is already resolved" });

  setResolution(row.id, "sold");
  const updated = db.prepare("SELECT * FROM listings WHERE id = ? AND listing_type = 0").get(row.id) as (ListingRow & any) | undefined;
  return res.json(mapListing(req, updated!));
});

app.post("/api/listings/:id/relist", requireAuth, (req, res) => {
  runAutoExpirePass();

  const id = req.params.id;
  const row = db.prepare("SELECT * FROM listings WHERE id = ? AND listing_type = 0").get(id) as (ListingRow & any) | undefined;
  if (!row) return res.status(404).json({ error: "Not found" });
  if (!assertListingOwner(req, res, row)) return;

  const status = String(row.status ?? "active") as ListingStatus;
  const resolution = String(row.resolution ?? "none") as ListingResolution;
  if (status === "deleted") return res.status(400).json({ error: "Listing is deleted" });
  if (status === "expired") return res.status(400).json({ error: "Listing is expired" });
  if (resolution !== "sold") return res.status(400).json({ error: "Only sold listings can be relisted" });

  const now = nowIso();
  const newId = crypto.randomUUID();
  const newOwnerToken = crypto.randomUUID();
  const phone = String((row as any).phone ?? "").trim();
  if (!phone) return res.status(400).json({ error: "Listing is missing required phone number" });

  const ttlDays = Number(process.env.LISTING_TTL_DAYS ?? "30");
  const expiresAt = addDaysIso(now, Number.isFinite(ttlDays) && ttlDays > 0 ? ttlDays : 30);

  const copyImages = db
    .prepare(
      `SELECT url,thumb_url,medium_url,sort_order
FROM listing_images
WHERE listing_id = ?
ORDER BY sort_order ASC`
    )
    .all(id) as Array<{ url: string; thumb_url: string | null; medium_url: string | null; sort_order: number }>;

  const tx = db.transaction(() => {
    // Archive old sold listing (so the new listing replaces it in "My listings")
    db.prepare(`UPDATE listings SET status='deleted',deleted_at=?,updated_at=? WHERE id=?`).run(now, now, id);

    // Create new paused listing (hidden) for final edits before resuming to active.
    db.prepare(
      `INSERT INTO listings(
id,user_id,owner_token,title,category,species,sex,price_cents,location,description,phone,image_url,
status,expires_at,resolution,resolved_at,created_at,updated_at,deleted_at
) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      newId,
      Number(row.user_id),
      newOwnerToken,
      row.title,
      row.category,
      row.species,
      (row as any).sex ?? "Unknown",
      row.price_cents,
      row.location,
      row.description,
      phone,
      row.image_url ?? null,
      "paused",
      expiresAt,
      "none",
      null,
      now,
      now,
      null
    );

    const insImg = db.prepare(
      `INSERT INTO listing_images(id,listing_id,url,thumb_url,medium_url,sort_order)
VALUES(?,?,?,?,?,?)`
    );
    for (const img of copyImages) {
      insImg.run(crypto.randomUUID(), newId, img.url, img.thumb_url ?? null, img.medium_url ?? null, img.sort_order ?? 0);
    }
  });

  try {
    tx();
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? "Failed to relist" });
  }

  const newRow = db.prepare("SELECT * FROM listings WHERE id = ? AND listing_type = 0").get(newId) as (ListingRow & any) | undefined;
  return res.json({ item: mapListing(req, newRow!), replacedId: id });
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
  const sellerUsername = (() => {
    try {
      const uid = (row as any).user_id;
      if (uid === null || uid === undefined) return null;
      const r = db.prepare(`SELECT username FROM users WHERE id = ?`).get(Number(uid)) as any;
      return r?.username ? String(r.username) : null;
    } catch {
      return null;
    }
  })();
  const sellerAvatarUrl = (() => {
    try {
      const uid = (row as any).user_id;
      if (uid === null || uid === undefined) return null;
      const r = db.prepare(`SELECT avatar_url FROM user_profiles WHERE user_id = ?`).get(Number(uid)) as any;
      const raw = r?.avatar_url ? String(r.avatar_url) : "";
      if (!raw) return null;
      return toAbs(req, raw);
    } catch {
      return null;
    }
  })();
  const sellerBio = (() => {
    try {
      const uid = (row as any).user_id;
      if (uid === null || uid === undefined) return null;
      const r = db.prepare(`SELECT bio FROM user_profiles WHERE user_id = ?`).get(Number(uid)) as any;
      const raw = r?.bio ? String(r.bio).trim() : "";
      return raw ? raw : null;
    } catch {
      return null;
    }
  })();

  return {
    id: row.id,
    featured: Boolean(Number((row as any).featured ?? 0)),
    featuredUntil: (row as any).featured_until ?? null,
    views: Number((row as any).views ?? 0),
    sellerUsername,
    sellerAvatarUrl,
    sellerBio,
    title: row.title,
    category: row.category,
    species: row.species,
    sex: String((row as any).sex ?? "Unknown"),
    priceCents: row.price_cents,
    location: row.location,
    description: row.description,
    phone: String((row as any).phone ?? ""),
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
