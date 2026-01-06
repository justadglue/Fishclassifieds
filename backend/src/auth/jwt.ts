import jwt from "jsonwebtoken";
import { config } from "../config";

export type AccessTokenPayload = {
  sub: string; // user id as string
  email: string;
};

export type RefreshTokenPayload = {
  sub: string;     // user id
  sid: string;     // session id
};

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, config.jwtAccessSecret, {
    expiresIn: config.jwtAccessTtlSeconds,
    issuer: "fishclassifieds",
    audience: "fishclassifieds-web",
  });
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  // refresh token itself is JWT, rotated and stored hashed server-side
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
