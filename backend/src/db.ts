import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "app.db");

export type ListingStatus = "draft" | "pending" | "active" | "paused" | "expired" | "deleted";
export type ListingResolution = "none" | "sold";

export type ListingRow = {
  id: string;
  user_id: number | null;
  listing_type?: number;
  featured?: number;
  featured_until?: number | null;
  views?: number;
  title: string;
  category: string;
  species: string;
  sex: string;
  water_type?: string | null;
  size?: string;
  quantity?: number;
  price_cents: number;
  budget_cents?: number | null;
  wanted_status?: string;
  location: string;
  description: string;
  phone: string;
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

export type UserRow = {
  id: number;
  email: string;
  username: string;
  first_name: string;
  last_name: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
};

export type UserProfileRow = {
  user_id: number;
  avatar_url: string | null;
  location: string | null;
  phone: string | null;
  website: string | null;
  bio: string | null;
  created_at: string;
  updated_at: string;
};

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function createSchema(db: Database.Database) {
  db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_revoked_at ON sessions(revoked_at);

-- 1:1 profile table for editable user profile fields
CREATE TABLE IF NOT EXISTS user_profiles(
  user_id INTEGER PRIMARY KEY,
  avatar_url TEXT,
  location TEXT,
  phone TEXT,
  website TEXT,
  bio TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);

-- Minimal tombstone for deleted accounts (no plaintext PII; only hashes)
CREATE TABLE IF NOT EXISTS deleted_accounts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  email_hash TEXT NOT NULL,
  username_hash TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_deleted_accounts_deleted_at ON deleted_accounts(deleted_at);
CREATE INDEX IF NOT EXISTS idx_deleted_accounts_email_hash ON deleted_accounts(email_hash);
CREATE INDEX IF NOT EXISTS idx_deleted_accounts_username_hash ON deleted_accounts(username_hash);

-- Unified listings table. listing_type=0 is sale, listing_type=1 is wanted.
CREATE TABLE IF NOT EXISTS listings(
  id TEXT PRIMARY KEY,
  user_id INTEGER,
  -- 0 = sell (default), 1 = wanted
  listing_type INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0,
  featured_until INTEGER,
  views INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Fish',
  species TEXT NOT NULL,
  sex TEXT NOT NULL DEFAULT 'Unknown',
  water_type TEXT,
  size TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1,
  -- Sell price. Wanted posts store 0 here and use budget_cents instead.
  price_cents INTEGER NOT NULL,
  -- Wanted-only fields (used when listing_type=1)
  budget_cents INTEGER,
  wanted_status TEXT NOT NULL DEFAULT 'open',
  location TEXT NOT NULL,
  description TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TEXT,
  resolution TEXT NOT NULL DEFAULT 'none',
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
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
CREATE INDEX IF NOT EXISTS idx_listings_user_id ON listings(user_id);
CREATE INDEX IF NOT EXISTS idx_listings_featured ON listings(featured);
CREATE INDEX IF NOT EXISTS idx_listings_featured_until ON listings(featured_until);
CREATE INDEX IF NOT EXISTS idx_listings_views ON listings(views);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_resolution ON listings(resolution);
CREATE INDEX IF NOT EXISTS idx_listings_expires_at ON listings(expires_at);
CREATE INDEX IF NOT EXISTS idx_listings_listing_type ON listings(listing_type);
CREATE INDEX IF NOT EXISTS idx_listings_listing_type_created_at ON listings(listing_type, created_at);
CREATE INDEX IF NOT EXISTS idx_listings_listing_type_user_id ON listings(listing_type, user_id);
CREATE INDEX IF NOT EXISTS idx_listings_listing_type_wanted_status_created_at ON listings(listing_type, wanted_status, created_at);
CREATE INDEX IF NOT EXISTS idx_listing_images_listing_id ON listing_images(listing_id);
`);
}

let _db: Database.Database | null = null;

export function openDb() {
  if (_db) return _db;
  ensureDir(DATA_DIR);
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  _db = db;
  return db;
}
