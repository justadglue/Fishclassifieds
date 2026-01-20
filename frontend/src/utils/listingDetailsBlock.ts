export type PriceType = "each" | "all" | "custom" | "free" | "offer";

export type ListingSaleDetails = {
  quantity: number; // integer >= 1
  // Allow "" in the UI as an explicit "not selected yet" state.
  priceType: PriceType | "";
  customPriceText: string; // only meaningful when priceType === "custom"
  willingToShip: boolean;
};

const MAX_CUSTOM_PRICE_TEXT_LEN = 20;

const START = "[[FC_SALE_DETAILS]]";
const END = "[[/FC_SALE_DETAILS]]";

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function cleanInlineText(s: unknown, maxLen: number) {
  const t = String(s ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";
  return t.slice(0, maxLen);
}

export function buildSaleDetailsPrefix(input: Partial<ListingSaleDetails>): string {
  const quantity = clampInt(Number(input.quantity ?? 1), 1, 9999);
  const priceType =
    input.priceType === "each" ||
    input.priceType === "all" ||
    input.priceType === "custom" ||
    input.priceType === "free" ||
    input.priceType === "offer"
      ? input.priceType
      : "";
  const customPriceText = priceType === "custom" ? cleanInlineText(input.customPriceText, MAX_CUSTOM_PRICE_TEXT_LEN) : "";
  const willingToShip = Boolean(input.willingToShip);

  // Keep this compact: it counts towards the server-side description max length.
  return [
    START,
    `quantity=${quantity}`,
    // Always include the key so the backend can detect explicit non-selection ("").
    `priceType=${priceType}`,
    ...(priceType === "custom" && customPriceText ? [`customPriceText=${customPriceText}`] : []),
    `willingToShip=${willingToShip ? 1 : 0}`,
    END,
    "", // blank line separating prefix from body
    "", // (ensures \n\n)
  ].join("\n");
}

export function encodeSaleDetailsIntoDescription(details: Partial<ListingSaleDetails>, body: string): string {
  const prefix = buildSaleDetailsPrefix(details);
  const cleanedBody = String(body ?? "").trim();
  return `${prefix}${cleanedBody ? cleanedBody : ""}`.trim();
}

export function decodeSaleDetailsFromDescription(description: string): {
  details: ListingSaleDetails;
  body: string;
  hadPrefix: boolean;
} {
  const raw = String(description ?? "");
  const startIdx = raw.indexOf(START);
  const endIdx = raw.indexOf(END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return {
      details: { quantity: 1, priceType: "each", customPriceText: "", willingToShip: false },
      body: raw,
      hadPrefix: false,
    };
  }

  const afterEnd = endIdx + END.length;
  const block = raw.slice(startIdx, afterEnd);
  const after = raw.slice(afterEnd);

  let quantity = 1;
  let priceType: PriceType | "" = "each";
  let sawPriceTypeKey = false;
  let customPriceText = "";
  let willingToShip = false;

  for (const line of block.split("\n")) {
    const t = line.trim();
    if (!t || t === START || t === END) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();

    if (k === "quantity") quantity = clampInt(Number(v), 1, 9999);
    else if (k === "priceType") {
      sawPriceTypeKey = true;
      if (v === "each" || v === "all" || v === "custom" || v === "free" || v === "offer") priceType = v;
      else priceType = "";
    }
    else if (k === "customPriceText") customPriceText = cleanInlineText(v, MAX_CUSTOM_PRICE_TEXT_LEN);
    else if (k === "willingToShip") willingToShip = v === "1" || v.toLowerCase() === "true";
  }

  if (priceType !== "custom") customPriceText = "";
  // Back-compat: older prefixes might omit the key entirely.
  if (!sawPriceTypeKey) priceType = "each";

  // Remove leading blank lines after the prefix.
  const body = after.replace(/^\s*\n/, "").replace(/^\s*\n/, "").trim();

  return {
    details: { quantity, priceType, customPriceText, willingToShip },
    body,
    hadPrefix: true,
  };
}

export type WantedPriceDetails = {
  // Allow "" in the UI as an explicit "not selected yet" state.
  priceType: PriceType | "";
  customPriceText: string; // only meaningful when priceType === "custom"
};

const WANTED_START = "[[FC_WANTED_DETAILS]]";
const WANTED_END = "[[/FC_WANTED_DETAILS]]";

export function buildWantedDetailsPrefix(input: Partial<WantedPriceDetails>): string {
  const priceType =
    input.priceType === "each" || input.priceType === "all" || input.priceType === "custom" ? input.priceType : "";
  const customPriceText = priceType === "custom" ? cleanInlineText(input.customPriceText, MAX_CUSTOM_PRICE_TEXT_LEN) : "";

  // Keep this compact: it counts towards the server-side description max length.
  return [
    WANTED_START,
    `priceType=${priceType}`,
    ...(priceType === "custom" && customPriceText ? [`customPriceText=${customPriceText}`] : []),
    WANTED_END,
    "", // blank line separating prefix from body
    "", // (ensures \n\n)
  ].join("\n");
}

export function encodeWantedDetailsIntoDescription(details: Partial<WantedPriceDetails>, body: string): string {
  const prefix = buildWantedDetailsPrefix(details);
  const cleanedBody = String(body ?? "").trim();
  return `${prefix}${cleanedBody ? cleanedBody : ""}`.trim();
}

export function decodeWantedDetailsFromDescription(description: string): {
  details: WantedPriceDetails;
  body: string;
  hadPrefix: boolean;
} {
  const raw = String(description ?? "");
  const startIdx = raw.indexOf(WANTED_START);
  const endIdx = raw.indexOf(WANTED_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return {
      details: { priceType: "each", customPriceText: "" },
      body: raw,
      hadPrefix: false,
    };
  }

  const afterEnd = endIdx + WANTED_END.length;
  const block = raw.slice(startIdx, afterEnd);
  const after = raw.slice(afterEnd);

  let priceType: PriceType | "" = "each";
  let sawPriceTypeKey = false;
  let customPriceText = "";

  for (const line of block.split("\n")) {
    const t = line.trim();
    if (!t || t === WANTED_START || t === WANTED_END) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();

    if (k === "priceType") {
      sawPriceTypeKey = true;
      if (v === "each" || v === "all" || v === "custom") priceType = v;
      else priceType = "";
    }
    else if (k === "customPriceText") customPriceText = cleanInlineText(v, MAX_CUSTOM_PRICE_TEXT_LEN);
  }

  if (priceType !== "custom") customPriceText = "";
  if (!sawPriceTypeKey) priceType = "each";

  // Remove leading blank lines after the prefix.
  const body = after.replace(/^\s*\n/, "").replace(/^\s*\n/, "").trim();

  return {
    details: { priceType, customPriceText },
    body,
    hadPrefix: true,
  };
}
