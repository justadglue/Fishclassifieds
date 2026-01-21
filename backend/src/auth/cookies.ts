import type { Response } from "express";
import { config } from "../config.js";

const isProd = config.nodeEnv === "production";

export const COOKIE_ACCESS = "fc_access";
export const COOKIE_REFRESH = "fc_refresh";
export const COOKIE_REAUTH = "fc_reauth";

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
    path: "/api/auth",
    maxAge: 1000 * 60 * 60 * 24 * config.jwtRefreshTtlDays,
  });
}

export function setReauthCookie(res: Response, token: string, ttlSeconds: number) {
  res.cookie(COOKIE_REAUTH, token, {
    httpOnly: true,
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
    domain: config.cookieDomain || undefined,
    path: "/api/admin",
    maxAge: 1000 * Math.max(30, Math.floor(ttlSeconds)),
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

  res.clearCookie(COOKIE_REAUTH, {
    domain: config.cookieDomain || undefined,
    path: "/api/admin",
  });
}

export function clearAccessCookie(res: Response) {
  res.clearCookie(COOKIE_ACCESS, {
    domain: config.cookieDomain || undefined,
    path: "/",
  });
}

export function clearReauthCookie(res: Response) {
  res.clearCookie(COOKIE_REAUTH, {
    domain: config.cookieDomain || undefined,
    path: "/api/admin",
  });
}