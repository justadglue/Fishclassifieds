export type PriceType = "each" | "all" | "custom" | "free" | "offer";

export type ListingSaleDetails = {
    quantity: number; // integer >= 1
    // Allow "" as an explicit "not selected" sentinel (used by the UI).
    priceType: PriceType | "";
    customPriceText: string; // only meaningful when priceType === "custom"
    willingToShip: boolean;
};

const SALE_START = "[[FC_SALE_DETAILS]]";
const SALE_END = "[[/FC_SALE_DETAILS]]";
const WANTED_START = "[[FC_WANTED_DETAILS]]";
const WANTED_END = "[[/FC_WANTED_DETAILS]]";

function stripLeadingBlankLines(s: string) {
    return s.replace(/^\s*\n/, "").replace(/^\s*\n/, "");
}

export function decodeSaleBodyFromDescription(description: string): { body: string; hadPrefix: boolean } {
    const raw = String(description ?? "");
    const startIdx = raw.indexOf(SALE_START);
    const endIdx = raw.indexOf(SALE_END);
    if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
        return { body: raw, hadPrefix: false };
    }
    const afterEnd = endIdx + SALE_END.length;
    const after = raw.slice(afterEnd);
    const body = stripLeadingBlankLines(after).trim();
    return { body, hadPrefix: true };
}

export function decodeWantedBodyFromDescription(description: string): { body: string; hadPrefix: boolean } {
    const raw = String(description ?? "");
    const startIdx = raw.indexOf(WANTED_START);
    const endIdx = raw.indexOf(WANTED_END);
    if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
        return { body: raw, hadPrefix: false };
    }
    const afterEnd = endIdx + WANTED_END.length;
    const after = raw.slice(afterEnd);
    const body = stripLeadingBlankLines(after).trim();
    return { body, hadPrefix: true };
}

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

const MAX_CUSTOM_PRICE_TEXT_LEN = 20;

export function decodeSaleDetailsFromDescription(description: string): {
    details: ListingSaleDetails;
    body: string;
    hadPrefix: boolean;
} {
    const raw = String(description ?? "");
    const startIdx = raw.indexOf(SALE_START);
    const endIdx = raw.indexOf(SALE_END);
    if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
        return {
            details: { quantity: 1, priceType: "each", customPriceText: "", willingToShip: false },
            body: raw,
            hadPrefix: false,
        };
    }

    const afterEnd = endIdx + SALE_END.length;
    const block = raw.slice(startIdx, afterEnd);
    const after = raw.slice(afterEnd);

    let quantity = 1;
    let priceType: PriceType | "" = "each";
    let sawPriceTypeKey = false;
    let customPriceText = "";
    let willingToShip = false;

    for (const line of block.split("\n")) {
        const t = line.trim();
        if (!t || t === SALE_START || t === SALE_END) continue;
        const eq = t.indexOf("=");
        if (eq === -1) continue;
        const k = t.slice(0, eq).trim();
        const v = t.slice(eq + 1).trim();

        if (k === "quantity") quantity = clampInt(Number(v), 1, 9999);
        else if (k === "priceType") {
            sawPriceTypeKey = true;
            if (v === "each" || v === "all" || v === "custom" || v === "free" || v === "offer") priceType = v;
            else priceType = "";
        } else if (k === "customPriceText") customPriceText = cleanInlineText(v, MAX_CUSTOM_PRICE_TEXT_LEN);
        else if (k === "willingToShip") willingToShip = v === "1" || v.toLowerCase() === "true";
    }

    // Back-compat: older prefixes might omit the key entirely.
    if (!sawPriceTypeKey) priceType = "each";
    if (priceType !== "custom") customPriceText = "";

    // Remove leading blank lines after the prefix.
    const body = after.replace(/^\s*\n/, "").replace(/^\s*\n/, "").trim();

    return {
        details: { quantity, priceType, customPriceText, willingToShip },
        body,
        hadPrefix: true,
    };
}
