#!/usr/bin/env node
/**
 * Generate AU Location options (LGA + state-only) from the ABS workbook.
 *
 * Deployed artifact:
 *  - frontend/public/locations.au.json
 *
 * Supporting inputs:
 *  - scripts/locations/source/32180DS0002_2023-24.xlsx
 *
 * Extraction:
 *  - Parse "Table 1" to "Table 7" for LGA rows (state-specific tables)
 *  - Ignore first 7 rows and last 3 rows (metadata/footers)
 *  - Extract:
 *      - LGA name (column B)
 *      - 2024 population (ERP at 30 June 2024, column D)
 *  - Add state-only options using "Table 8" state populations (also ignoring first 7 / last 3 rows)
 *  - Add ACT fallback (ACT is not an LGA system)
 *
 * Output JSON objects:
 *   { id, label, lga, state, population }
 *
 * Note: field names are kept stable for the frontend typeahead (it searches `lga`/`label`).
 */

import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";

const REPO_ROOT = process.cwd();
const IN_XLSX = path.join(REPO_ROOT, "scripts", "locations", "source", "32180DS0002_2023-24.xlsx");
const OUT_PUBLIC = path.join(REPO_ROOT, "frontend", "public", "locations.au.json");

function normKey(s) {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function buildId(stateAbbrev, lga) {
  return `${normKey(stateAbbrev)}:${normKey(lga)}`;
}

function abbrevState(adminName) {
  const raw = String(adminName ?? "").trim();
  const k = raw.toLowerCase().replace(/\s+/g, " ");
  const map = new Map([
    ["australian capital territory", "ACT"],
    ["new south wales", "NSW"],
    ["northern territory", "NT"],
    ["queensland", "QLD"],
    ["south australia", "SA"],
    ["tasmania", "TAS"],
    ["victoria", "VIC"],
    ["western australia", "WA"],
    // Already abbreviated
    ["act", "ACT"],
    ["nsw", "NSW"],
    ["nt", "NT"],
    ["qld", "QLD"],
    ["sa", "SA"],
    ["tas", "TAS"],
    ["vic", "VIC"],
    ["wa", "WA"],
  ]);
  const hit = map.get(k);
  if (hit) return hit;

  // Fallback heuristic: first letter of each word.
  const parts = k.split(" ").filter(Boolean);
  if (parts.length >= 2 && parts.length <= 4) return parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
  if (raw.length <= 4) return raw.toUpperCase();
  return raw.toUpperCase();
}

function makeCandidate(row) {
  const lga = String(row.lga ?? "").trim();
  const state = String(row.state ?? "").trim();
  const population = typeof row.population === "number" && Number.isFinite(row.population) ? row.population : null;
  const label = `${lga}, ${state}`;
  const id = buildId(state, lga);
  return { id, label, lga, state, population };
}

function makeStateCandidate(state, population) {
  const st = String(state ?? "").trim();
  const pop = typeof population === "number" && Number.isFinite(population) ? population : null;
  return {
    id: `state:${normKey(st)}`,
    label: st,
    lga: st,
    state: st,
    population: pop,
  };
}

function cellStr(ws, rowIdx1, colIdx1) {
  const row = ws.getRow(rowIdx1);
  const cell = row.getCell(colIdx1);
  const v = cell?.value ?? "";
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") {
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("richText" in v && Array.isArray(v.richText)) return v.richText.map((p) => p.text ?? "").join("");
    if ("result" in v) return String(v.result ?? "");
  }
  return String(v);
}

function cellNum(ws, rowIdx1, colIdx1) {
  const row = ws.getRow(rowIdx1);
  const cell = row.getCell(colIdx1);
  const v = cell?.value ?? null;
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const t = v.trim().replace(/,/g, "");
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "object" && v && "result" in v) {
    const n = Number(v.result);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function main() {
  if (!fs.existsSync(IN_XLSX)) {
    console.error(`Missing input workbook: ${IN_XLSX}`);
    process.exit(1);
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(IN_XLSX);

  const targetSheets = wb.worksheets.map((w) => w.name).filter((n) => /^Table [1-7]$/.test(n));

  const byKey = new Map(); // lga|state -> record
  let totalLgaRows = 0;

  // Add state-only options (abbreviated) using Table 8 state populations where available.
  const wsStates = wb.getWorksheet("Table 8");
  if (wsStates) {
    const startRow = 8;
    const endRow = Math.max(startRow - 1, wsStates.rowCount - 3);
    for (let i = startRow; i <= endRow; i++) {
      const stateName = String(wsStates.getRow(i).getCell(2).text ?? "").trim();
      if (!stateName) continue;
      const st = abbrevState(stateName);
      const pop2024 = cellNum(wsStates, i, 4);
      const cand = makeStateCandidate(st, pop2024);
      const key = `${normKey(cand.lga)}|${normKey(cand.state)}`;
      if (!byKey.has(key)) byKey.set(key, cand);
    }
  }

  // ABS workbook Tables 1-7 do not include ACT LGAs (ACT is not an LGA system),
  // but we still want a usable "ACT" option in the dropdown.
  const EXTRA_LGAS = [{ lga: "Canberra", state: "ACT", population: null }];

  for (const sheetName of targetSheets) {
    const ws = wb.getWorksheet(sheetName);
    if (!ws) continue;

    // Infer state name from the title row e.g.:
    // "Table 1. ... Local Government Areas, New South Wales"
    const title = cellStr(ws, 3, 1);
    const m = title.match(/Local Government Areas,\s*(.+)\s*$/i);
    const stateFull = m ? String(m[1]).trim() : "";
    const state = abbrevState(stateFull);

    // Ignore first 7 rows and last 3 rows (metadata/footers).
    // In this workbook, row 7 is the table header, and row 8 begins data.
    const startRow = 8;
    const endRow = Math.max(startRow - 1, ws.rowCount - 3);

    for (let i = startRow; i <= endRow; i++) {
      const lgaName = cellStr(ws, i, 2).trim();
      if (!lgaName) continue;

      // 2024 ERP is column D in these tables.
      const pop2024 = cellNum(ws, i, 4);

      totalLgaRows++;
      const cand = makeCandidate({ lga: lgaName, state, population: pop2024 });
      const key = `${normKey(cand.lga)}|${normKey(cand.state)}`;
      if (!byKey.has(key)) byKey.set(key, cand);
    }
  }

  for (const x of EXTRA_LGAS) {
    const cand = makeCandidate(x);
    const key = `${normKey(cand.lga)}|${normKey(cand.state)}`;
    if (!byKey.has(key)) byKey.set(key, cand);
  }

  const out = Array.from(byKey.values());
  out.sort((a, b) => a.label.localeCompare(b.label, "en"));

  fs.mkdirSync(path.dirname(OUT_PUBLIC), { recursive: true });
  fs.writeFileSync(OUT_PUBLIC, JSON.stringify(out, null, 2), "utf8");

  console.log(`Parsed sheets: ${targetSheets.join(", ")}`);
  console.log(`Found ${totalLgaRows} LGA rows, wrote ${out.length} unique options to ${OUT_PUBLIC}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

