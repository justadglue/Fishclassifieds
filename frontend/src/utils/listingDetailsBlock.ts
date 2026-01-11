export type PriceType = "each" | "all" | "custom";

export type ListingSaleDetails = {
  quantity: number; // integer >= 1
  priceType: PriceType;
  customPriceText: string; // only meaningful when priceType === "custom"
  willingToShip: boolean;
};

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
  const priceType: PriceType = input.priceType === "all" || input.priceType === "custom" ? input.priceType : "each";
  const customPriceText = priceType === "custom" ? cleanInlineText(input.customPriceText, 80) : "";
  const willingToShip = Boolean(input.willingToShip);

  // Keep this compact: it counts towards the server-side description max length.
  return [
    START,
    `quantity=${quantity}`,
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
  let priceType: PriceType = "each";
  let customPriceText = "";
  let willingToShip = false;
  let legacyPriceUnit: "each" | "pair" | "lot" | "" = "";

  for (const line of block.split("\n")) {
    const t = line.trim();
    if (!t || t === START || t === END) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();

    if (k === "quantity") quantity = clampInt(Number(v), 1, 9999);
    else if (k === "priceType" && (v === "each" || v === "all" || v === "custom")) priceType = v;
    else if (k === "customPriceText") customPriceText = cleanInlineText(v, 80);
    else if (k === "willingToShip") willingToShip = v === "1" || v.toLowerCase() === "true";
    else if (k === "priceUnit" && (v === "each" || v === "pair" || v === "lot")) legacyPriceUnit = v;
  }

  // Backwards compatibility: earlier versions stored priceUnit=each|pair|lot.
  if (!block.includes("priceType=") && legacyPriceUnit) {
    if (legacyPriceUnit === "each") {
      priceType = "each";
      customPriceText = "";
    } else if (legacyPriceUnit === "lot") {
      priceType = "all";
      customPriceText = "";
    } else {
      priceType = "custom";
      customPriceText = legacyPriceUnit; // "pair"
    }
  }

  if (priceType !== "custom") customPriceText = "";

  // Remove leading blank lines after the prefix.
  const body = after.replace(/^\s*\n/, "").replace(/^\s*\n/, "").trim();

  return {
    details: { quantity, priceType, customPriceText, willingToShip },
    body,
    hadPrefix: true,
  };
}

