import type { Response } from "express";
import { config } from "../config";

const isProd = config.nodeEnv === "production";

export const COOKIE_ACCESS = "fc_access";
export const COOKIE_REFRESH = "fc_refresh";

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  res.cookie(COOKIE_ACCESS, accessToken, {
    httpOnly: true,
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
    domain: config.cookieDomain || undefined,
    path: "/",
    maxAge: 1000 * config.jwtAccessTtlSeconds,
  });

  res.cookie(COOKIE_REFRESH, refreshToken, {
    httpOnly: true,
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
    domain: config.cookieDomain || undefined,
    path: "/api/auth", // limit where the refresh cookie is sent
    maxAge: 1000 * 60 * 60 * 24 * config.jwtRefreshTtlDays,
  });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(COOKIE_ACCESS, {
    domain: config.cookieDomain || undefined,
    path: "/",
  });
  res.clearCookie(COOKIE_REFRESH, {
    domain: config.cookieDomain || undefined,
    path: "/api/auth",
  });
}
