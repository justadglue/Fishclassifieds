#!/usr/bin/env node
/**
 * scripts/selective_dump.mjs
 *
 * Selectively dumps only relevant repo files for an LLM prompt.
 *
 * Modes:
 *  - Heuristic selection (default): keyword hits + path weights + import dependency expansion.
 *  - LLM-driven selection (optional): builds a repo map, asks model to choose files, then expands deps.
 *
 * Output format:
 *   @@@relative\path
 *   <content>
 *
 * Usage examples:
 *   node scripts/selective_dump.mjs --prompt "Fix listing status transitions" --out project_dump_selected.txt
 *   node scripts/selective_dump.mjs --prompt "Implement mark as sold button" --useLLM --model gpt-5.1-chat-latest
 *   node scripts/selective_dump.mjs --prompt "Refactor upload pipeline" --budgetFiles 30 --depDepth 2 --redact
 *
 * Env:
 *   OPENAI_API_KEY required if --useLLM
 */

import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { spawnSync } from "child_process";

const DEFAULT_EXCLUDE_DIRS = [
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".vite",
  ".next",
  ".cache",
  "out",
  "tmp",
  "temp",
  "logs",
  path.join("backend", "data", "uploads"),
  path.join("backend", "data"),
];

const DEFAULT_EXCLUDE_FILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  ".ds_store",
  "thumbs.db",
  "app.db",
  "app.db-wal",
  "app.db-shm",
]);

const DEFAULT_BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico",
  ".zip", ".7z", ".rar", ".tar", ".gz", ".bz2",
  ".exe", ".dll", ".pdb", ".so", ".dylib",
  ".pdf", ".woff", ".woff2", ".ttf", ".otf",
  ".mp4", ".mov", ".avi", ".mkv", ".mp3", ".wav",
  ".db", ".sqlite", ".sqlite3", ".db-wal", ".db-shm",
  ".map",
]);

const TEXT_EXTS = new Set([
  ".txt", ".md", ".markdown", ".json", ".jsonc", ".yaml", ".yml",
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".css", ".scss", ".less", ".html", ".htm",
  ".env", ".example",
  ".sql",
  ".ps1", ".psm1", ".psd1",
  ".gitignore", ".gitattributes",
  ".editorconfig",
  ".toml", ".ini", ".cfg",
  ".sh", ".bash", ".zsh",
  ".java", ".kt", ".go", ".rs", ".py", ".cpp", ".c", ".h",
]);

const ALWAYS_INCLUDE_BASICS = [
  "package.json",
  "tsconfig.json",
  "tsconfig.base.json",
  "tsconfig.app.json",
  "tsconfig.node.json",
  "vite.config.ts",
  "vite.config.js",
  "tailwind.config.ts",
  "tailwind.config.js",
  "postcss.config.js",
  "postcss.config.cjs",
  "eslint.config.js",
  ".eslintrc",
  ".eslintrc.json",
  ".prettierrc",
  ".prettierrc.json",
  "readme.md",
  ".env.example",
];

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    root: process.cwd(),
    out: path.join(process.cwd(), "project_dump_selected.txt"),
    prompt: "",
    budgetFiles: 25,
    depDepth: 1,
    mode: "basic", // basic | extended (affects max bytes)
    ultraMinify: true,
    redact: false,
    useLLM: false,
    loadDotenv: false,
    model: "gpt-5.2-chat-latest",
    llmMaxRepoMapFiles: 2500, // cap for map generation
    llmMaxSelectedFiles: 60,  // hard cap request to model
    llmReasoningEffort: "medium",
    quiet: false,
  };

  const it = argv[Symbol.iterator]();
  for (const a of it) {
    if (a === "--root") args.root = String(it.next().value ?? "");
    else if (a === "--out") args.out = String(it.next().value ?? "");
    else if (a === "--prompt") args.prompt = String(it.next().value ?? "");
    else if (a === "--budgetFiles") args.budgetFiles = parseInt(String(it.next().value ?? "25"), 10);
    else if (a === "--depDepth") args.depDepth = parseInt(String(it.next().value ?? "1"), 10);
    else if (a === "--mode") args.mode = String(it.next().value ?? "basic").toLowerCase();
    else if (a === "--noUltraMinify") args.ultraMinify = false;
    else if (a === "--redact") args.redact = true;
    else if (a === "--useLLM") args.useLLM = true;
    else if (a === "--loadDotenv") args.loadDotenv = true;
    else if (a === "--model") args.model = String(it.next().value ?? args.model);
    else if (a === "--quiet") args.quiet = true;
    else if (a === "--help" || a === "-h") {
      printHelpAndExit();
    } else if (a && a.startsWith("--")) {
      die(`Unknown arg: ${a}`);
    }
  }

  if (!args.prompt || !args.prompt.trim()) {
    die(`Missing required --prompt "..."`);
  }
  if (!["basic", "extended"].includes(args.mode)) {
    die(`--mode must be "basic" or "extended"`);
  }
  if (!Number.isFinite(args.budgetFiles) || args.budgetFiles < 1) die(`--budgetFiles must be >= 1`);
  if (!Number.isFinite(args.depDepth) || args.depDepth < 0) die(`--depDepth must be >= 0`);

  args.root = path.resolve(args.root);
  args.out = path.resolve(args.out);

  return args;
}

function printHelpAndExit() {
  console.log(`
Selective repo dump tool

Required:
  --prompt "..."              The task you want the model to solve

Optional:
  --root <path>               Repo root (default: cwd)
  --out <path>                Output file (default: project_dump_selected.txt)
  --budgetFiles <n>            Target number of primary files (default: 25)
  --depDepth <n>               Import dependency expansion depth (default: 1)
  --mode basic|extended        Max per-file bytes (basic=512KB, extended=2MB)
  --noUltraMinify              Keep original whitespace/comments
  --redact                     Apply basic redaction (Bearer + PEM + env secrets)
  --useLLM                     Use LLM-driven selection (requires OPENAI_API_KEY)
  --model <name>               Model for selection (default: gpt-5.1-chat-latest)
  --quiet                      Reduce logging
  --loadDotenv                 Load scripts/.env into process.env (does not affect dumping; .env still excluded)

Examples:
  node scripts/selective_dump.mjs --prompt "Fix listing status transitions"
  node scripts/selective_dump.mjs --prompt "Add Mark as Sold button" --useLLM --depDepth 2 --budgetFiles 35 --redact
`.trim());
  process.exit(0);
}

function normalizeSlashes(p) {
  return p.replace(/\//g, "\\");
}

function relPath(fullPath, root) {
  const rel = path.relative(root, fullPath);
  return normalizeSlashes(rel);
}

function getExtLower(p) {
  return path.extname(p).toLowerCase();
}

function isBinaryByExt(fullPathOrRel) {
  const ext = getExtLower(fullPathOrRel);
  return DEFAULT_BINARY_EXTS.has(ext);
}

function isTextExt(fullPathOrRel) {
  const ext = getExtLower(fullPathOrRel);
  if (!ext) return true; // allow extensionless (like .gitignore)
  if (TEXT_EXTS.has(ext)) return true;
  return false;
}

function shouldSkip(rel) {
  const lower = rel.toLowerCase();

  for (const d of DEFAULT_EXCLUDE_DIRS) {
    const dl = normalizeSlashes(d).toLowerCase();
    if (lower.includes(dl + "\\")) return true;
    if (lower.startsWith(dl + "\\")) return true;
  }

  const base = path.win32.basename(rel).toLowerCase();

  // Never dump real env files (they often contain secrets). Keep .env.example.
  if ((base === ".env" || base.startsWith(".env.")) && base !== ".env.example") {
    return true;
  }

  if (DEFAULT_EXCLUDE_FILES.has(base)) return true;

  if (isBinaryByExt(rel)) return true;

  return false;
}

function safeReadText(fullPath) {
  // Try UTF-8 first, then fall back to system default
  try {
    return fs.readFileSync(fullPath, { encoding: "utf8" });
  } catch {
    try {
      return fs.readFileSync(fullPath, { encoding: "latin1" });
    } catch {
      return "";
    }
  }
}

function normalizeNewlines(s) {
  return (s ?? "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function tryMinifyJson(text) {
  const t = normalizeNewlines(text).trim();
  if (!t) return null;
  try {
    return JSON.stringify(JSON.parse(t));
  } catch {
    return null;
  }
}

function ultraMinifyText(text, rel) {
  const ext = getExtLower(rel);
  let t = normalizeNewlines(text);

  if (ext === ".json") {
    const m = tryMinifyJson(t);
    if (m !== null) return m;
  }

  // Remove block comments for common file types (dump-only)
  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".scss", ".less", ".c", ".cpp", ".h", ".java", ".kt", ".go", ".rs"].includes(ext)) {
    t = t.replace(/\/\*[\s\S]*?\*\//g, "");
  }
  if ([".ps1", ".psm1", ".psd1"].includes(ext)) {
    t = t.replace(/<#([\s\S]*?)#>/g, "");
  }
  if ([".html", ".htm", ".md", ".markdown"].includes(ext)) {
    t = t.replace(/<!--[\s\S]*?-->/g, "");
  }

  const lines = t.split("\n");
  const out = [];
  const isMarkdownLike = [".md", ".markdown", ".txt"].includes(ext);

  for (let line of lines) {
    // Drop whole-line comments (language aware)
    if ([".ps1", ".psm1", ".psd1"].includes(ext)) {
      if (/^\s*#/.test(line)) continue;
    } else if (ext === ".sql") {
      if (/^\s*--/.test(line)) continue;
    } else if ([".yaml", ".yml", ".toml", ".ini", ".cfg"].includes(ext)) {
      if (/^\s*#/.test(line)) continue;
    } else if (!isMarkdownLike) {
      if (/^\s*\/\//.test(line)) continue;
    }

    line = line.trim();
    if (!line) continue;

    // Conservative inline comment stripping for a few formats
    if (ext === ".sql") {
      line = line.replace(/\s+--.*$/, "").trim();
      if (!line) continue;
    } else if ([".ps1", ".psm1", ".psd1"].includes(ext)) {
      line = line.replace(/\s+#.*$/, "").trim();
      if (!line) continue;
    } else if ([".yaml", ".yml", ".toml", ".ini", ".cfg"].includes(ext)) {
      line = line.replace(/\s+#.*$/, "").trim();
      if (!line) continue;
    } else if (ext === ".py") {
      // Only strip " # ..." if there are no quotes before '#'
      if (!/["']/.test(line)) {
        line = line.replace(/\s+#.*$/, "").trim();
        if (!line) continue;
      }
    }

    // IMPORTANT: do NOT collapse internal whitespace and do NOT tighten punctuation spacing.
    out.push(line);
  }

  return out.join("\n");
}

// --- Redaction (basic, conservative) ---
function looksCredentialLike(value) {
  const v = (value ?? "").trim();
  if (v.length < 16) return false;
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v)) return true; // JWT-ish
  if (/^(sk-|rk-|pk-|api_|key_)[A-Za-z0-9_\-]{10,}$/i.test(v)) return true;
  if (v.length >= 32 && !/\s/.test(v)) {
    if (/^[A-Fa-f0-9]{32,}$/.test(v)) return true;
    if (/^[A-Za-z0-9+/=]{32,}$/.test(v)) return true;
    if (/^[A-Za-z0-9_-]{32,}$/.test(v)) return true;
  }
  return false;
}

function isEnvFile(rel) {
  const base = path.win32.basename(rel).toLowerCase();
  return base === ".env" || base.startsWith(".env.");
}

function applyRedactions(text, rel) {
  let t = text ?? "";
  if (!t) return "";

  // Authorization Bearer
  t = t.replace(/(authorization\s*:\s*bearer\s+)([^\r\n\s]+)/gi, "$1<REDACTED>");

  // PEM private key blocks
  t = t.replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA )?PRIVATE KEY-----/g, "-----BEGIN PRIVATE KEY-----<REDACTED>-----END PRIVATE KEY-----");

  // env var secrets ONLY in env files
  if (isEnvFile(rel)) {
    t = t.replace(/^(\s*(?:[A-Z0-9]+_)*(?:API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|CLIENT_SECRET)(?:_[A-Z0-9]+)*\s*=\s*)([^\r\n#]+)/gim, "$1<REDACTED>");
  }

  // quoted keys: only if value looks credential-like
  const patterns = [
    /(api[_-]?key)\s*[:=]\s*(["'])([^"'\r\n]+)\2/gi,
    /(password)\s*[:=]\s*(["'])([^"'\r\n]+)\2/gi,
    /((?:client[_-]?secret|secret))\s*[:=]\s*(["'])([^"'\r\n]+)\2/gi,
    /((?:access[_-]?token|refresh[_-]?token|token))\s*[:=]\s*(["'])([^"'\r\n]+)\2/gi,
  ];

  for (const re of patterns) {
    t = t.replace(re, (m, key, q, val) => {
      if (looksCredentialLike(val)) {
        return `${key}=${q}<REDACTED>${q}`;
      }
      return m;
    });
  }

  return t;
}

function walkFiles(root) {
  const out = [];
  const stack = [root];

  while (stack.length) {
    const dir = stack.pop();
    let ents = [];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const ent of ents) {
      const full = path.join(dir, ent.name);
      const rel = relPath(full, root);

      if (ent.isDirectory()) {
        if (shouldSkip(rel + "\\")) continue;
        stack.push(full);
        continue;
      }
      if (!ent.isFile()) continue;

      if (shouldSkip(rel)) continue;
      if (!isTextExt(rel)) continue;

      out.push({ full, rel });
    }
  }

  out.sort((a, b) => a.rel.localeCompare(b.rel));
  return out;
}

function maxBytesForMode(mode) {
  return mode === "extended" ? 2 * 1024 * 1024 : 512 * 1024;
}

function fileSizeSafe(full) {
  try {
    return fs.statSync(full).size;
  } catch {
    return 0;
  }
}

function pickAlwaysInclude(files) {
  const set = new Set();
  const relToFull = new Map(files.map(f => [f.rel.toLowerCase(), f.full]));

  for (const name of ALWAYS_INCLUDE_BASICS) {
    const lower = normalizeSlashes(name).toLowerCase();
    if (relToFull.has(lower)) set.add(lower);
  }

  // also include backend/src entrypoint if present
  for (const candidate of ["backend\\src\\server.ts", "backend\\src\\server.js", "backend\\src\\index.ts", "backend\\src\\index.js"]) {
    const k = candidate.toLowerCase();
    if (relToFull.has(k)) set.add(k);
  }

  // include likely db file(s)
  for (const candidate of ["backend\\src\\db.ts", "backend\\src\\db.js", "backend\\src\\database.ts", "backend\\src\\database.js"]) {
    const k = candidate.toLowerCase();
    if (relToFull.has(k)) set.add(k);
  }

  return set;
}

function extractPromptTerms(prompt) {
  // Simple term extraction: words, plus a few bigrams-like tokens
  const raw = (prompt ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_\- ]+/g, " ")
    .split(/\s+/)
    .filter(w => w && w.length >= 3);

  const stop = new Set(["with", "from", "that", "this", "then", "into", "your", "what", "when", "where", "how", "fix", "add", "make"]);
  const words = raw.filter(w => !stop.has(w));

  const uniq = Array.from(new Set(words)).slice(0, 24);
  return uniq;
}

function rgAvailable() {
  const r = spawnSync(process.platform === "win32" ? "rg.exe" : "rg", ["--version"], { stdio: "ignore" });
  return r.status === 0;
}

function scoreFilesHeuristic(files, root, prompt) {
  const terms = extractPromptTerms(prompt);
  const scores = new Map(); // relLower -> score
  const relLowerToFull = new Map(files.map(f => [f.rel.toLowerCase(), f.full]));

  function bump(relLower, s) {
    scores.set(relLower, (scores.get(relLower) ?? 0) + s);
  }

  // Path priors
  for (const f of files) {
    const relL = f.rel.toLowerCase();
    if (relL.startsWith("backend\\src\\")) bump(relL, 2);
    if (relL.startsWith("frontend\\src\\")) bump(relL, 2);
    if (relL.includes("\\routes\\") || relL.includes("\\route")) bump(relL, 3);
    if (relL.includes("\\db") || relL.includes("schema") || relL.includes("migrat")) bump(relL, 3);
    if (relL.includes("\\pages\\") || relL.includes("\\components\\")) bump(relL, 2);
    if (relL.includes("listing")) bump(relL, 2);
    if (relL.includes("status") || relL.includes("sold") || relL.includes("pause")) bump(relL, 1);
  }

  // Keyword search
  const useRg = rgAvailable();

  if (useRg && terms.length) {
    // Build ripgrep pattern list: search each term and accumulate hit counts per file
    for (const term of terms) {
      const r = spawnSync(process.platform === "win32" ? "rg.exe" : "rg", [
        "--no-heading",
        "--line-number",
        "--hidden",
        "--follow",
        "--glob", "!**/.git/**",
        "--glob", "!**/node_modules/**",
        term,
        root
      ], { encoding: "utf8" });

      if (r.status !== 0 && r.status !== 1) continue; // 1 = no matches
      const out = r.stdout ?? "";
      if (!out) continue;

      // rg output: file:line:match
      const lines = out.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const idx = line.indexOf(":");
        if (idx <= 0) continue;
        const file = line.slice(0, idx);
        const rel = relPath(file, root).toLowerCase();
        if (!relLowerToFull.has(rel)) continue;
        bump(rel, 1.0);
      }
    }
  } else {
    // fallback: naive scan small-ish files
    const maxScanBytes = 300 * 1024; // keep it reasonable
    for (const f of files) {
      const size = fileSizeSafe(f.full);
      if (size > maxScanBytes) continue;
      const text = (safeReadText(f.full) ?? "").toLowerCase();
      if (!text) continue;

      let hits = 0;
      for (const term of terms) {
        if (text.includes(term)) hits += 1;
      }
      if (hits > 0) bump(f.rel.toLowerCase(), hits);
    }
  }

  // Return ranked list
  const ranked = Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([relLower, score]) => ({ relLower, score }));

  return { ranked, terms };
}

function parseImports(text, rel) {
  const ext = getExtLower(rel);
  if (![".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) return [];

  const t = normalizeNewlines(text);

  const imports = new Set();

  // import ... from "..."
  for (const m of t.matchAll(/import\s+[\s\S]*?\sfrom\s+["']([^"']+)["']/g)) {
    imports.add(m[1]);
  }
  // import("...")
  for (const m of t.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) {
    imports.add(m[1]);
  }
  // require("...") (in case)
  for (const m of t.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) {
    imports.add(m[1]);
  }

  return Array.from(imports);
}

function resolveImport(fromRel, spec, existingRelSetLower) {
  // Only resolve relative imports
  if (!spec.startsWith(".")) return null;

  const fromDir = path.win32.dirname(fromRel);
  let base = path.win32.normalize(path.win32.join(fromDir, normalizeSlashes(spec)));

  const candidates = [];

  // If spec already ends with extension, try directly
  const ext = path.win32.extname(base);
  if (ext) {
    candidates.push(base);
  } else {
    // Try common extensions
    const exts = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"];
    for (const e of exts) candidates.push(base + e);
    // Try index files
    for (const e of exts) candidates.push(path.win32.join(base, "index" + e));
  }

  for (const c of candidates) {
    const key = c.toLowerCase();
    if (existingRelSetLower.has(key)) return key;
  }

  return null;
}

function expandDependencies(seedRelLowers, relLowerToFull, depDepth, maxBytes) {
  const all = new Set(seedRelLowers);
  const existingRelSet = new Set(relLowerToFull.keys());

  let frontier = Array.from(seedRelLowers);

  for (let d = 0; d < depDepth; d++) {
    const next = [];
    for (const relLower of frontier) {
      const full = relLowerToFull.get(relLower);
      if (!full) continue;

      const size = fileSizeSafe(full);
      if (size > maxBytes) continue; // skip huge

      const text = safeReadText(full);
      if (!text) continue;

      const specs = parseImports(text, relLower);
      for (const spec of specs) {
        const resolved = resolveImport(relLower, spec, existingRelSet);
        if (resolved && !all.has(resolved)) {
          all.add(resolved);
          next.push(resolved);
        }
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }

  return all;
}

function buildRepoMap(files, root, maxBytes, maxFilesForMap) {
  // Compact map: path + size + small signature + extracted exports/keywords hints
  // Keep it strictly bounded
  const list = [];

  const capped = files.slice(0, maxFilesForMap);

  for (const f of capped) {
    const size = fileSizeSafe(f.full);
    if (size > maxBytes) continue;

    const ext = getExtLower(f.rel);
    const entry = {
      path: f.rel,
      size,
      ext,
      hints: "",
      digest: "",
    };

    // Read only small prefix for hints
    const raw = safeReadText(f.full);
    const t = normalizeNewlines(raw);
    const prefix = t.slice(0, 6000);

    // Basic symbol hints for TS/JS
    if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
      const exports = [];
      for (const m of prefix.matchAll(/export\s+(?:default\s+)?(?:function|class|const|let|var)\s+([A-Za-z0-9_]+)/g)) {
        exports.push(m[1]);
        if (exports.length >= 12) break;
      }
      const routes = [];
      for (const m of prefix.matchAll(/\b(app|router)\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g)) {
        routes.push(`${m[2].toUpperCase()} ${m[3]}`);
        if (routes.length >= 8) break;
      }
      const zods = [];
      for (const m of prefix.matchAll(/\bz\.object\s*\(|\bz\.enum\s*\(/g)) {
        zods.push("zod");
        if (zods.length >= 4) break;
      }

      const hintParts = [];
      if (exports.length) hintParts.push(`exports:${exports.join(",")}`);
      if (routes.length) hintParts.push(`routes:${routes.join(" | ")}`);
      if (zods.length) hintParts.push(`schemas:${zods.length}`);

      entry.hints = hintParts.join(" ; ");
    } else if (ext === ".sql") {
      const tables = [];
      for (const m of prefix.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?([A-Za-z0-9_]+)/gi)) {
        tables.push(m[1]);
        if (tables.length >= 10) break;
      }
      if (tables.length) entry.hints = `tables:${tables.join(",")}`;
    }

    entry.digest = crypto.createHash("sha1").update(prefix).digest("hex").slice(0, 10);

    list.push(entry);
  }

  return {
    root,
    files: list,
    note: "This is a compact repo map. Paths are relative; hints are partial; do not assume missing content implies absence.",
  };
}

async function llmSelectFiles({ prompt, repoMap, model, llmMaxSelectedFiles, reasoningEffort }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) die("OPENAI_API_KEY is required when --useLLM is set.");

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey });

  const instructions =
    "You are selecting a minimal set of repository files needed to answer the user's request. " +
    "Choose the smallest set that allows correct code edits across the stack. " +
    "Prefer source files over generated artifacts. " +
    "Always include entrypoints, route handlers, DB/schema, and any UI pages involved.\n\n" +

    "Classify issues carefully:\n" +
    "- Put ONLY blocking problems in `errors` (things that make correct implementation impossible without user input).\n" +
    "- Put optional clarifications or preferences in `suggestions`.\n" +
    "- If there are no blocking problems, return an empty `errors` array.\n\n" +

    "Return JSON only, matching the schema exactly.";


  const jsonSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      selected: {
        type: "array",
        minItems: 1,
        maxItems: llmMaxSelectedFiles,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            path: { type: "string" },
            reason: { type: "string" },
            priority: { type: "integer", minimum: 1, maximum: 5 },
          },
          required: ["path", "reason", "priority"],
        },
      },

      // BLOCKING issues: missing info that prevents correct implementation
      errors: {
        type: "array",
        items: { type: "string" },
      },

      // NON-blocking clarifications / preferences
      suggestions: {
        type: "array",
        items: { type: "string" },
      },

      notes: { type: "string" },
    },

    // When strict=true, required MUST include all keys
    required: ["selected", "errors", "suggestions", "notes"],
  };

  const effort = (String(reasoningEffort || "medium").toLowerCase() === "high") ? "medium" : String(reasoningEffort || "medium").toLowerCase();

  const resp = await client.responses.create({
    model,
    reasoning: { effort },
    instructions,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: `User request:\n${prompt}` },
          { type: "input_text", text: `Repo map JSON:\n${JSON.stringify(repoMap)}` },
          { type: "input_text", text: "Task: select the minimal set of file paths from the repo map needed to do the request." },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "file_selection",
        schema: jsonSchema,
        strict: true,
      },
    },
  });

  const outText = (resp.output_text ?? "").trim();
  if (!outText) die("LLM returned empty selection output.");

  let parsed;
  try {
    parsed = JSON.parse(outText);
  } catch (e) {
    die(`LLM selection JSON parse failed: ${e?.message ?? String(e)}\nRaw:\n${outText}`);
  }

  const paths = (parsed.selected ?? []).map(x => String(x.path ?? "")).filter(Boolean);
  if (!paths.length) die("LLM selection returned no paths.");

  return { parsed, paths };
}

function coerceSelectedPathsToRepo(pathsFromLLM, relLowerToFull) {
  // LLM might return forward slashes or different casing.
  // We normalize to Windows-style slashes and lower-case match against known set.
  const known = new Set(relLowerToFull.keys());
  const out = new Set();

  for (const p of pathsFromLLM) {
    const norm = normalizeSlashes(p).replace(/^\.\\/, "").replace(/^\.\//, "");
    const lower = norm.toLowerCase();

    if (known.has(lower)) {
      out.add(lower);
      continue;
    }

    // Try fuzzy: if they gave just filename, pick best match (shortest path)
    const base = path.win32.basename(lower);
    const matches = [];
    for (const k of known) {
      if (path.win32.basename(k) === base) matches.push(k);
    }
    if (matches.length) {
      matches.sort((a, b) => a.length - b.length);
      out.add(matches[0]);
    }
  }

  return out;
}

function buildMetaHeader(args, selectedRelLowers, alwaysRelLowers, useLLM, llmNotes) {
  const lines = [];
  lines.push("META: Selective repo dump (relevance-filtered).");
  lines.push("META: DELIMITER: each file starts with '@@@<relative-path>' and continues until next '@@@' or EOF.");
  lines.push(`META: Prompt: ${args.prompt.replace(/\r?\n/g, " ").trim()}`);
  lines.push(`META: Root: ${args.root}`);
  lines.push(`META: Mode=${args.mode}; UltraMinify=${args.ultraMinify}; Redact=${args.redact}; depDepth=${args.depDepth}; budgetFiles=${args.budgetFiles}; useLLM=${useLLM}`);
  lines.push(`META: Included files: ${selectedRelLowers.size} (includes dependency expansion + always-include set).`);
  lines.push("META: Do NOT assume missing files indicate they do not exist; this dump is intentionally filtered for relevance.");
  lines.push("META: Only request additional files if necessary to answer the prompt or generate correct drop-in code, and specify exactly which files and why.");
  if (alwaysRelLowers && alwaysRelLowers.size) {
    lines.push(`META: Always-include policy added ${alwaysRelLowers.size} baseline files (configs/entrypoints).`);
  }
  if (useLLM) {
    lines.push("META: LLM-driven file selection was ENABLED and may omit stylistic/irrelevant files by design.");
    if (llmNotes) lines.push(`META: LLM notes: ${llmNotes.replace(/\r?\n/g, " ").trim()}`);
  } else {
    lines.push("META: LLM-driven file selection was DISABLED; selection used heuristic scoring + dependency expansion.");
  }
  lines.push("===== BEGIN FILES =====");
  return lines.join("\n");
}

function writeDump({ outPath, root, selectedRelLowers, relLowerToFull, args }) {
  const maxBytes = maxBytesForMode(args.mode);
  const outDir = path.dirname(outPath);
  fs.mkdirSync(outDir, { recursive: true });

  const lines = [];
  for (const relLower of selectedRelLowers) {
    const full = relLowerToFull.get(relLower);
    if (!full) continue;

    const size = fileSizeSafe(full);
    if (size > maxBytes) continue;

    let content = safeReadText(full);
    if (args.ultraMinify) content = ultraMinifyText(content, relLower);
    if (args.redact) content = applyRedactions(content, relLower);

    lines.push(`@@@${normalizeSlashes(relLower)}`);
    if (content && content.trim()) {
      lines.push(content.trim());
    }
  }

  lines.push("===== END FILES =====");

  fs.writeFileSync(outPath, lines.join("\n") + "\n", { encoding: "utf8" });
}

function uniqPreserve(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.loadDotenv) {
    const dotenvPath = path.join(args.root, "scripts", ".env");
    try {
      const { config } = await import("dotenv");
      config({ path: dotenvPath });
    } catch {
      // ignore if dotenv isn't installed or file doesn't exist
    }
  } 

  if (!args.quiet) {
    console.log(`Root: ${args.root}`);
    console.log(`Out:  ${args.out}`);
    console.log(`Mode: ${args.mode}`);
    console.log(`Flags: ultraMinify=${args.ultraMinify} redact=${args.redact} useLLM=${args.useLLM}`);
  }

  if (!fs.existsSync(args.root) || !fs.statSync(args.root).isDirectory()) {
    die(`Root path does not exist or is not a directory: ${args.root}`);
  }

  const allFiles = walkFiles(args.root);
  if (!allFiles.length) die("No files found to dump.");

  const maxBytes = maxBytesForMode(args.mode);

  // filter by max bytes early for scoring/map
  const eligible = allFiles.filter(f => fileSizeSafe(f.full) <= maxBytes);

  const relLowerToFull = new Map(eligible.map(f => [f.rel.toLowerCase(), f.full]));

  const always = pickAlwaysInclude(eligible); // set of relLower
  const selectedSeed = new Set(always);

  let llmNotes = "";

  if (args.useLLM) {
    // Build compact map, ask model to pick files
    const repoMap = buildRepoMap(eligible, args.root, maxBytes, args.llmMaxRepoMapFiles);

    const { parsed, paths } = await llmSelectFiles({
      prompt: args.prompt,
      repoMap,
      model: args.model,
      llmMaxSelectedFiles: args.llmMaxSelectedFiles,
      reasoningEffort: args.llmReasoningEffort,
    });

    const errors = Array.isArray(parsed.errors) ? parsed.errors : [];
    const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];


    llmNotes = parsed?.notes ?? "";

    const chosen = coerceSelectedPathsToRepo(paths, relLowerToFull);
    for (const k of chosen) selectedSeed.add(k);

    if (!args.quiet) {
        if (errors.length) {
            console.log("LLM reported BLOCKING ERRORS:");
            for (const e of errors) console.log(e);
        }

        if (suggestions.length) {
            console.log("LLM suggestions / clarifications:");
            for (const s of suggestions) console.log('- ' + s);
        }
    }

  } else {
    // Heuristic scoring: take top budgetFiles as primary seeds (plus always)
    const { ranked, terms } = scoreFilesHeuristic(eligible, args.root, args.prompt);
    if (!args.quiet) {
      console.log(`Heuristic terms: ${terms.join(", ") || "(none)"}`);
    }

    const top = ranked.slice(0, args.budgetFiles).map(x => x.relLower);
    for (const k of top) selectedSeed.add(k);
  }

  // Dependency expansion
  const expanded = expandDependencies(selectedSeed, relLowerToFull, args.depDepth, maxBytes);

  // If we overshot too hard, trim by preference (keep always, then shortest paths)
  // Note: dependency expansion can exceed budget; this trimming is a safety valve.
  const alwaysArr = Array.from(always);
  const rest = Array.from(expanded).filter(x => !always.has(x));
  rest.sort((a, b) => a.length - b.length);

  const hardCap = Math.max(args.budgetFiles * 3, args.budgetFiles + 25); // reasonable bound
  const final = new Set();
  for (const k of alwaysArr) final.add(k);
  for (const k of rest) {
    if (final.size >= hardCap) break;
    final.add(k);
  }

  // Write output
  const meta = buildMetaHeader(args, final, always, args.useLLM, llmNotes);
  const outDir = path.dirname(args.out);
  fs.mkdirSync(outDir, { recursive: true });

  // We write meta header separately, then the @@@ blocks, then end marker
  // (keeps it simple and matches your dump format expectations)
  fs.writeFileSync(args.out, meta + "\n", { encoding: "utf8" });

  const tmpPath = path.join(os.tmpdir(), `selective_dump_${crypto.randomUUID?.() ?? crypto.randomBytes(8).toString("hex")}.txt`);
  writeDump({
    outPath: tmpPath,
    root: args.root,
    selectedRelLowers: final,
    relLowerToFull,
    args,
  });

  const tail = fs.readFileSync(tmpPath, "utf8");
  fs.appendFileSync(args.out, "\n" + tail, { encoding: "utf8" });
  try { fs.unlinkSync(tmpPath); } catch {}

    if (!args.quiet) {
    const outStat = (() => {
      try {
        const st = fs.statSync(args.out);
        return ` (${st.size} bytes)`;
      } catch {
        return "";
      }
    })();

    console.log(`Wrote: ${args.out}${outStat}`);
    console.log(`Included: ${final.size} files (depDepth=${args.depDepth}, mode=${args.mode})`);
  }

}

main().catch(err => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
