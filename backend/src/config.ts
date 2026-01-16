const jwtAccessTtlSeconds = Number(process.env.JWT_ACCESS_TTL_SECONDS ?? 900);
// Sliding/inactivity window for refresh sessions (extended on each refresh).
const jwtRefreshTtlDays = Number(process.env.JWT_REFRESH_TTL_DAYS ?? 30);
// Optional hard cap: maximum lifetime since session creation. Defaults to same as sliding window.
const jwtRefreshMaxTtlDays = Number(process.env.JWT_REFRESH_MAX_TTL_DAYS ?? jwtRefreshTtlDays);

export const config = {
  port: Number(process.env.PORT ?? 3001),
  nodeEnv: process.env.NODE_ENV ?? "development",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",

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

  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
}
