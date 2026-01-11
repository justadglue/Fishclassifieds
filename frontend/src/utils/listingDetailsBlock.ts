export type PriceUnit = "each" | "pair" | "lot";

export type ListingSaleDetails = {
  quantity: number; // integer >= 1
  priceUnit: PriceUnit;
  willingToShip: boolean;
};

const START = "[[FC_SALE_DETAILS]]";
const END = "[[/FC_SALE_DETAILS]]";

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export function buildSaleDetailsPrefix(input: Partial<ListingSaleDetails>): string {
  const quantity = clampInt(Number(input.quantity ?? 1), 1, 9999);
  const priceUnit: PriceUnit = input.priceUnit === "pair" || input.priceUnit === "lot" ? input.priceUnit : "each";
  const willingToShip = Boolean(input.willingToShip);

  // Keep this compact: it counts towards the server-side description max length.
  return [
    START,
    `quantity=${quantity}`,
    `priceUnit=${priceUnit}`,
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
      details: { quantity: 1, priceUnit: "each", willingToShip: false },
      body: raw,
      hadPrefix: false,
    };
  }

  const afterEnd = endIdx + END.length;
  const block = raw.slice(startIdx, afterEnd);
  const after = raw.slice(afterEnd);

  let quantity = 1;
  let priceUnit: PriceUnit = "each";
  let willingToShip = false;

  for (const line of block.split("\n")) {
    const t = line.trim();
    if (!t || t === START || t === END) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();

    if (k === "quantity") quantity = clampInt(Number(v), 1, 9999);
    else if (k === "priceUnit" && (v === "each" || v === "pair" || v === "lot")) priceUnit = v;
    else if (k === "willingToShip") willingToShip = v === "1" || v.toLowerCase() === "true";
  }

  // Remove leading blank lines after the prefix.
  const body = after.replace(/^\s*\n/, "").replace(/^\s*\n/, "").trim();

  return {
    details: { quantity, priceUnit, willingToShip },
    body,
    hadPrefix: true,
  };
}

