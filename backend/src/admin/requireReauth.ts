import type { Request, Response, NextFunction } from "express";
import { clearReauthCookie, COOKIE_REAUTH } from "../auth/cookies.js";
import { verifyReauthToken } from "../auth/jwt.js";

export function requireReauth(req: Request, res: Response, next: NextFunction) {
    const u = req.user;
    if (!u) return res.status(401).json({ error: "Not authenticated" });

    const raw = req.cookies?.[COOKIE_REAUTH];
    if (!raw || typeof raw !== "string") {
        return res.status(403).json({ error: "Password confirmation required", code: "REAUTH_REQUIRED" });
    }

    try {
        const p = verifyReauthToken(raw);
        if (String(p.sub) !== String(u.id) || String(p.sid) !== String(u.sid)) {
            return res.status(403).json({ error: "Password confirmation required", code: "REAUTH_REQUIRED" });
        }

        // Single-use: once confirmed, require password again for the next sensitive action.
        clearReauthCookie(res);
        return next();
    } catch {
        return res.status(403).json({ error: "Password confirmation required", code: "REAUTH_REQUIRED" });
    }
}

