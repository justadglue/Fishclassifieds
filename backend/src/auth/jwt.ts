import jwt from "jsonwebtoken";
import { config } from "../config.js";

export type AccessTokenPayload = {
  sub: string;
  email: string;
  sid: string;
};

export type RefreshTokenPayload = {
  sub: string;
  sid: string;
};

export type ReauthTokenPayload = {
  sub: string;
  sid: string;
};

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, config.jwtAccessSecret, {
    expiresIn: config.jwtAccessTtlSeconds,
    issuer: "fishclassifieds",
    audience: "fishclassifieds-web",
  });
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign(payload, config.jwtRefreshSecret, {
    expiresIn: `${config.jwtRefreshTtlDays}d`,
    issuer: "fishclassifieds",
    audience: "fishclassifieds-web",
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, config.jwtAccessSecret, {
    issuer: "fishclassifieds",
    audience: "fishclassifieds-web",
  }) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, config.jwtRefreshSecret, {
    issuer: "fishclassifieds",
    audience: "fishclassifieds-web",
  }) as RefreshTokenPayload;
}

export function signReauthToken(payload: ReauthTokenPayload, ttlSeconds: number): string {
  return jwt.sign(payload, config.jwtAccessSecret, {
    expiresIn: Math.max(30, Math.floor(ttlSeconds)),
    issuer: "fishclassifieds",
    audience: "fishclassifieds-web",
  });
}

export function verifyReauthToken(token: string): ReauthTokenPayload {
  return jwt.verify(token, config.jwtAccessSecret, {
    issuer: "fishclassifieds",
    audience: "fishclassifieds-web",
  }) as ReauthTokenPayload;
}
