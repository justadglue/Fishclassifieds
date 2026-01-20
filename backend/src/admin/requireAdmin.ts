import type { Request, Response, NextFunction } from "express";

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const u = req.user;
  if (!u) return res.status(401).json({ error: "Not authenticated" });
  if (!u.isAdmin && !u.isSuperadmin) return res.status(403).json({ error: "Admin privileges required" });
  return next();
}

export function requireSuperadmin(req: Request, res: Response, next: NextFunction) {
  const u = req.user;
  if (!u) return res.status(401).json({ error: "Not authenticated" });
  if (!u.isSuperadmin) return res.status(403).json({ error: "Superadmin privileges required" });
  return next();
}

