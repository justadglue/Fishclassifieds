import "dotenv/config";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import {
  BIO_FIELDS_REQUIRED_CATEGORIES,
  LISTING_CATEGORIES,
  LISTING_SEXES,
  OTHER_CATEGORY,
  WATER_TYPES,
} from "../src/listingOptions.js";

type Args = {
  dryRun: boolean;
  seed: string;
  limit?: number;
  help: boolean;
};

function parseArgs(argv: string[]): Args {
  const out: Args = { dryRun: false, seed: "fishclassifieds-backfill-v1", help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--seed") out.seed = String(argv[i + 1] ?? out.seed), i++;
    else if (a === "--limit") {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n)) out.limit = Math.max(1, Math.floor(n));
      i++;
    }
  }
  return out;
}

function usage() {
  return `
Backfill dummy listings (retroactive data migration)

Fixes older seeded/filler listings so they show up in public Browse again by:
- assigning user_id to one of 3 existing users (deterministic pseudo-random)
- ensuring status='active' (for draft/pending/expired rows)
- ensuring expires_at is in the future (so auto-expire doesn't hide them)
- filling missing required-ish fields (title/location/description/phone/species/etc)

Usage:
  npm --prefix backend run db:migration   # (optional) run schema migration first
  npx --yes tsx backend/scripts/backfill_dummy_attribution.ts --dry-run
  npx --yes tsx backend/scripts/backfill_dummy_attribution.ts

Flags:
  --dry-run           Print what would change, but don't update the DB
  --seed <string>     Seed for deterministic pseudo-randomness (default: fishclassifieds-backfill-v1)
  --limit <n>         Only process up to N rows (for testing)
  -h, --help          Show this help
`.trim();
}

function nowIso() {
  return new Date().toISOString();
}

function addDaysIso(isoNow: string, days: number) {
  const d = new Date(isoNow);
  if (!Number.isFinite(d.getTime())) return new Date().toISOString();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function hashU32(input: string) {
  const buf = crypto.createHash("sha256").update(input).digest();
  return buf.readUInt32LE(0);
}

function pickFrom<T>(arr: readonly T[], seedBase: string, key: string): T {
  const n = hashU32(`${seedBase}|${key}`) % arr.length;
  return arr[n]!;
}

function randInt(min: number, maxInclusive: number, seedBase: string, key: string) {
  if (maxInclusive < min) return min;
  const span = maxInclusive - min + 1;
  const n = hashU32(`${seedBase}|${key}`) % span;
  return min + n;
}

function normStr(v: any) {
  return String(v ?? "").trim();
}

function needsBioFields(category: string) {
  const c = String(category ?? "");
  if (!c) return true;
  if (c === OTHER_CATEGORY) return false;
  return (BIO_FIELDS_REQUIRED_CATEGORIES as readonly string[]).includes(c);
}

function pickSpecies(category: string, seedBase: string) {
  const c = String(category ?? "");
  const byCat: Record<string, string[]> = {
    Fish: ["Guppy", "Betta", "Discus", "Angelfish", "Neon Tetra", "Corydoras", "Rams", "Pleco"],
    Shrimp: ["Cherry Shrimp", "Blue Dream Shrimp", "Amano Shrimp"],
    Snails: ["Nerite Snail", "Mystery Snail", "Ramshorn Snail"],
    Crayfish: ["CPO Crayfish", "Blue Yabby"],
    Crabs: ["Vampire Crab"],
    "Clams & Mussels": ["Freshwater Mussel"],
    Axolotls: ["Axolotl"],
    Plants: ["Anubias", "Java Fern", "Amazon Sword", "Cryptocoryne", "Vallisneria"],
    Corals: ["Zoanthids", "Mushroom Coral", "Hammer Coral"],
  };
  const list = byCat[c] ?? ["Aquarium livestock"];
  return pickFrom(list, seedBase, "species");
}

function pickSize(category: string, seedBase: string) {
  const c = String(category ?? "");
  const byCat: Record<string, string[]> = {
    Fish: ["1-2cm", "2-3cm", "3-5cm", "Juvenile", "Adult"],
    Shrimp: ["Juvenile", "Adult", "Mixed sizes"],
    Snails: ["Small", "Medium", "Adult"],
    Plants: ["Small bunch", "Medium bunch", "Large bunch", "Cutting", "Potted"],
    Corals: ["Frag", "Small colony", "Medium colony"],
    Equipment: ["Good condition", "Like new"],
  };
  const list = byCat[c] ?? ["Good condition"];
  return pickFrom(list, seedBase, "size");
}

function getListingTtlDays(db: Database.Database): number {
  try {
    const rows = db.prepare(`SELECT key,value_json FROM site_settings`).all() as any[];
    const row = rows.find((r) => String(r.key) === "listingTtlDays");
    if (!row) return 30;
    const parsed = JSON.parse(String(row.value_json ?? "null"));
    const n = Number(parsed);
    if (!Number.isFinite(n)) return 30;
    return Math.max(1, Math.min(365, Math.floor(n)));
  } catch {
    return 30;
  }
}

type ListingRow = {
  id: string;
  user_id: number | null;
  listing_type: number;
  title: string;
  category: string;
  species: string;
  sex: string;
  water_type: string | null;
  size: string;
  shipping_offered: number;
  quantity: number;
  price_cents: number;
  budget_cents: number | null;
  location: string;
  description: string;
  phone: string;
  status: string;
  published_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }

  // Expect to run from repo root or backend/. Prefer backend/data/app.db if present.
  const cwd = process.cwd();
  const dbPathCandidates = [
    path.join(cwd, "backend", "data", "app.db"),
    path.join(cwd, "data", "app.db"),
  ];
  const dbPath = dbPathCandidates.find((p) => fs.existsSync(p));
  if (!dbPath) {
    throw new Error(`Could not find SQLite DB. Looked for: ${dbPathCandidates.join(", ")}`);
  }

  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");

  const users = db
    .prepare(`SELECT id, username, is_admin, is_superadmin FROM users ORDER BY id ASC LIMIT 3`)
    .all() as Array<{ id: number; username: string; is_admin: number; is_superadmin: number }>;

  if (users.length < 3) {
    throw new Error(`Need at least 3 users in DB to assign listings. Found ${users.length}.`);
  }

  const userIds = users.map((u) => Number(u.id));
  const ttlDays = getListingTtlDays(db);
  const now = nowIso();

  const candidates = db
    .prepare(
      `
SELECT l.*
FROM listings l
LEFT JOIN users u ON u.id = l.user_id
WHERE (l.deleted_at IS NULL OR trim(l.deleted_at) = '')
  AND COALESCE(l.status, '') <> 'deleted'
  AND (
    l.user_id IS NULL OR u.id IS NULL
    OR COALESCE(l.status, '') IN ('', 'draft', 'pending', 'expired')
    OR length(trim(COALESCE(l.title, ''))) < 3
    OR length(trim(COALESCE(l.location, ''))) < 2
    OR length(trim(COALESCE(l.description, ''))) < 1
    OR length(trim(COALESCE(l.phone, ''))) < 6
    OR (
      l.expires_at IS NOT NULL
      AND trim(l.expires_at) <> ''
      AND l.expires_at < ?
    )
  )
ORDER BY l.created_at DESC, l.id DESC
`
    )
    .all(now) as ListingRow[];

  const rows = args.limit ? candidates.slice(0, args.limit) : candidates;

  console.log(`DB: ${dbPath}`);
  console.log(`Users (pool of 3): ${users.map((u) => `${u.id}:${u.username}`).join(", ")}`);
  console.log(`TTL days (from settings): ${ttlDays}`);
  console.log(`Candidate listings to backfill: ${candidates.length}${args.limit ? ` (processing first ${rows.length})` : ""}`);

  if (rows.length === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  const upd = db.prepare(`
UPDATE listings
SET
  user_id = ?,
  listing_type = ?,
  title = ?,
  category = ?,
  species = ?,
  sex = ?,
  water_type = ?,
  size = ?,
  shipping_offered = ?,
  quantity = ?,
  price_cents = ?,
  budget_cents = ?,
  location = ?,
  description = ?,
  phone = ?,
  status = ?,
  published_at = ?,
  expires_at = ?,
  created_at = ?,
  updated_at = ?
WHERE id = ?
`);

  const tx = db.transaction(() => {
    let changed = 0;
    let assigned = 0;
    let activated = 0;
    let bumpedExpiry = 0;
    let filledBasics = 0;

    for (const r of rows) {
      const seedBase = `${args.seed}:${r.id}`;
      const listingType = Number.isFinite(Number(r.listing_type)) ? Number(r.listing_type) : 0;
      const isWanted = listingType === 1;

      const pickedUser = pickFrom(userIds, seedBase, "user");

      const oldStatus = normStr(r.status) || "active";
      const nextStatus = ["draft", "pending", "expired", ""].includes(oldStatus) ? "active" : oldStatus;

      const oldExp = normStr(r.expires_at);
      const nextExpiresAt = !oldExp || oldExp < now ? addDaysIso(now, ttlDays) : oldExp;

      const oldPub = normStr(r.published_at);
      const oldCreated = normStr(r.created_at);
      const createdAt = oldCreated ? oldCreated : now;
      const publishedAt = oldPub ? oldPub : createdAt;

      const categoryRaw = normStr(r.category);
      const category = categoryRaw ? (categoryRaw as any) : (pickFrom(LISTING_CATEGORIES, seedBase, "category") as any);

      const bioReq = needsBioFields(category);

      const speciesRaw = normStr(r.species);
      const species = bioReq ? (speciesRaw ? speciesRaw : pickSpecies(category, seedBase)) : speciesRaw;

      const sexRaw = normStr(r.sex);
      const wantedSexes = [...LISTING_SEXES, "No preference"] as const;
      const sex = sexRaw
        ? sexRaw
        : isWanted
          ? pickFrom(wantedSexes, seedBase, "sex")
          : pickFrom(LISTING_SEXES, seedBase, "sex");

      const waterRaw = normStr((r as any).water_type);
      const waterType = bioReq ? (waterRaw ? waterRaw : pickFrom(WATER_TYPES, seedBase, "waterType")) : (waterRaw || null);

      const sizeRaw = normStr((r as any).size);
      const size = bioReq ? (sizeRaw ? sizeRaw : pickSize(category, seedBase)) : (sizeRaw || "");

      const qtyRaw = Number(r.quantity);
      const quantity = Number.isFinite(qtyRaw) && qtyRaw >= 1 ? Math.floor(qtyRaw) : randInt(1, 12, seedBase, "quantity");

      const shippingRaw = Number((r as any).shipping_offered ?? 0);
      const shippingOffered = Number.isFinite(shippingRaw) ? (shippingRaw ? 1 : 0) : randInt(0, 1, seedBase, "ship");

      const titleRaw = normStr(r.title);
      const title =
        titleRaw && titleRaw.length >= 3
          ? titleRaw.slice(0, 80)
          : isWanted
            ? `Wanted: ${species || "aquarium items"}`
            : `${species || "Aquarium stock"} - healthy stock`;

      const locationRaw = normStr(r.location);
      const locations = ["Brisbane", "Gold Coast", "Sydney", "Melbourne", "Perth", "Adelaide", "Canberra", "Hobart", "Darwin"] as const;
      const location = locationRaw && locationRaw.length >= 2 ? locationRaw.slice(0, 80) : pickFrom(locations, seedBase, "location");

      const phoneRaw = normStr(r.phone);
      const phones = ["0400 123 456", "0412 345 678", "0423 456 789"] as const;
      const phone = phoneRaw && phoneRaw.replace(/\s+/g, "").length >= 6 ? phoneRaw.slice(0, 30) : pickFrom(phones, seedBase, "phone");

      const descRaw = normStr(r.description);
      const description =
        descRaw && descRaw.length >= 1
          ? descRaw.slice(0, 2000)
          : isWanted
            ? `Looking to buy ${species || "aquarium stock"}. Happy to discuss pickup or shipping.`
            : `Healthy, well-kept ${species || "aquarium stock"}. Pickup preferred. Message to arrange.`;

      const priceRaw = Number(r.price_cents);
      const budgetRaw = r.budget_cents != null ? Number(r.budget_cents) : null;

      const priceCents = isWanted
        ? 0
        : Number.isFinite(priceRaw) && priceRaw > 0
          ? Math.floor(priceRaw)
          : randInt(500, 25_000, seedBase, "priceCents");

      const budgetCents = isWanted
        ? (() => {
          // Some wanted posts have no budget (Make an offer).
          const allowNull = randInt(0, 9, seedBase, "budgetNullRoll") < 3;
          if (allowNull) return null;
          if (budgetRaw != null && Number.isFinite(budgetRaw) && budgetRaw >= 0) return Math.floor(budgetRaw);
          return randInt(2_000, 40_000, seedBase, "budgetCents");
        })()
        : null;

      const nextListingType = isWanted ? 1 : 0;

      const nextUpdatedAt = now;
      const updates = {
        user_id: pickedUser,
        listing_type: nextListingType,
        title,
        category,
        species,
        sex,
        water_type: waterType,
        size,
        shipping_offered: shippingOffered,
        quantity,
        price_cents: priceCents,
        budget_cents: budgetCents,
        location,
        description,
        phone,
        status: nextStatus,
        published_at: publishedAt,
        expires_at: nextExpiresAt,
        created_at: createdAt,
        updated_at: nextUpdatedAt,
      };

      const willAssign = r.user_id == null;
      const willActivate = oldStatus !== nextStatus;
      const willBumpExpiry = oldExp !== nextExpiresAt;
      const willFillBasics =
        titleRaw !== title ||
        locationRaw !== location ||
        phoneRaw !== phone ||
        descRaw !== description ||
        (speciesRaw !== species && bioReq);

      if (willAssign) assigned++;
      if (willActivate) activated++;
      if (willBumpExpiry) bumpedExpiry++;
      if (willFillBasics) filledBasics++;

      if (!args.dryRun) {
        const info = upd.run(
          updates.user_id,
          updates.listing_type,
          updates.title,
          updates.category,
          updates.species,
          updates.sex,
          updates.water_type,
          updates.size,
          updates.shipping_offered,
          updates.quantity,
          updates.price_cents,
          updates.budget_cents,
          updates.location,
          updates.description,
          updates.phone,
          updates.status,
          updates.published_at,
          updates.expires_at,
          updates.created_at,
          updates.updated_at,
          r.id
        );
        changed += info.changes;
      }
    }

    return { changed, assigned, activated, bumpedExpiry, filledBasics };
  });

  const summary = tx();

  if (args.dryRun) {
    console.log("Dry run complete (no DB writes).");
  } else {
    console.log(`Backfill complete. Updated rows: ${summary.changed}`);
  }
  console.log(
    `Summary: assigned user_id=${summary.assigned}, activated=${summary.activated}, bumpedExpiry=${summary.bumpedExpiry}, filledBasics=${summary.filledBasics}`
  );
}

main();

