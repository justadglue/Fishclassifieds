export type PriceType = "each" | "all" | "custom";

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

