import crypto from "crypto";

// Minimal AES-256-GCM secretbox for encrypting the site-wide LLM API key at rest.
// Requires env var: LLM_KEY_ENCRYPTION_SECRET (any non-empty string).
//
// Output format: "v1:<base64url(iv)>.<base64url(tag)>.<base64url(ciphertext)>"

function requireKey(): Buffer {
  const raw = String(process.env.LLM_KEY_ENCRYPTION_SECRET ?? "").trim();
  if (!raw) throw new Error("LLM_KEY_ENCRYPTION_SECRET is not set");
  return crypto.createHash("sha256").update(raw).digest(); // 32 bytes
}

export function encryptSecret(plaintext: string): string {
  const pt = String(plaintext ?? "");
  const key = requireKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(pt, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const enc = (b: Buffer) => b.toString("base64url");
  return `v1:${enc(iv)}.${enc(tag)}.${enc(ct)}`;
}

export function decryptSecret(token: string): string {
  const raw = String(token ?? "").trim();
  if (!raw) return "";
  if (!raw.startsWith("v1:")) throw new Error("Unsupported secret format");
  const rest = raw.slice("v1:".length);
  const parts = rest.split(".");
  if (parts.length !== 3) throw new Error("Invalid secret format");

  const [ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64!, "base64url");
  const tag = Buffer.from(tagB64!, "base64url");
  const ct = Buffer.from(ctB64!, "base64url");

  const key = requireKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

