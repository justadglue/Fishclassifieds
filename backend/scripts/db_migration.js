import "dotenv/config";
import path from "path";
import Database from "better-sqlite3";
function parseArgs(argv) {
    const out = { seedFeatured: false, replaceFeatured: false, help: false };
    for (const a of argv) {
        if (a === "--help" || a === "-h")
            out.help = true;
        if (a === "--seed-featured")
            out.seedFeatured = true;
        if (a === "--replace-featured")
            out.replaceFeatured = true;
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
function hasColumn(db, table, col) {
    const rows = db.pragma(`table_info(${table})`);
    return rows.some((r) => r.name === col);
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
    const migrations = [];
    if (!hasColumn(db, "listings", "featured")) {
        db.exec(`ALTER TABLE listings ADD COLUMN featured INTEGER NOT NULL DEFAULT 0;`);
        migrations.push("Added listings.featured");
    }
    else {
        migrations.push("listings.featured already exists");
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_featured ON listings(featured);`);
    if (args.seedFeatured) {
        if (args.replaceFeatured) {
            db.exec(`UPDATE listings SET featured = 0;`);
            migrations.push("Cleared featured flags");
        }
        const ids = db
            .prepare(`
SELECT id
FROM listings
WHERE status IN('active','pending')
AND resolution = 'none'
AND (deleted_at IS NULL OR deleted_at = '')
ORDER BY created_at DESC
LIMIT 6
`)
            .all();
        const stmt = db.prepare(`UPDATE listings SET featured = 1 WHERE id = ?`);
        let marked = 0;
        for (const r of ids) {
            stmt.run(r.id);
            marked++;
        }
        migrations.push(`Seeded featured=true for ${marked} listing(s)`);
    }
    console.log(`DB migration complete (${dbPath}).`);
    for (const m of migrations)
        console.log(`- ${m}`);
}
main();
