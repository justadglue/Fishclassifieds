import jwt from "jsonwebtoken";
import { config } from "../config.js";

export type AccessTokenPayload = {
  sub: string;
  email: string;
};

export type RefreshTokenPayload = {
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
