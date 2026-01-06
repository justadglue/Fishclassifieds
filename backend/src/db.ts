import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import crypto from "crypto";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "app.db");

export type ListingStatus = "draft" | "pending" | "active" | "paused" | "expired" | "deleted";
export type ListingResolution = "none" | "sold";

export type ListingRow = {
  id: string;
  owner_token: string;
  title: string;
  category: string;
  species: string;
  price_cents: number;
  location: string;
  description: string;
  contact: string | null;
  image_url: string | null;
  status: ListingStatus;
  expires_at: string | null;
  resolution: ListingResolution;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type ListingImageRow = {
  id: string;
  listing_id: string;
  url: string;
  thumb_url: string | null;
  medium_url: string | null;
  sort_order: number;
};

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function hasTable(db: Database.Database, name: string) {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name) as any;
  return !!row;
}

function hasColumn(db: Database.Database, table: string, col: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
  return cols.some((c) => String(c.name) === col);
}

export function openDb() {
  ensureDir(DATA_DIR);
  const db = new Database(DB_PATH);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // --- Core schema (listings) ---
  db.exec(`
CREATE TABLE IF NOT EXISTS listings(
  id TEXT PRIMARY KEY,
  owner_token TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Fish',
  species TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  location TEXT NOT NULL,
  description TEXT NOT NULL,
  contact TEXT,
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TEXT,
  resolution TEXT NOT NULL DEFAULT 'none',
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS listing_images(
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  url TEXT NOT NULL,
  thumb_url TEXT,
  medium_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(listing_id) REFERENCES listings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_listings_created_at ON listings(created_at);
CREATE INDEX IF NOT EXISTS idx_listings_updated_at ON listings(updated_at);
CREATE INDEX IF NOT EXISTS idx_listings_species ON listings(species);
CREATE INDEX IF NOT EXISTS idx_listings_price ON listings(price_cents);
CREATE INDEX IF NOT EXISTS idx_listings_category ON listings(category);
CREATE INDEX IF NOT EXISTS idx_listings_owner_token ON listings(owner_token);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_resolution ON listings(resolution);
CREATE INDEX IF NOT EXISTS idx_listings_expires_at ON listings(expires_at);
CREATE INDEX IF NOT EXISTS idx_listing_images_listing_id ON listing_images(listing_id);
`);

  // --- Auth schema ---
  db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions(
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

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_revoked_at ON sessions(revoked_at);
`);

  // --- Lightweight "migrations" for older DBs ---
  if (!hasColumn(db, "listings", "owner_token")) db.exec(`ALTER TABLE listings ADD COLUMN owner_token TEXT`);
  if (!hasColumn(db, "listings", "category")) db.exec(`ALTER TABLE listings ADD COLUMN category TEXT NOT NULL DEFAULT 'Fish'`);
  if (!hasColumn(db, "listings", "contact")) db.exec(`ALTER TABLE listings ADD COLUMN contact TEXT`);
  if (!hasColumn(db, "listings", "image_url")) db.exec(`ALTER TABLE listings ADD COLUMN image_url TEXT`);
  if (!hasColumn(db, "listings", "status")) db.exec(`ALTER TABLE listings ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
  if (!hasColumn(db, "listings", "updated_at")) db.exec(`ALTER TABLE listings ADD COLUMN updated_at TEXT`);
  if (!hasColumn(db, "listings", "deleted_at")) db.exec(`ALTER TABLE listings ADD COLUMN deleted_at TEXT`);
  if (!hasColumn(db, "listings", "expires_at")) db.exec(`ALTER TABLE listings ADD COLUMN expires_at TEXT`);
  if (!hasColumn(db, "listings", "resolution")) db.exec(`ALTER TABLE listings ADD COLUMN resolution TEXT NOT NULL DEFAULT 'none'`);
  if (!hasColumn(db, "listings", "resolved_at")) db.exec(`ALTER TABLE listings ADD COLUMN resolved_at TEXT`);

  if (!hasTable(db, "listing_images")) {
    db.exec(`
CREATE TABLE IF NOT EXISTS listing_images(
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  url TEXT NOT NULL,
  thumb_url TEXT,
  medium_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(listing_id) REFERENCES listings(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_listing_images_listing_id ON listing_images(listing_id);
`);
  } else {
    if (!hasColumn(db, "listing_images", "thumb_url")) db.exec(`ALTER TABLE listing_images ADD COLUMN thumb_url TEXT`);
    if (!hasColumn(db, "listing_images", "medium_url")) db.exec(`ALTER TABLE listing_images ADD COLUMN medium_url TEXT`);
  }

  // --- Normalize existing listing data ---
  db.exec(`
UPDATE listings
SET owner_token = COALESCE(NULLIF(owner_token,''),'')
`);

  const missingTokens = db
    .prepare(`SELECT id FROM listings WHERE owner_token IS NULL OR owner_token = ''`)
    .all() as { id: string }[];
  const updTok = db.prepare(`UPDATE listings SET owner_token = ? WHERE id = ?`);
  for (const r of missingTokens) updTok.run(crypto.randomUUID(), r.id);

  db.exec(`
UPDATE listings
SET updated_at = COALESCE(NULLIF(updated_at,''),created_at)
WHERE updated_at IS NULL OR updated_at = ''
`);

  db.exec(`
UPDATE listings
SET
  resolution = 'sold',
  resolved_at = COALESCE(resolved_at,updated_at),
  status = 'active'
WHERE lower(status)= 'sold'
`);

  db.exec(`
UPDATE listings
SET
  resolution = 'sold',
  resolved_at = COALESCE(resolved_at,updated_at)
WHERE lower(resolution)= 'solved'
`);

  db.exec(`
UPDATE listings
SET status = COALESCE(NULLIF(status,''),'active')
WHERE status IS NULL OR status = ''
`);

  db.exec(`
UPDATE listings
SET resolution = COALESCE(NULLIF(resolution,''),'none')
WHERE resolution IS NULL OR resolution = ''
`);

  db.exec(`
UPDATE listings
SET resolution = 'none'
WHERE lower(resolution) NOT IN ('none','sold')
`);

  db.exec(`
UPDATE listings
SET expires_at = COALESCE(expires_at,datetime(created_at,'+30 days'))
WHERE expires_at IS NULL OR expires_at = ''
`);

  db.exec(`
UPDATE listings
SET deleted_at = NULL
WHERE status <> 'deleted'
`);

  const listings = db.prepare(`SELECT id,image_url FROM listings`).all() as { id: string; image_url: string | null }[];
  const countImgs = db.prepare(`SELECT COUNT(*) as c FROM listing_images WHERE listing_id = ?`);
  const insImg = db.prepare(
    `INSERT INTO listing_images(id,listing_id,url,thumb_url,medium_url,sort_order) VALUES(?,?,?,?,?,?)`
  );

  for (const l of listings) {
    const c = (countImgs.get(l.id) as any).c as number;
    if (c === 0 && l.image_url) {
      insImg.run(crypto.randomUUID(), l.id, l.image_url, l.image_url, l.image_url, 0);
    }
  }

  db.exec(`
UPDATE listing_images
SET
  thumb_url = COALESCE(thumb_url,url),
  medium_url = COALESCE(medium_url,url)
`);

  return db;
}
