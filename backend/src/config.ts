const jwtAccessTtlSeconds = Number(process.env.JWT_ACCESS_TTL_SECONDS ?? 900);
// Sliding/inactivity window for refresh sessions (extended on each refresh).
const jwtRefreshTtlDays = Number(process.env.JWT_REFRESH_TTL_DAYS ?? 30);
// Optional hard cap: maximum lifetime since session creation. Defaults to same as sliding window.
const jwtRefreshMaxTtlDays = Number(process.env.JWT_REFRESH_MAX_TTL_DAYS ?? jwtRefreshTtlDays);

// OAuth endpoints (overrideable for future API changes).
const googleAuthUrl = process.env.GOOGLE_OAUTH_AUTH_URL ?? "https://accounts.google.com/o/oauth2/v2/auth";
const googleTokenUrl = process.env.GOOGLE_OAUTH_TOKEN_URL ?? "https://oauth2.googleapis.com/token";
const googleUserinfoUrl = process.env.GOOGLE_OAUTH_USERINFO_URL ?? "https://openidconnect.googleapis.com/v1/userinfo";

export const config = {
  port: Number(process.env.PORT ?? 3001),
  nodeEnv: process.env.NODE_ENV ?? "development",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",

  // Public base URL for frontend redirects (OAuth, reset-password links, etc.).
  // Keep separate from CORS origin so deployments can use distinct origins safely.
  publicAppUrl: process.env.PUBLIC_APP_URL ?? (process.env.CORS_ORIGIN ?? "http://localhost:5173"),

  // OAuth providers (optional; required only if you enable the OAuth buttons).
  googleClientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",

  // OAuth endpoints (optional overrides).
  googleAuthUrl,
  googleTokenUrl,
  googleUserinfoUrl,

  jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? "",
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? "",
  jwtAccessTtlSeconds,
  jwtRefreshTtlDays,
  jwtRefreshMaxTtlDays,

  cookieDomain: process.env.COOKIE_DOMAIN ?? "",
};

export function assertConfig() {
  const missing: string[] = [];
  if (!config.jwtAccessSecret) missing.push("JWT_ACCESS_SECRET");
  if (!config.jwtRefreshSecret) missing.push("JWT_REFRESH_SECRET");
  if (!config.corsOrigin) missing.push("CORS_ORIGIN");
  if (!config.publicAppUrl) missing.push("PUBLIC_APP_URL");

  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
}
