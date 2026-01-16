export const MAX_MONEY_INPUT_LEN = 12;

/**
 * Keep user-entered money text safe for tight UI (pills) and consistent parsing:
 * - digits + a single "."
 * - at most 2 decimal places
 * - limited total length
 */
export function sanitizeMoneyInput(raw: string, maxLen: number = MAX_MONEY_INPUT_LEN) {
    let t = String(raw ?? "").replace(/[^\d.]/g, "");

    const dot = t.indexOf(".");
    if (dot !== -1) {
        const before = t.slice(0, dot);
        const after = t.slice(dot + 1).replace(/\./g, "").slice(0, 2);
        t = `${before}.${after}`;
    }

    if (t.length > maxLen) t = t.slice(0, maxLen);
    return t;
}

