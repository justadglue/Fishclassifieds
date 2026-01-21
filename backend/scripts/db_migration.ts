import "dotenv/config";
import crypto from "crypto";
import path from "path";
import Database from "better-sqlite3";
import { WATER_TYPES } from "../src/listingOptions.js";

type Args = {
  seedFeatured: boolean;
  replaceFeatured: boolean;
  help: boolean;
};

function parseArgs(argv: string[]): Args {
  const out: Args = { seedFeatured: false, replaceFeatured: false, help: false };
  for (const a of argv) {
    if (a === "--help" || a === "-h") out.help = true;
    if (a === "--seed-featured") out.seedFeatured = true;
    if (a === "--replace-featured") out.replaceFeatured = true;
  }
  return out;
}

function usage() {
  return `
backend db migration

Adds new schema changes to an existing SQLite DB at: backend/data/app.db

Flags:
  --seed-featured       Mark up to 6 newest public listings as featured (for demo)
  --replace-featured    (With --seed-featured) first clears featured=0 on all listings
  -h, --help            Show this help
`.trim();
}

function hasColumn(db: Database.Database, table: string, col: string): boolean {
  const rows = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return rows.some((r) => r.name === col);
}

function isColumnNotNull(db: Database.Database, table: string, col: string): boolean {
  const rows = db.pragma(`table_info(${table})`) as Array<{ name: string; notnull: number }>;
  const row = rows.find((r) => r.name === col);
  return Boolean(row && Number(row.notnull) === 1);
}

function hasTable(db: Database.Database, table: string): boolean {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(table) as any | undefined;
  return Boolean(row?.name);
}

function ensureListingImagesTable(db: Database.Database) {
  if (hasTable(db, "listing_images")) return;
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
}

function ensureReportsTable(db: Database.Database) {
  if (hasTable(db, "reports")) return;
  db.exec(`
CREATE TABLE IF NOT EXISTS reports(
  id TEXT PRIMARY KEY,
  reporter_user_id INTEGER NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open',
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
`);
}

function ensureAdminAuditTable(db: Database.Database) {
  if (hasTable(db, "admin_audit")) return;
  db.exec(`
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
`);
}

function ensureNotificationsTable(db: Database.Database) {
  if (hasTable(db, "notifications")) return;
  db.exec(`
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
`);
}

function ensureUserModerationTable(db: Database.Database) {
  if (hasTable(db, "user_moderation")) return;
  db.exec(`
CREATE TABLE IF NOT EXISTS user_moderation(
  user_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active',
  reason TEXT,
  suspended_until INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_moderation_status ON user_moderation(status);
CREATE INDEX IF NOT EXISTS idx_user_moderation_suspended_until ON user_moderation(suspended_until);
`);
}

function ensureSiteSettingsTable(db: Database.Database) {
  if (hasTable(db, "site_settings")) return;
  db.exec(`
CREATE TABLE IF NOT EXISTS site_settings(
  key TEXT PRIMARY KEY,
  value_json TEXT,
  updated_at TEXT NOT NULL,
  updated_by_user_id INTEGER,
  FOREIGN KEY(updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_site_settings_updated_at ON site_settings(updated_at);
`);
}

function extractWaterTypeFromDescription(desc: string): string | null {
  const m = String(desc ?? "").match(/^water type\s*:\s*(.+)\s*$/im);
  if (!m) return null;
  const raw = String(m[1] ?? "").trim();
  if (!raw) return null;
  // Only accept known values.
  return (WATER_TYPES as readonly string[]).includes(raw) ? raw : null;
}

function stripWaterTypeLine(desc: string): string {
  const s = String(desc ?? "");
  // Remove the "Water type: ..." line and collapse excessive blank lines.
  const without = s.replace(/^\s*water type\s*:\s*.+\s*$/gim, "").trim();
  return without.replace(/\n{3,}/g, "\n\n").trim();
}

const WANTED_START = "[[FC_WANTED_DETAILS]]";
const WANTED_END = "[[/FC_WANTED_DETAILS]]";

function hasWantedDetailsPrefix(desc: string): boolean {
  const raw = String(desc ?? "");
  const s = raw.indexOf(WANTED_START);
  const e = raw.indexOf(WANTED_END);
  return s !== -1 && e !== -1 && e > s;
}

function buildWantedDetailsPrefix(): string {
  // Keep in sync with frontend `buildWantedDetailsPrefix`:
  // - two blank lines between prefix and body
  return [WANTED_START, `priceType=each`, WANTED_END, "", ""].join("\n");
}

function encodeWantedDetailsIntoDescription(body: string): string {
  const prefix = buildWantedDetailsPrefix();
  const cleanedBody = String(body ?? "").trim();
  return `${prefix}${cleanedBody ? cleanedBody : ""}`.trim();
}

function addDaysIso(iso: string, days: number) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }

  // When run as: `npm --prefix backend run db:migration`, cwd is expected to be backend/
  const dbPath = path.join(process.cwd(), "data", "app.db");
  const db = new Database(dbPath);

  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");

  const migrations: string[] = [];

  // Ensure users has required first_name/last_name (NOT NULL) and NO display_name column.
  const hasFirst = hasColumn(db, "users", "first_name");
  const hasLast = hasColumn(db, "users", "last_name");
  const firstNotNull = hasFirst ? isColumnNotNull(db, "users", "first_name") : false;
  const lastNotNull = hasLast ? isColumnNotNull(db, "users", "last_name") : false;
  const hasDisplay = hasColumn(db, "users", "display_name");

  const needsUsersRebuild = !hasFirst || !hasLast || !firstNotNull || !lastNotNull || hasDisplay;

  if (needsUsersRebuild) {
    db.exec(`PRAGMA foreign_keys = OFF;`);
    const tx = db.transaction(() => {
      db.exec(`
CREATE TABLE IF NOT EXISTS users_new(
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
`);

      const firstExpr = hasFirst ? "first_name" : "''";
      const lastExpr = hasLast ? "last_name" : "''";
      const hasIsAdmin = hasColumn(db, "users", "is_admin");
      const hasIsSuperadmin = hasColumn(db, "users", "is_superadmin");
      const isAdminExpr = hasIsAdmin ? "COALESCE(is_admin, 0)" : "0";
      const isSuperExpr = hasIsSuperadmin ? "COALESCE(is_superadmin, 0)" : "0";

      db.exec(`
INSERT INTO users_new(id,email,username,first_name,last_name,password_hash,is_admin,is_superadmin,created_at,updated_at)
SELECT
  id,
  email,
  username,
  COALESCE(NULLIF(trim(${firstExpr}), ''), 'Unknown'),
  COALESCE(NULLIF(trim(${lastExpr}), ''), 'Unknown'),
  password_hash,
  ${isAdminExpr},
  ${isSuperExpr},
  created_at,
  updated_at
FROM users;
`);

      db.exec(`DROP TABLE users;`);
      db.exec(`ALTER TABLE users_new RENAME TO users;`);

      db.exec(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);`);
    });

    tx();
    db.exec(`PRAGMA foreign_keys = ON;`);

    if (!hasFirst || !hasLast) migrations.push("Added users.first_name / users.last_name (required)");
    if (hasDisplay) migrations.push("Removed legacy users display-name column");
    if ((hasFirst && !firstNotNull) || (hasLast && !lastNotNull)) migrations.push("Enforced NOT NULL on users.first_name / users.last_name");
    migrations.push("Ensured users.is_admin / users.is_superadmin columns exist (users table rebuild)");
  } else {
    migrations.push("users schema already includes required first_name/last_name and no legacy display-name column");
  }

  // Add admin privilege columns if missing (for DBs that didn't require rebuild).
  if (!hasColumn(db, "users", "is_admin")) {
    db.exec(`ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;`);
    migrations.push("Added users.is_admin");
  } else {
    migrations.push("users.is_admin already exists");
  }

  if (!hasColumn(db, "users", "is_superadmin")) {
    db.exec(`ALTER TABLE users ADD COLUMN is_superadmin INTEGER NOT NULL DEFAULT 0;`);
    migrations.push("Added users.is_superadmin");
  } else {
    migrations.push("users.is_superadmin already exists");
  }

  // Ensure deleted_accounts has no display_name_hash column.
  const hasDeletedAccountsEmail = hasColumn(db, "deleted_accounts", "email_hash");
  const hasDeletedAccountsUsername = hasColumn(db, "deleted_accounts", "username_hash");
  const hasDeletedAccountsDisplay = hasColumn(db, "deleted_accounts", "display_name_hash");
  const hasDeletedAccountsDeletedAt = hasColumn(db, "deleted_accounts", "deleted_at");

  const needsDeletedAccountsRebuild =
    hasDeletedAccountsDisplay ||
    // If table exists but is missing expected columns, rebuild to a known-good schema.
    (hasDeletedAccountsDeletedAt && (!hasDeletedAccountsEmail || !hasDeletedAccountsUsername));

  if (needsDeletedAccountsRebuild) {
    db.exec(`PRAGMA foreign_keys = OFF;`);
    const tx = db.transaction(() => {
      db.exec(`
CREATE TABLE IF NOT EXISTS deleted_accounts_new(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  email_hash TEXT NOT NULL,
  username_hash TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  reason TEXT
);
`);

      // Only copy if the existing table looks like deleted_accounts.
      if (hasDeletedAccountsDeletedAt) {
        db.exec(`
INSERT INTO deleted_accounts_new(id,user_id,email_hash,username_hash,deleted_at,reason)
SELECT id,user_id,email_hash,username_hash,deleted_at,reason
FROM deleted_accounts;
`);
      }

      db.exec(`DROP TABLE IF EXISTS deleted_accounts;`);
      db.exec(`ALTER TABLE deleted_accounts_new RENAME TO deleted_accounts;`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_deleted_accounts_deleted_at ON deleted_accounts(deleted_at);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_deleted_accounts_email_hash ON deleted_accounts(email_hash);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_deleted_accounts_username_hash ON deleted_accounts(username_hash);`);
    });

    tx();
    db.exec(`PRAGMA foreign_keys = ON;`);
    migrations.push("Removed legacy deleted_accounts display-name hash column");
  } else {
    migrations.push("deleted_accounts schema already has no legacy display-name hash column (or table missing)");
  }

  if (!hasColumn(db, "listings", "featured")) {
    db.exec(`ALTER TABLE listings ADD COLUMN featured INTEGER NOT NULL DEFAULT 0;`);
    migrations.push("Added listings.featured");
  } else {
    migrations.push("listings.featured already exists");
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_featured ON listings(featured);`);

  if (!hasColumn(db, "listings", "featured_until")) {
    db.exec(`ALTER TABLE listings ADD COLUMN featured_until INTEGER;`);
    migrations.push("Added listings.featured_until");
  } else {
    migrations.push("listings.featured_until already exists");
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_featured_until ON listings(featured_until);`);

  if (!hasColumn(db, "listings", "views")) {
    db.exec(`ALTER TABLE listings ADD COLUMN views INTEGER NOT NULL DEFAULT 0;`);
    migrations.push("Added listings.views");
  } else {
    migrations.push("listings.views already exists");
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_views ON listings(views);`);

  if (!hasColumn(db, "listings", "quantity")) {
    // Used by wanted posts (and optionally sale listings later). Keep a default for existing rows.
    db.exec(`ALTER TABLE listings ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1;`);
    migrations.push("Added listings.quantity");
  } else {
    migrations.push("listings.quantity already exists");
  }

  // Hard switch from legacy `age` -> `size` (no backwards compatibility in app code).
  // - If only `age` exists, rename it to `size` to preserve data.
  // - If neither exists, add `size`.
  // - If both exist (partial migration), we’ll later rebuild the table to drop `age`.
  const hasAge = hasColumn(db, "listings", "age");
  const hasSize = hasColumn(db, "listings", "size");
  if (!hasSize) {
    if (hasAge) {
      try {
        db.exec(`ALTER TABLE listings RENAME COLUMN age TO size;`);
        migrations.push("Renamed listings.age -> listings.size");
      } catch {
        // Older SQLite: fall back to adding size and copying data.
        db.exec(`ALTER TABLE listings ADD COLUMN size TEXT NOT NULL DEFAULT '';`);
        db.exec(`
UPDATE listings
SET size = COALESCE(NULLIF(trim(size), ''), COALESCE(age, ''))
WHERE age IS NOT NULL;
`);
        migrations.push("Added listings.size and backfilled from listings.age (rename unsupported)");
      }
    } else {
      db.exec(`ALTER TABLE listings ADD COLUMN size TEXT NOT NULL DEFAULT '';`);
      migrations.push("Added listings.size");
    }
  } else {
    migrations.push("listings.size already exists");
  }

  // Link sale listings to user accounts
  if (!hasColumn(db, "listings", "user_id")) {
    // SQLite allows adding a column with a REFERENCES clause, which becomes a FK constraint.
    db.exec(`ALTER TABLE listings ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;`);
    migrations.push("Added listings.user_id (FK -> users.id)");
  } else {
    migrations.push("listings.user_id already exists");
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_user_id ON listings(user_id);`);

  // Listing sale metadata: sex + phone contact
  if (!hasColumn(db, "listings", "sex")) {
    db.exec(`ALTER TABLE listings ADD COLUMN sex TEXT NOT NULL DEFAULT 'Unknown';`);
    migrations.push("Added listings.sex");
  } else {
    migrations.push("listings.sex already exists");
  }

  // Listing metadata: water type (optional, used for bio categories)
  if (!hasColumn(db, "listings", "water_type")) {
    db.exec(`ALTER TABLE listings ADD COLUMN water_type TEXT;`);
    migrations.push("Added listings.water_type");
  } else {
    migrations.push("listings.water_type already exists");
  }

  // Shipping flag: persisted so we can filter without parsing descriptions.
  if (!hasColumn(db, "listings", "shipping_offered")) {
    db.exec(`ALTER TABLE listings ADD COLUMN shipping_offered INTEGER NOT NULL DEFAULT 0;`);
    migrations.push("Added listings.shipping_offered");

    // Best-effort backfill for sale listings using the encoded details block.
    // This makes the filter immediately useful for existing data.
    if (hasColumn(db, "listings", "description")) {
      db.exec(`
UPDATE listings
SET shipping_offered = 1
WHERE listing_type = 0
AND shipping_offered = 0
AND lower(description) LIKE '%willingtoship=1%';
`);
      migrations.push("Backfilled listings.shipping_offered for sale listings using description details block");
    }
  } else {
    migrations.push("listings.shipping_offered already exists");
  }

  // Backfill water_type from legacy "Water type: ..." line embedded in description.
  if (hasColumn(db, "listings", "water_type") && hasColumn(db, "listings", "description")) {
    const rows = db
      .prepare(
        `
SELECT id, description, water_type
FROM listings
WHERE (water_type IS NULL OR trim(water_type) = '')
AND lower(description) LIKE '%water type:%'
`
      )
      .all() as Array<{ id: string; description: string; water_type: string | null }>;

    const upd = db.prepare(`UPDATE listings SET water_type = ?, description = ? WHERE id = ?`);
    let backfilled = 0;
    for (const r of rows) {
      const wt = extractWaterTypeFromDescription(r.description);
      if (!wt) continue;
      const cleanedDesc = stripWaterTypeLine(r.description);
      upd.run(wt, cleanedDesc, r.id);
      backfilled++;
    }
    if (backfilled) migrations.push(`Backfilled listings.water_type for ${backfilled} row(s) and removed legacy description lines`);
  }

  if (!hasColumn(db, "listings", "phone")) {
    // Required field going forward; default allows adding to existing rows.
    db.exec(`ALTER TABLE listings ADD COLUMN phone TEXT NOT NULL DEFAULT '';`);
    migrations.push("Added listings.phone");

    // Best-effort backfill from legacy contact column if it exists.
    if (hasColumn(db, "listings", "contact")) {
      db.exec(`
UPDATE listings
SET phone = COALESCE(NULLIF(trim(contact), ''), phone)
WHERE (phone IS NULL OR trim(phone) = '')
AND contact IS NOT NULL;
`);
      migrations.push("Backfilled listings.phone from legacy listings.contact where possible");
    }
  } else {
    migrations.push("listings.phone already exists");
  }

  // Unify "sell" and "wanted" into listings with a listing_type flag:
  // 0 = sell (default), 1 = wanted
  let addedListingType = false;
  if (!hasColumn(db, "listings", "listing_type")) {
    db.exec(`ALTER TABLE listings ADD COLUMN listing_type INTEGER NOT NULL DEFAULT 0;`);
    migrations.push("Added listings.listing_type (0=sell, 1=wanted)");
    addedListingType = true;
  } else {
    migrations.push("listings.listing_type already exists");
  }

  // Existing rows should all be sell listings.
  // Only do the "force to 0" backfill on the first migration run that introduces the column,
  // so we don't clobber future wanted posts.
  if (addedListingType) db.exec(`UPDATE listings SET listing_type = 0;`);
  else db.exec(`UPDATE listings SET listing_type = 0 WHERE listing_type IS NULL;`);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_listing_type ON listings(listing_type);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_listing_type_created_at ON listings(listing_type, created_at);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_listing_type_user_id ON listings(listing_type, user_id);`);

  // Wanted-specific fields live on listings rows where listing_type=1.
  if (!hasColumn(db, "listings", "budget_cents")) {
    db.exec(`ALTER TABLE listings ADD COLUMN budget_cents INTEGER;`);
    migrations.push("Added listings.budget_cents (wanted)");
  } else {
    migrations.push("listings.budget_cents already exists");
  }

  // Remove legacy wanted_posts table (it is expected to be empty).
  if (hasTable(db, "wanted_posts")) {
    db.exec(`DROP TABLE IF EXISTS wanted_posts;`);
    migrations.push("Dropped legacy wanted_posts table");
  } else {
    migrations.push("wanted_posts table already removed (or never existed)");
  }

  // Ensure listing_images exists before we potentially backfill from legacy image_url.
  ensureListingImagesTable(db);
  ensureReportsTable(db);
  ensureAdminAuditTable(db);
  ensureNotificationsTable(db);
  ensureUserModerationTable(db);
  ensureSiteSettingsTable(db);

  // Drop legacy columns on listings (owner_token, image_url, older wanted budget columns, and now removed status columns) by rebuilding the table.
  const hasOwnerToken = hasColumn(db, "listings", "owner_token");
  const hasImageUrl = hasColumn(db, "listings", "image_url");
  const hasBudgetMin = hasColumn(db, "listings", "budget_min_cents");
  const hasBudgetMax = hasColumn(db, "listings", "budget_max_cents");
  const hasResolution = hasColumn(db, "listings", "resolution");
  const hasResolvedAt = hasColumn(db, "listings", "resolved_at");
  const hasWantedStatus = hasColumn(db, "listings", "wanted_status");

  const hasAgeStill = hasColumn(db, "listings", "age");
  const hasSizeNow = hasColumn(db, "listings", "size");
  const needsListingsRebuild =
    hasOwnerToken || hasImageUrl || hasBudgetMin || hasBudgetMax || (hasAgeStill && hasSizeNow) || hasResolution || hasResolvedAt || hasWantedStatus;

  if (needsListingsRebuild) {
    const budgetExpr = hasBudgetMax && hasBudgetMin
      ? "COALESCE(budget_max_cents, budget_min_cents)"
      : hasBudgetMax
        ? "budget_max_cents"
        : hasBudgetMin
          ? "budget_min_cents"
          : "NULL";

    // Preserve old single-image data by backfilling into listing_images (only when no images exist).
    if (hasImageUrl) {
      const rows = db
        .prepare(
          `
SELECT id, image_url
FROM listings
WHERE image_url IS NOT NULL
AND trim(image_url) <> ''
`
        )
        .all() as Array<{ id: string; image_url: string }>;

      const countExisting = db.prepare(`SELECT COUNT(*)as c FROM listing_images WHERE listing_id = ?`);
      const insertImg = db.prepare(
        `INSERT INTO listing_images(id,listing_id,url,thumb_url,medium_url,sort_order)
VALUES(?,?,?,?,?,?)`
      );

      let inserted = 0;
      for (const r of rows) {
        const c = Number((countExisting.get(r.id) as any)?.c ?? 0);
        if (c > 0) continue;
        insertImg.run(crypto.randomUUID(), r.id, r.image_url, r.image_url, r.image_url, 0);
        inserted++;
      }
      if (inserted) migrations.push(`Backfilled listing_images from legacy listings.image_url for ${inserted} row(s)`);
    }

    // Migrate legacy status values into the new unified `status` column.
    // Sale listings: resolution='sold' -> status='sold'
    // Wanted listings: wanted_status='closed' -> status='closed'
    if (hasResolution) {
      db.exec(`
UPDATE listings
SET status = 'sold'
WHERE listing_type = 0
AND resolution = 'sold'
AND status NOT IN ('sold', 'closed', 'deleted');
`);
      migrations.push("Migrated legacy listings.resolution='sold' to status='sold'");
    }
    if (hasWantedStatus) {
      db.exec(`
UPDATE listings
SET status = 'closed'
WHERE listing_type = 1
AND wanted_status = 'closed'
AND status NOT IN ('sold', 'closed', 'deleted');
`);
      migrations.push("Migrated legacy listings.wanted_status='closed' to status='closed'");
    }

    db.exec(`PRAGMA foreign_keys = OFF;`);
    const tx = db.transaction(() => {
      const publishedExpr = hasColumn(db, "listings", "published_at") ? "published_at" : "NULL";
      const sizeExpr = hasAgeStill ? "COALESCE(NULLIF(trim(size), ''), COALESCE(age, ''))" : "COALESCE(size, '')";
      db.exec(`
CREATE TABLE IF NOT EXISTS listings_new(
  id TEXT PRIMARY KEY,
  user_id INTEGER,
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
  shipping_offered INTEGER NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 1,
  price_cents INTEGER NOT NULL,
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
`);

      // Copy over all non-legacy columns. Legacy columns (owner_token, image_url, budget_min/max, age, resolution, resolved_at, wanted_status) are dropped.
      db.exec(`
INSERT INTO listings_new(
  id,user_id,listing_type,
  featured,featured_until,views,
  title,category,species,sex,water_type,size,shipping_offered,quantity,price_cents,
  budget_cents,
  location,description,phone,
  status,published_at,expires_at,
  created_at,updated_at,deleted_at
)
SELECT
  id,
  user_id,
  COALESCE(listing_type, 0),
  COALESCE(featured, 0),
  featured_until,
  COALESCE(views, 0),
  title,
  COALESCE(category, 'Fish'),
  COALESCE(species, ''),
  COALESCE(sex, 'Unknown'),
  water_type,
  ${sizeExpr},
  COALESCE(shipping_offered, 0),
  COALESCE(quantity, 1),
  COALESCE(price_cents, 0),
  CASE WHEN COALESCE(listing_type, 0) = 1 THEN ${budgetExpr} ELSE NULL END,
  location,
  description,
  COALESCE(phone, ''),
  COALESCE(status, 'active'),
  ${publishedExpr},
  expires_at,
  created_at,
  COALESCE(updated_at, created_at),
  deleted_at
FROM listings;
`);

      db.exec(`DROP TABLE listings;`);
      db.exec(`ALTER TABLE listings_new RENAME TO listings;`);

      // Recreate indexes (minus legacy owner_token/resolution/wanted_status indexes).
      db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_created_at ON listings(created_at);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_updated_at ON listings(updated_at);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_species ON listings(species);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_price ON listings(price_cents);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_category ON listings(category);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_user_id ON listings(user_id);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_featured ON listings(featured);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_featured_until ON listings(featured_until);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_views ON listings(views);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_published_at ON listings(published_at);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_expires_at ON listings(expires_at);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_listing_type ON listings(listing_type);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_listing_type_created_at ON listings(listing_type, created_at);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_listing_type_user_id ON listings(listing_type, user_id);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_listing_type_status_created_at ON listings(listing_type, status, created_at);`);
    });

    tx();
    db.exec(`PRAGMA foreign_keys = ON;`);
    migrations.push("Rebuilt listings table to remove legacy columns (owner_token, image_url, age, budget_min/max, resolution, resolved_at, wanted_status)");
  } else {
    migrations.push("listings already has no legacy columns that require table rebuild");
  }

  // Ensure listings.expires_at exists (wanted + sale TTL support).
  if (!hasColumn(db, "listings", "expires_at")) {
    db.exec(`ALTER TABLE listings ADD COLUMN expires_at TEXT;`);
    migrations.push("Added listings.expires_at");
  } else {
    migrations.push("listings.expires_at already exists");
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_expires_at ON listings(expires_at);`);

  // Ensure listings.published_at exists (public posted time).
  if (!hasColumn(db, "listings", "published_at")) {
    db.exec(`ALTER TABLE listings ADD COLUMN published_at TEXT;`);
    migrations.push("Added listings.published_at");
  } else {
    migrations.push("listings.published_at already exists");
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_published_at ON listings(published_at);`);

  // Remove legacy "featured forever" rows (featured=1 but no timer).
  if (hasColumn(db, "listings", "featured") && hasColumn(db, "listings", "featured_until")) {
    const changed = db
      .prepare(`UPDATE listings SET featured = 0, featured_until = NULL WHERE featured = 1 AND featured_until IS NULL`)
      .run().changes;
    if (changed) migrations.push(`Cleared legacy featured-without-timer for ${changed} row(s)`);
  }

  // Backfill wanted expires_at for legacy rows (runtime no longer backfills this).
  if (hasColumn(db, "listings", "listing_type") && hasColumn(db, "listings", "created_at") && hasColumn(db, "listings", "expires_at")) {
    const ttlDaysRaw = Number(process.env.LISTING_TTL_DAYS ?? "30");
    const ttlDays = Number.isFinite(ttlDaysRaw) && ttlDaysRaw > 0 ? Math.floor(ttlDaysRaw) : 30;
    const now = new Date().toISOString();

    const rows = db
      .prepare(
        `
SELECT id, created_at
FROM listings
WHERE listing_type = 1
AND status <> 'deleted'
AND (expires_at IS NULL OR trim(expires_at) = '')
`
      )
      .all() as Array<{ id: string; created_at: string }>;

    const upd = db.prepare(`UPDATE listings SET expires_at = ?, updated_at = ? WHERE id = ? AND listing_type = 1`);
    let backfilled = 0;
    for (const r of rows) {
      const exp = addDaysIso(String(r.created_at ?? ""), ttlDays);
      if (!exp) continue;
      upd.run(exp, now, String(r.id));
      backfilled++;
    }
    if (backfilled) migrations.push(`Backfilled expires_at for ${backfilled} wanted listing(s)`);
  }

  // Normalize wanted descriptions to always include the details prefix (no deployed back-compat needed).
  if (hasColumn(db, "listings", "listing_type") && hasColumn(db, "listings", "description")) {
    const rows = db
      .prepare(
        `
SELECT id, description
FROM listings
WHERE listing_type = 1
AND description IS NOT NULL
`
      )
      .all() as Array<{ id: string; description: string }>;

    const upd = db.prepare(`UPDATE listings SET description = ? WHERE id = ? AND listing_type = 1`);
    let updated = 0;
    for (const r of rows) {
      const desc = String(r.description ?? "");
      if (hasWantedDetailsPrefix(desc)) continue;
      upd.run(encodeWantedDetailsIntoDescription(desc), String(r.id));
      updated++;
    }
    if (updated) migrations.push(`Prefixed description details for ${updated} wanted listing(s)`);
  }

  // Backfill published_at (prefer admin approval time where available; else created_at).
  if (hasColumn(db, "listings", "published_at") && hasColumn(db, "listings", "created_at")) {
    // First, if we have admin audit approvals, use the earliest approval timestamp per listing.
    if (hasTable(db, "admin_audit")) {
      try {
        const changed = db
          .prepare(
            `
UPDATE listings
SET published_at = (
  SELECT MIN(a.created_at)
  FROM admin_audit a
  WHERE a.action = 'approve'
  AND a.target_id = listings.id
  AND a.target_kind = CASE WHEN COALESCE(listings.listing_type, 0) = 1 THEN 'wanted' ELSE 'sale' END
)
WHERE published_at IS NULL
`
          )
          .run().changes;
        if (changed) migrations.push(`Backfilled published_at from admin approvals for ${changed} listing(s)`);
      } catch {
        // ignore; fall back to created_at below
      }
    }

    // Fallback for already-public (or previously public) listings.
    const changed2 = db
      .prepare(
        `
UPDATE listings
SET published_at = created_at
WHERE published_at IS NULL
AND created_at IS NOT NULL
AND trim(created_at) <> ''
AND status NOT IN ('draft','pending')
`
      )
      .run().changes;
    if (changed2) migrations.push(`Backfilled published_at from created_at for ${changed2} listing(s)`);
  }

  if (args.seedFeatured) {
    if (args.replaceFeatured) {
      db.exec(`UPDATE listings SET featured = 0, featured_until = NULL;`);
      migrations.push("Cleared featured flags + timers");
    }

    const ids = db
      .prepare(
        `
SELECT id
FROM listings
WHERE status IN('active','pending')
AND (deleted_at IS NULL OR deleted_at = '')
ORDER BY created_at DESC
LIMIT 6
`
      )
      .all() as Array<{ id: string }>;

    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const stmt = db.prepare(`UPDATE listings SET featured = 1, featured_until = ? WHERE id = ?`);
    let marked = 0;
    for (const r of ids) {
      stmt.run(now + sevenDaysMs, r.id);
      marked++;
    }
    migrations.push(`Seeded featured=true for ${marked} listing(s)`);
  }

  console.log(`DB migration complete (${dbPath}).`);
  for (const m of migrations) console.log(`- ${m}`);
}

main();

