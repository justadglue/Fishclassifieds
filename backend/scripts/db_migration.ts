import "dotenv/config";
import path from "path";
import Database from "better-sqlite3";

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

  // Ensure users has required first_name/last_name (NOT NULL) and display_name is nullable.
  const hasFirst = hasColumn(db, "users", "first_name");
  const hasLast = hasColumn(db, "users", "last_name");
  const firstNotNull = hasFirst ? isColumnNotNull(db, "users", "first_name") : false;
  const lastNotNull = hasLast ? isColumnNotNull(db, "users", "last_name") : false;
  const hasDisplay = hasColumn(db, "users", "display_name");
  const displayNotNull = hasDisplay ? isColumnNotNull(db, "users", "display_name") : false;

  const needsUsersRebuild = !hasFirst || !hasLast || !firstNotNull || !lastNotNull || displayNotNull;

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
  display_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

      const firstExpr = hasFirst ? "first_name" : "''";
      const lastExpr = hasLast ? "last_name" : "''";

      db.exec(`
INSERT INTO users_new(id,email,username,first_name,last_name,password_hash,display_name,created_at,updated_at)
SELECT
  id,
  email,
  username,
  COALESCE(NULLIF(trim(${firstExpr}), ''), 'Unknown'),
  COALESCE(NULLIF(trim(${lastExpr}), ''), 'Unknown'),
  password_hash,
  display_name,
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
    if (displayNotNull) migrations.push("Made users.display_name nullable");
    if ((hasFirst && !firstNotNull) || (hasLast && !lastNotNull)) migrations.push("Enforced NOT NULL on users.first_name / users.last_name");
  } else {
    migrations.push("users schema already includes required first_name/last_name and nullable display_name");
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

  // Link sale listings to user accounts
  if (!hasColumn(db, "listings", "user_id")) {
    // SQLite allows adding a column with a REFERENCES clause, which becomes a FK constraint.
    db.exec(`ALTER TABLE listings ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;`);
    migrations.push("Added listings.user_id (FK -> users.id)");
  } else {
    migrations.push("listings.user_id already exists");
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_user_id ON listings(user_id);`);

  // Wanted posts (buyer requests)
  db.exec(`
CREATE TABLE IF NOT EXISTS wanted_posts(
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Fish',
  species TEXT,
  budget_min_cents INTEGER,
  budget_max_cents INTEGER,
  location TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_wanted_posts_created_at ON wanted_posts(created_at);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_wanted_posts_status_created_at ON wanted_posts(status, created_at);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_wanted_posts_user_id ON wanted_posts(user_id);`);
  migrations.push("Ensured wanted_posts table + indexes");

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
AND resolution = 'none'
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

