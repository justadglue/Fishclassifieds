import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "app.db");

export type ListingStatus = "draft" | "pending" | "active" | "paused" | "sold" | "closed" | "expired" | "deleted";

export type ListingRow = {
  id: string;
  user_id: number | null;
  listing_type?: number;
  featured?: number;
  featured_until?: number | null;
  owner_block_edit?: number;
  owner_block_pause_resume?: number;
  owner_block_status_changes?: number;
  owner_block_featuring?: number;
  owner_block_reason?: string | null;
  owner_block_updated_at?: string | null;
  owner_block_actor_user_id?: number | null;
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
  location: string;
  description: string;
  phone: string;
  status: ListingStatus;
  published_at?: string | null;
  expires_at: string | null;
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
  is_admin?: number;
  is_superadmin?: number;
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
  is_admin INTEGER NOT NULL DEFAULT 0,
  is_superadmin INTEGER NOT NULL DEFAULT 0,
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

-- Password reset tokens (one-time, expires).
CREATE TABLE IF NOT EXISTS password_reset_tokens(
  id TEXT PRIMARY KEY,
  user_id INTEGER,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_password_reset_tokens_token_hash ON password_reset_tokens(token_hash);

-- OAuth identities (provider accounts linked to a local user).
CREATE TABLE IF NOT EXISTS oauth_identities(
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,          -- 'google'
  provider_user_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  email TEXT,                      -- provider email at link time (optional)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_identities_provider_user ON oauth_identities(provider, provider_user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_identities_user_id ON oauth_identities(user_id);

-- OAuth state storage (anti-CSRF + PKCE verifier; short-lived, one-time use).
CREATE TABLE IF NOT EXISTS oauth_states(
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,          -- 'google'
  intent TEXT NOT NULL,            -- 'signin' | 'signup'
  user_id INTEGER,                 -- set for sensitive flows initiated by an authenticated user (e.g. delete_account)
  next TEXT,                       -- validated internal path
  code_verifier TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at ON oauth_states(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_states_consumed_at ON oauth_states(consumed_at);

-- OAuth pending (used when provider doesn't return required fields).
CREATE TABLE IF NOT EXISTS oauth_pending(
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,          -- 'google'
  provider_user_id TEXT NOT NULL,
  profile_json TEXT NOT NULL,      -- serialized minimal provider profile
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY(state) REFERENCES oauth_states(state) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_oauth_pending_expires_at ON oauth_pending(expires_at);

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

-- User moderation state (admin controls). One row per user.
CREATE TABLE IF NOT EXISTS user_moderation(
  user_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'suspended' | 'banned'
  reason TEXT,
  suspended_until INTEGER, -- epoch ms, nullable
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_moderation_status ON user_moderation(status);
CREATE INDEX IF NOT EXISTS idx_user_moderation_suspended_until ON user_moderation(suspended_until);

-- Site-wide settings (editable in admin). Values stored as JSON strings.
CREATE TABLE IF NOT EXISTS site_settings(
  key TEXT PRIMARY KEY,
  value_json TEXT,
  updated_at TEXT NOT NULL,
  updated_by_user_id INTEGER,
  FOREIGN KEY(updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_site_settings_updated_at ON site_settings(updated_at);

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

-- User reports (admin moderation inbox)
CREATE TABLE IF NOT EXISTS reports(
  id TEXT PRIMARY KEY,
  reporter_user_id INTEGER NOT NULL,
  target_kind TEXT NOT NULL, -- 'sale' | 'wanted'
  target_id TEXT NOT NULL,   -- listings.id
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- 'open' | 'resolved'
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_by_user_id INTEGER,
  resolved_note TEXT,
  FOREIGN KEY(reporter_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(resolved_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_status_created_at ON reports(status, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_kind, target_id);
CREATE INDEX IF NOT EXISTS idx_reports_reporter_user_id ON reports(reporter_user_id);

-- Admin audit log (recommended for accountability)
CREATE TABLE IF NOT EXISTS admin_audit(
  id TEXT PRIMARY KEY,
  actor_user_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  meta_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit(created_at);
CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON admin_audit(actor_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit(target_kind, target_id, created_at);

-- User notifications (created by system/admin actions)
CREATE TABLE IF NOT EXISTS notifications(
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  meta_json TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  read_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created_at ON notifications(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_is_read ON notifications(user_id, is_read, created_at);

-- Search analytics events (for "Popular searches")
-- NOTE: We intentionally do not store location/price filters to avoid logging PII-like free-text.
CREATE TABLE IF NOT EXISTS search_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  browse_type TEXT NOT NULL, -- 'sale' | 'wanted'
  q_norm TEXT NOT NULL DEFAULT '',
  species_norm TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  user_id INTEGER,
  ip_hash TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_search_events_created_at ON search_events(created_at);
CREATE INDEX IF NOT EXISTS idx_search_events_browse_type_created_at ON search_events(browse_type, created_at);
CREATE INDEX IF NOT EXISTS idx_search_events_terms ON search_events(q_norm, species_norm, category, browse_type);

-- Superadmin-curated popular search sets + items (LLM-assisted)
CREATE TABLE IF NOT EXISTS popular_search_sets(
  id TEXT PRIMARY KEY,
  window_start_iso TEXT NOT NULL,
  window_end_iso TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL, -- 'draft' | 'published'
  raw_llm_output_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by_user_id INTEGER,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_popular_search_sets_status_updated_at ON popular_search_sets(status, updated_at);

CREATE TABLE IF NOT EXISTS popular_search_items(
  id TEXT PRIMARY KEY,
  set_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  label TEXT NOT NULL,
  params_json TEXT NOT NULL,
  included_terms_json TEXT,
  confidence REAL,
  enabled INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY(set_id) REFERENCES popular_search_sets(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_popular_search_items_set_rank ON popular_search_items(set_id, rank);

-- Unified listings table. listing_type=0 is sale, listing_type=1 is wanted.
CREATE TABLE IF NOT EXISTS listings(
  id TEXT PRIMARY KEY,
  user_id INTEGER,
  -- 0 = sell (default), 1 = wanted
  listing_type INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0,
  featured_until INTEGER,
  -- Per-listing moderation restrictions (owner capability blocks).
  owner_block_edit INTEGER NOT NULL DEFAULT 0,
  owner_block_pause_resume INTEGER NOT NULL DEFAULT 0,
  owner_block_status_changes INTEGER NOT NULL DEFAULT 0,
  owner_block_featuring INTEGER NOT NULL DEFAULT 0,
  owner_block_reason TEXT,
  owner_block_updated_at TEXT,
  owner_block_actor_user_id INTEGER,
  views INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Fish',
  species TEXT NOT NULL,
  sex TEXT NOT NULL DEFAULT 'Unknown',
  water_type TEXT,
  size TEXT NOT NULL DEFAULT '',
  -- True when shipping is offered/possible (sale) or shipping is acceptable (wanted).
  shipping_offered INTEGER NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 1,
  -- Sell price. Wanted posts store 0 here and use budget_cents instead.
  price_cents INTEGER NOT NULL,
  -- Wanted-only fields (used when listing_type=1)
  budget_cents INTEGER,
  location TEXT NOT NULL,
  description TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  published_at TEXT,
  expires_at TEXT,
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

-- Daily view counters (for "views today" UI).
-- day is a local-day key like 'YYYY-MM-DD' (server-local time).
CREATE TABLE IF NOT EXISTS listing_views_daily(
  listing_id TEXT NOT NULL,
  day TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(listing_id, day),
  FOREIGN KEY(listing_id) REFERENCES listings(id) ON DELETE CASCADE
);

-- Rolling 24h view counters: hour buckets (epoch ms at start of hour).
-- This allows efficient SUM(views) over the last 24 hours without storing per-view events.
CREATE TABLE IF NOT EXISTS listing_views_hourly(
  listing_id TEXT NOT NULL,
  hour_start_ms INTEGER NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(listing_id, hour_start_ms),
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
CREATE INDEX IF NOT EXISTS idx_listings_published_at ON listings(published_at);
CREATE INDEX IF NOT EXISTS idx_listings_expires_at ON listings(expires_at);
CREATE INDEX IF NOT EXISTS idx_listings_listing_type ON listings(listing_type);
CREATE INDEX IF NOT EXISTS idx_listings_listing_type_created_at ON listings(listing_type, created_at);
CREATE INDEX IF NOT EXISTS idx_listings_listing_type_user_id ON listings(listing_type, user_id);
CREATE INDEX IF NOT EXISTS idx_listing_images_listing_id ON listing_images(listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_views_daily_day ON listing_views_daily(day, listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_views_hourly_time ON listing_views_hourly(hour_start_ms, listing_id);
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

  // Best-effort: newer OAuth flows add columns to existing tables.
  // Avoid requiring a manual migration step for local dev.
  try {
    const cols = db.pragma(`table_info(oauth_states)`) as Array<{ name: string }>;
    const hasUserId = cols.some((c) => c.name === "user_id");
    if (!hasUserId) {
      db.exec(`ALTER TABLE oauth_states ADD COLUMN user_id INTEGER;`);
    }
  } catch {
    // ignore
  }

  _db = db;
  return db;
}
