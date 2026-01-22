// Single source of truth for dropdown options is the backend endpoint:
// GET /api/meta/options
export type Category = string;
export type ListingStatus = "draft" | "pending" | "active" | "paused" | "sold" | "closed" | "expired" | "deleted";
export type ListingSex = string;
export type WaterType = string;

export type ImageAsset = {
  fullUrl: string;
  thumbUrl: string;
  medUrl: string;
};

export type Listing = {
  id: string;
  featured?: boolean;
  featuredUntil?: number | null;
  ownerBlockEdit?: boolean;
  ownerBlockPauseResume?: boolean;
  ownerBlockStatusChanges?: boolean;
  ownerBlockFeaturing?: boolean;
  ownerBlockReason?: string | null;
  views?: number;
  sellerUsername?: string | null;
  sellerAvatarUrl?: string | null;
  sellerBio?: string | null;
  title: string;
  category: Category;
  species: string;
  sex: ListingSex;
  waterType?: WaterType | null;
  size: string;
  shippingOffered: boolean;
  priceCents: number;
  location: string;
  description: string;
  phone: string;
  images: ImageAsset[];
  status: ListingStatus;
  expiresAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SortMode = "newest" | "price_asc" | "price_desc" | "budget_asc" | "budget_desc";

export type WantedPost = {
  id: string;
  userId: number;
  username: string | null;
  sellerAvatarUrl?: string | null;
  sellerBio?: string | null;
  featured?: boolean;
  featuredUntil?: number | null;
  ownerBlockEdit?: boolean;
  ownerBlockPauseResume?: boolean;
  ownerBlockStatusChanges?: boolean;
  ownerBlockFeaturing?: boolean;
  ownerBlockReason?: string | null;
  views?: number;
  title: string;
  category: Category;
  species: string | null;
  waterType?: WaterType | null;
  sex: ListingSex;
  size: string;
  quantity: number;
  budgetCents: number | null;
  location: string;
  phone: string;
  status: ListingStatus;
  expiresAt?: string | null;
  description: string;
  images: ImageAsset[];
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FeaturedItem = { kind: "sale"; item: Listing } | { kind: "wanted"; item: WantedPost };

const API_BASE = (import.meta as any).env?.VITE_API_URL?.toString().trim() || "http://localhost:3001";

class ApiError extends Error {
  status: number;
  bodyText: string;
  constructor(status: number, bodyText: string, statusText: string) {
    super(`API ${status}:${bodyText || statusText}`);
    this.status = status;
    this.bodyText = bodyText;
  }
}

type AuthFailureHandler = () => void;
let authFailureHandler: AuthFailureHandler | null = null;
export function setAuthFailureHandler(fn: AuthFailureHandler | null) {
  authFailureHandler = fn;
}

let refreshInFlight: Promise<void> | null = null;

function isAuthEndpoint(path: string) {
  // Don't try to "refresh to fix refresh".
  return (
    path === "/api/auth/refresh" ||
    path === "/api/auth/login" ||
    path === "/api/auth/register" ||
    path === "/api/auth/logout" ||
    path === "/api/auth/reauth"
  );
}

async function apiFetchRaw<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(res.status, text, res.statusText);
  }

  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return undefined as unknown as T;
  return (await res.json()) as T;
}

async function ensureRefreshed(): Promise<void> {
  refreshInFlight ??= (async () => {
    await apiFetchRaw<{ user: AuthUser }>(`/api/auth/refresh`, { method: "POST" });
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await apiFetchRaw<T>(path, init);
  } catch (e: any) {
    // If access token is expired, try one silent refresh then retry once.
    const is401 = e instanceof ApiError && e.status === 401;
    if (!is401 || isAuthEndpoint(path)) throw e;

    try {
      await ensureRefreshed();
    } catch {
      authFailureHandler?.();
      throw e;
    }

    try {
      return await apiFetchRaw<T>(path, init);
    } catch (e2: any) {
      if (e2 instanceof ApiError && e2.status === 401) authFailureHandler?.();
      throw e2;
    }
  }
}

export type ListingOptions = {
  categories: string[];
  listingSexes: string[];
  waterTypes: string[];
  bioFieldsRequiredCategories: string[];
  otherCategory: string;
};

let listingOptionsPromise: Promise<ListingOptions> | null = null;

export function fetchListingOptions() {
  return apiFetch<ListingOptions>(`/api/meta/options`);
}

export function getListingOptionsCached() {
  listingOptionsPromise ??= fetchListingOptions();
  return listingOptionsPromise;
}

export function resolveImageUrl(u: string | null | undefined) {
  if (!u) return null;
  const s = String(u);
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  if (s.startsWith("/")) return `${API_BASE}${s}`;
  return s;
}

export function resolveAssets(images: ImageAsset[] | null | undefined): ImageAsset[] {
  const arr = images ?? [];
  return arr.map((x) => {
    const full = resolveImageUrl(x.fullUrl) ?? x.fullUrl;
    const thumb = resolveImageUrl(x.thumbUrl) ?? x.thumbUrl;
    const med = resolveImageUrl(x.medUrl) ?? x.medUrl;
    return { fullUrl: full, thumbUrl: thumb, medUrl: med };
  });
}

// --- Admin API ---
export type AdminApprovalItem = {
  kind: "sale" | "wanted";
  id: string;
  title: string;
  category: string;
  location: string;
  createdAt: string;
  updatedAt: string;
  user: { id: number; username: string; email: string };
};

export type AdminStats = {
  windowDays: number;
  approvals: { pendingTotal: number; pendingSale: number; pendingWanted: number };
  reports: { open: number };
  listings: { total: number; activeTotal: number; activeSale: number; activeWanted: number };
  users: { total: number; newLastWindow: number };
  views: { total: number };
  db: { path: string; sizeBytes: number | null };
  server: { uptimeSec: number; nowIso: string };
};

export function adminFetchStats(params?: { days?: number }) {
  const qs = new URLSearchParams();
  if (params?.days !== undefined) qs.set("days", String(params.days));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<AdminStats>(`/api/admin/stats${suffix}`);
}

export function adminFetchApprovals(params?: {
  kind?: "all" | "sale" | "wanted";
  sortKey?: string;
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.kind) qs.set("kind", params.kind);
  if (params?.sortKey) qs.set("sortKey", params.sortKey);
  if (params?.sortDir) qs.set("sortDir", params.sortDir);
  if (params?.limit !== undefined) qs.set("limit", String(params.limit));
  if (params?.offset !== undefined) qs.set("offset", String(params.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<{ items: AdminApprovalItem[]; total: number; limit: number; offset: number }>(`/api/admin/approvals${suffix}`);
}

export function adminApprove(kind: "sale" | "wanted", id: string) {
  return apiFetch<{ ok: true }>(`/api/admin/approvals/${kind}/${id}/approve`, { method: "POST" });
}

export function adminReject(kind: "sale" | "wanted", id: string, note?: string) {
  return apiFetch<{ ok: true }>(`/api/admin/approvals/${kind}/${id}/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note: note ?? null }),
  });
}

export type AdminReport = {
  id: string;
  status: "open" | "resolved";
  targetKind: "sale" | "wanted";
  targetId: string;
  reason: string;
  details: string;
  createdAt: string;
  updatedAt: string;
  reporter: { userId: number; username: string; email: string };
  owner: { userId: number; username: string; email: string } | null;
  resolvedByUserId: number | null;
  resolvedNote: string | null;
};

export function adminFetchReports(params?: {
  status?: "open" | "resolved";
  sortKey?: string;
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.sortKey) qs.set("sortKey", params.sortKey);
  if (params?.sortDir) qs.set("sortDir", params.sortDir);
  if (params?.limit !== undefined) qs.set("limit", String(params.limit));
  if (params?.offset !== undefined) qs.set("offset", String(params.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<{ items: AdminReport[]; total: number; limit: number; offset: number }>(`/api/admin/reports${suffix}`);
}

export function adminResolveReport(id: string, note?: string) {
  return apiFetch<{ ok: true }>(`/api/admin/reports/${id}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note: note ?? null }),
  });
}

export type AdminReportAction = "resolve_only" | "hide_listing" | "warn_user" | "suspend_user" | "ban_user";

export function adminReportAction(id: string, input: { action: AdminReportAction; note?: string | null; suspendDays?: number | null }) {
  return apiFetch<{ ok: true }>(`/api/admin/reports/${encodeURIComponent(id)}/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: input.action, note: input.note ?? null, suspendDays: input.suspendDays ?? null }),
  });
}

export type AdminUser = {
  id: number;
  email: string;
  username: string;
  isAdmin: boolean;
  isSuperadmin: boolean;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string | null;
  avatarUrl?: string | null;
};

export type AdminUserDirectoryItem = AdminUser & {
  avatarUrl: string | null;
  moderation: { status: "active" | "suspended" | "banned"; reason: string | null; suspendedUntil: number | null; updatedAt: string | null };
};

export function adminFetchUserDirectory(params?: { query?: string; sortKey?: string; sortDir?: "asc" | "desc"; limit?: number; offset?: number }) {
  const qs = new URLSearchParams();
  if (params?.query) qs.set("query", params.query);
  if (params?.sortKey) qs.set("sortKey", params.sortKey);
  if (params?.sortDir) qs.set("sortDir", params.sortDir);
  if (params?.limit !== undefined) qs.set("limit", String(params.limit));
  if (params?.offset !== undefined) qs.set("offset", String(params.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<{ items: AdminUserDirectoryItem[]; total: number; limit: number; offset: number }>(`/api/admin/users-directory${suffix}`);
}

export type AdminUserDetail = {
  user: AdminUser & { firstName: string; lastName: string };
  profile: { avatarUrl: string | null; location: string | null; phone: string | null; website: string | null; bio: string | null; createdAt: string | null; updatedAt: string | null };
  moderation: { status: "active" | "suspended" | "banned"; reason: string | null; suspendedUntil: number | null; createdAt: string | null; updatedAt: string | null };
  stats: {
    listings: { total: number; active: number; pending: number; deleted: number; saleTotal: number; wantedTotal: number };
    reports: { reportedByUser: number };
    sessions: { total: number; active: number };
  };
};

export function adminGetUser(id: number) {
  return apiFetch<AdminUserDetail>(`/api/admin/users/${encodeURIComponent(String(id))}`);
}

export function adminSetUserModeration(id: number, input: { status: "active" | "suspended" | "banned"; reason?: string | null; suspendedUntil?: number | null }) {
  return apiFetch<{ ok: true }>(`/api/admin/users/${encodeURIComponent(String(id))}/moderation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function adminRevokeUserSessions(id: number) {
  return apiFetch<{ ok: true }>(`/api/admin/users/${encodeURIComponent(String(id))}/revoke-sessions`, { method: "POST" });
}

export function adminDeleteUserAccount(id: number, reason?: string) {
  return apiFetch<{ ok: true }>(`/api/admin/users/${encodeURIComponent(String(id))}/delete-account`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: reason ?? null }),
  });
}

export type AdminAuditItem = {
  id: string;
  actor: { userId: number; username: string | null; email: string | null };
  action: string;
  targetKind: string;
  targetId: string;
  metaJson: string | null;
  createdAt: string;
};

export type NotificationItem = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  metaJson: string | null;
  imageUrl?: string | null;
  isRead: boolean;
  createdAt: string;
  readAt: string | null;
};

export function fetchNotifications(params?: { limit?: number; offset?: number }) {
  const qs = new URLSearchParams();
  if (params?.limit !== undefined) qs.set("limit", String(params.limit));
  if (params?.offset !== undefined) qs.set("offset", String(params.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<{ unreadCount: number; items: NotificationItem[]; limit: number; offset: number }>(`/api/notifications${suffix}`);
}

export function markNotificationRead(id: string) {
  return apiFetch<{ ok: true; changes: number }>(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "POST" });
}

export function markAllNotificationsRead() {
  return apiFetch<{ ok: true; changes: number }>(`/api/notifications/read-all`, { method: "POST" });
}

export function adminFetchAudit(params?: {
  actor?: string;
  action?: string;
  targetKind?: string;
  targetId?: string;
  sortKey?: string;
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.actor) qs.set("actorUserId", String(params.actor));
  if (params?.action) qs.set("action", params.action);
  if (params?.targetKind) qs.set("targetKind", params.targetKind);
  if (params?.targetId) qs.set("targetId", params.targetId);
  if (params?.sortKey) qs.set("sortKey", params.sortKey);
  if (params?.sortDir) qs.set("sortDir", params.sortDir);
  if (params?.limit !== undefined) qs.set("limit", String(params.limit));
  if (params?.offset !== undefined) qs.set("offset", String(params.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<{ items: AdminAuditItem[]; total: number; limit: number; offset: number }>(`/api/admin/audit${suffix}`);
}

export type AdminSiteSettings = {
  requireApproval: boolean;
  listingTtlDays: number;
  rateLimitWindowMs: number;
  rateLimitMax: number;
  featuredMaxDays: number;
};

export function adminGetSettings() {
  return apiFetch<{ settings: AdminSiteSettings }>(`/api/admin/settings`);
}

export function adminUpdateSettings(input: Partial<AdminSiteSettings>) {
  return apiFetch<{ ok: true }>(`/api/admin/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export type AdminListingListItem = {
  kind: "sale" | "wanted";
  id: string;
  heroUrl?: string | null;
  user: { id: number; username: string | null; email: string | null; firstName: string; lastName: string } | null;
  status: ListingStatus;
  title: string;
  category: Category;
  species: string | null;
  sex: string;
  waterType: string | null;
  size: string;
  shippingOffered: boolean;
  quantity: number;
  priceCents: number;
  budgetCents: number | null;
  location: string;
  phone: string;
  views: number;
  featuredUntil: number | null;
  publishedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  ownerBlockEdit?: boolean;
  ownerBlockPauseResume?: boolean;
  ownerBlockStatusChanges?: boolean;
  ownerBlockFeaturing?: boolean;
  ownerBlockReason?: string | null;
  ownerBlockUpdatedAt?: string | null;
  ownerBlockActorUserId?: number | null;
};

export function adminFetchListings(params?: {
  q?: string;
  user?: string;
  kind?: "all" | "sale" | "wanted";
  status?: "all" | ListingStatus;
  featured?: boolean;
  includeDeleted?: boolean;
  restrictions?: "all" | "any" | "none" | "edit" | "status" | "featuring";
  sortKey?: string;
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.q) qs.set("q", params.q);
  if (params?.user) qs.set("user", params.user);
  if (params?.kind) qs.set("kind", params.kind);
  if (params?.status) qs.set("status", params.status);
  if (params?.featured) qs.set("featured", "1");
  if (params?.includeDeleted) qs.set("includeDeleted", "1");
  if (params?.restrictions && params.restrictions !== "all") qs.set("restrictions", params.restrictions);
  if (params?.sortKey) qs.set("sortKey", params.sortKey);
  if (params?.sortDir) qs.set("sortDir", params.sortDir);
  if (params?.limit !== undefined) qs.set("limit", String(params.limit));
  if (params?.offset !== undefined) qs.set("offset", String(params.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<{ items: AdminListingListItem[]; total: number; limit: number; offset: number }>(`/api/admin/listings${suffix}`);
}

export function adminGetListing(id: string) {
  return apiFetch<{ item: AdminListingListItem & { description: string; images: Array<{ id: string; url: string; thumbUrl: string | null; mediumUrl: string | null; sortOrder: number }> } }>(
    `/api/admin/listings/${encodeURIComponent(id)}`
  );
}

export function adminSetListingStatus(id: string, status: ListingStatus) {
  return apiFetch<{ ok: true }>(`/api/admin/listings/${encodeURIComponent(id)}/set-status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

export function adminSetListingFeaturedUntil(id: string, featuredUntil: number | null) {
  return apiFetch<{ ok: true }>(`/api/admin/listings/${encodeURIComponent(id)}/set-featured`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ featuredUntil }),
  });
}

export function adminSetListingRestrictions(
  id: string,
  input: { blockEdit: boolean; blockPauseResume: boolean; blockStatusChanges: boolean; blockFeaturing: boolean; reason?: string | null }
) {
  return apiFetch<{ ok: true }>(`/api/admin/listings/${encodeURIComponent(id)}/set-restrictions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function adminFetchUsers(params?: { query?: string; sortKey?: string; sortDir?: "asc" | "desc"; limit?: number; offset?: number }) {
  const qs = new URLSearchParams();
  if (params?.query) qs.set("query", params.query);
  if (params?.sortKey) qs.set("sortKey", params.sortKey);
  if (params?.sortDir) qs.set("sortDir", params.sortDir);
  if (params?.limit !== undefined) qs.set("limit", String(params.limit));
  if (params?.offset !== undefined) qs.set("offset", String(params.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<{ items: AdminUser[]; total: number; limit: number; offset: number }>(`/api/admin/users${suffix}`);
}

export function adminSetAdmin(userId: number, isAdmin: boolean) {
  return apiFetch<{ ok: true }>(`/api/admin/users/${userId}/set-admin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isAdmin }),
  });
}

export function adminSetSuperadmin(userId: number, isSuperadmin: boolean) {
  return apiFetch<{ ok: true }>(`/api/admin/users/${userId}/set-superadmin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isSuperadmin }),
  });
}

// --- Public reports ---
export type CreateReportInput = {
  targetKind: "sale" | "wanted";
  targetId: string;
  reason: string;
  details?: string | null;
};

export function createReport(input: CreateReportInput) {
  return apiFetch<{ id: string }>(`/api/reports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function fetchMyListings(params?: { limit?: number; offset?: number; includeDeleted?: boolean }) {
  const qs = new URLSearchParams();
  if (params?.limit !== undefined) qs.set("limit", String(params.limit));
  if (params?.offset !== undefined) qs.set("offset", String(params.offset));
  if (params?.includeDeleted) qs.set("includeDeleted", "1");
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<{ items: Listing[]; total: number; limit: number; offset: number }>(`/api/my/listings${suffix}`);
}

export async function fetchMyWanted(params?: { limit?: number; offset?: number; includeDeleted?: boolean }) {
  const qs = new URLSearchParams();
  if (params?.limit !== undefined) qs.set("limit", String(params.limit));
  if (params?.offset !== undefined) qs.set("offset", String(params.offset));
  if (params?.includeDeleted) qs.set("includeDeleted", "1");
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<{ items: WantedPost[]; total: number; limit: number; offset: number }>(`/api/my/wanted${suffix}`);
}

export async function fetchFeatured(params?: { limit?: number; offset?: number }) {
  const qs = new URLSearchParams();
  if (params?.limit !== undefined) qs.set("limit", String(params.limit));
  if (params?.offset !== undefined) qs.set("offset", String(params.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<{ items: FeaturedItem[]; total: number; limit: number; offset: number }>(`/api/featured${suffix}`);
}

export async function fetchListings(params?: {
  q?: string;
  category?: Category;
  species?: string;
  location?: string;
  waterType?: WaterType;
  sex?: ListingSex;
  size?: string;
  shippingOffered?: boolean;
  minPriceCents?: number;
  maxPriceCents?: number;
  featured?: boolean;
  sort?: SortMode;
  limit?: number;
  offset?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.q) qs.set("q", params.q);
  if (params?.category) qs.set("category", params.category);
  if (params?.species) qs.set("species", params.species);
  if (params?.location) qs.set("location", params.location);
  if (params?.waterType) qs.set("waterType", params.waterType);
  if (params?.sex) qs.set("sex", params.sex);
  if (params?.size) qs.set("size", params.size);
  if (params?.shippingOffered) qs.set("ship", "1");
  if (params?.minPriceCents !== undefined) qs.set("minPriceCents", String(params.minPriceCents));
  if (params?.maxPriceCents !== undefined) qs.set("maxPriceCents", String(params.maxPriceCents));
  if (params?.featured) qs.set("featured", "1");
  if (params?.sort) qs.set("sort", params.sort);
  if (params?.limit !== undefined) qs.set("limit", String(params.limit));
  if (params?.offset !== undefined) qs.set("offset", String(params.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<{ items: Listing[]; total: number; limit: number; offset: number }>(`/api/listings${suffix}`);
}

export async function fetchWanted(params?: {
  q?: string;
  category?: Category;
  species?: string;
  location?: string;
  waterType?: WaterType;
  sex?: ListingSex;
  size?: string;
  minBudgetCents?: number;
  maxBudgetCents?: number;
  sort?: SortMode;
  limit?: number;
  offset?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.q) qs.set("q", params.q);
  if (params?.category) qs.set("category", params.category);
  if (params?.species) qs.set("species", params.species);
  if (params?.location) qs.set("location", params.location);
  if (params?.waterType) qs.set("waterType", params.waterType);
  if (params?.sex) qs.set("sex", params.sex);
  if (params?.size) qs.set("size", params.size);
  if (params?.minBudgetCents !== undefined) qs.set("minBudgetCents", String(params.minBudgetCents));
  if (params?.maxBudgetCents !== undefined) qs.set("maxBudgetCents", String(params.maxBudgetCents));
  if (params?.sort) qs.set("sort", params.sort);
  if (params?.limit !== undefined) qs.set("limit", String(params.limit));
  if (params?.offset !== undefined) qs.set("offset", String(params.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<{ items: WantedPost[]; total: number; limit: number; offset: number }>(`/api/wanted${suffix}`);
}

export async function fetchWantedPost(id: string, opts?: { viewContext?: "admin" | "public" }) {
  const qs = new URLSearchParams();
  if (opts?.viewContext) qs.set("viewContext", opts.viewContext);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<WantedPost>(`/api/wanted/${encodeURIComponent(id)}${suffix}`);
}

export async function createWantedPost(input: {
  title: string;
  category: Category;
  species?: string | null;
  waterType?: WaterType | null;
  sex?: ListingSex | null;
  size: string;
  quantity?: number;
  budgetCents?: number | null;
  location: string;
  description: string;
  phone: string;
  images?: ImageAsset[];
  status?: "draft" | "active";
}) {
  return apiFetch<WantedPost>(`/api/wanted`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateWantedPost(
  id: string,
  input: {
    title?: string;
    category?: Category;
    species?: string | null;
    waterType?: WaterType | null;
    sex?: ListingSex | null;
    size?: string;
    quantity?: number;
    budgetCents?: number | null;
    location?: string;
    description?: string;
    phone?: string;
    images?: ImageAsset[];
    featured?: boolean;
    featuredUntil?: number | null;
  }
) {
  return apiFetch<WantedPost>(`/api/wanted/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function setWantedFeaturingForDays(id: string, days: number) {
  const ms = Math.max(1, Math.floor(days)) * 24 * 60 * 60 * 1000;
  return updateWantedPost(id, { featured: true, featuredUntil: Date.now() + ms });
}

export async function setWantedFeaturingUntilMs(id: string, featuredUntilMs: number) {
  return updateWantedPost(id, { featured: true, featuredUntil: featuredUntilMs });
}

export async function clearWantedFeaturing(id: string) {
  return updateWantedPost(id, { featured: false, featuredUntil: null });
}

async function postWantedAction(id: string, action: "close" | "reopen" | "pause" | "resume" | "relist") {
  return apiFetch<WantedPost>(`/api/wanted/${encodeURIComponent(id)}/${action}`, { method: "POST" });
}

export function closeWantedPost(id: string) {
  return postWantedAction(id, "close");
}

export function reopenWantedPost(id: string) {
  return postWantedAction(id, "reopen");
}

export function pauseWantedPost(id: string) {
  return postWantedAction(id, "pause");
}

export function resumeWantedPost(id: string) {
  return postWantedAction(id, "resume");
}

export function relistWantedPost(id: string) {
  return postWantedAction(id, "relist");
}

export async function deleteWantedPost(id: string) {
  return apiFetch<{ ok: true }>(`/api/wanted/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function fetchListing(id: string, opts?: { viewContext?: "admin" | "public" }) {
  const qs = new URLSearchParams();
  if (opts?.viewContext) qs.set("viewContext", opts.viewContext);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<Listing>(`/api/listings/${encodeURIComponent(id)}${suffix}`);
}

export async function relistListing(id: string) {
  return apiFetch<{ item: Listing; replacedId: string }>(`/api/listings/${encodeURIComponent(id)}/relist`, { method: "POST" });
}

export async function createListing(input: {
  title: string;
  category: Category;
  species: string;
  sex: ListingSex;
  waterType?: WaterType | null;
  size: string;
  shippingOffered?: boolean;
  priceCents: number;
  location: string;
  description: string;
  phone: string;
  images?: ImageAsset[];
  status?: "draft" | "active";
}) {
  const body = JSON.stringify(input);
  const res = await apiFetch<Listing>(`/api/listings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  return res;
}

export async function updateListing(
  id: string,
  input: {
    title?: string;
    category?: Category;
    species?: string;
    sex?: ListingSex;
    waterType?: WaterType | null;
    size?: string;
    shippingOffered?: boolean;
    priceCents?: number;
    location?: string;
    description?: string;
    phone?: string;
    images?: ImageAsset[];
    featured?: boolean;
    featuredUntil?: number | null;
  }
) {
  return apiFetch<Listing>(`/api/listings/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
}

export async function setListingFeatured(id: string, featured: boolean) {
  return updateListing(id, { featured });
}

export async function setListingFeaturingForDays(id: string, days: number) {
  const ms = Math.max(1, Math.floor(days)) * 24 * 60 * 60 * 1000;
  return updateListing(id, { featured: true, featuredUntil: Date.now() + ms });
}

export async function setListingFeaturingUntilMs(id: string, featuredUntilMs: number) {
  return updateListing(id, { featured: true, featuredUntil: featuredUntilMs });
}

export async function clearListingFeaturing(id: string) {
  return updateListing(id, { featured: false, featuredUntil: null });
}

export async function deleteListing(id: string) {
  return apiFetch<{ ok: true }>(`/api/listings/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

async function postAction(id: string, action: "pause" | "resume" | "mark-sold" | "mark-closed") {
  return apiFetch<Listing>(`/api/listings/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
  });
}

export function pauseListing(id: string) {
  return postAction(id, "pause");
}

export function resumeListing(id: string) {
  return postAction(id, "resume");
}

export function markSold(id: string) {
  return postAction(id, "mark-sold");
}

export function markClosed(id: string) {
  return postAction(id, "mark-closed");
}

export async function uploadImage(file: File): Promise<ImageAsset> {
  const fd = new FormData();
  fd.append("image", file);
  const res = await fetch(`${API_BASE}/api/uploads`, {
    method: "POST",
    body: fd,
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upload ${res.status}:${text || res.statusText}`);
  }
  const data = (await res.json()) as ImageAsset;
  return data;
}

// Must match backend multer `fileSize` limit for /api/uploads.
export const MAX_UPLOAD_IMAGE_BYTES = 6 * 1024 * 1024; // 6MB
export const MAX_UPLOAD_IMAGE_MB = 6;

export type AuthUser = { id: number; email: string; username: string; isAdmin: boolean; isSuperadmin: boolean };

export async function authRegister(input: {
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  password: string;
}) {
  return apiFetch<{ user: AuthUser }>(`/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function authLogin(input: { email: string; password: string }) {
  try {
    return await apiFetch<{ user: AuthUser }>(`/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch (e: any) {
    // Improve user-facing messaging for moderation blocks ONLY (banned/suspended).
    // Do not rewrite other errors.
    const status =
      e instanceof ApiError
        ? e.status
        : e && typeof e === "object" && "status" in e
          ? Number((e as any).status)
          : null;
    const bodyTextRaw =
      e instanceof ApiError
        ? e.bodyText
        : e && typeof e === "object" && "bodyText" in e
          ? String((e as any).bodyText ?? "")
          : "";
    const msg = String(e?.message ?? "");

    if (status === 403) {
      let parsed: any = null;
      // 1) Prefer real response body text (ApiError.bodyText)
      try {
        if (bodyTextRaw) parsed = JSON.parse(bodyTextRaw);
      } catch {
        // ignore
      }
      // 2) Fallback: sometimes callers surface ApiError.message: "API 403:{json}"
      if (!parsed && msg.startsWith("API 403:")) {
        try {
          parsed = JSON.parse(msg.slice("API 403:".length).trim());
        } catch {
          // ignore
        }
      }

      const code = parsed ? String(parsed.code ?? "") : "";
      if (code === "ACCOUNT_BANNED" || code === "ACCOUNT_SUSPENDED") {
        const reason = parsed?.reason != null ? String(parsed.reason) : null;
        const suspendedUntil = parsed?.suspendedUntil != null ? Number(parsed.suspendedUntil) : null;

        if (code === "ACCOUNT_BANNED") {
          const lines = [
            "Your account has been banned.",
            `Reason: ${reason ? reason : "Not provided"}`,
            "If you believe this is a mistake, please contact support.",
          ];
          throw new Error(lines.join("\n"));
        }

        const untilStr =
          suspendedUntil != null && Number.isFinite(suspendedUntil) ? new Date(suspendedUntil).toLocaleString() : null;
        const lines = [
          "Your account has been suspended.",
          `Until: ${untilStr ? untilStr : "Further notice"}`,
          `Reason: ${reason ? reason : "Not provided"}`,
          "If you believe this is a mistake, please contact support.",
        ];
        throw new Error(lines.join("\n"));
      }
    }

    throw e;
  }
}

export async function authLogout() {
  return apiFetch<{ ok: true }>(`/api/auth/logout`, { method: "POST" });
}

export async function authMe() {
  return apiFetch<{ user: AuthUser }>(`/api/me`);
}

export async function authRefresh() {
  return apiFetch<{ user: AuthUser }>(`/api/auth/refresh`, { method: "POST" });
}

export async function authReauth(password: string) {
  return apiFetch<{ ok: true; expiresInSec: number }>(`/api/auth/reauth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

export type UserProfile = {
  avatarUrl: string | null;
  location: string | null;
  phone: string | null;
  website: string | null;
  bio: string | null;
};

export type ProfileResponse = {
  user: AuthUser;
  account: { firstName: string; lastName: string };
  profile: UserProfile;
};

export async function fetchProfile() {
  return apiFetch<ProfileResponse>(`/api/profile`);
}

export async function updateProfile(input: {
  firstName?: string;
  lastName?: string;
  location?: string | null;
  phone?: string | null;
  website?: string | null;
  bio?: string | null;
}) {
  return apiFetch<ProfileResponse>(`/api/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function uploadProfileAvatar(file: File) {
  const fd = new FormData();
  fd.append("image", file);
  return apiFetch<ProfileResponse>(`/api/profile/avatar`, { method: "POST", body: fd });
}

export async function deleteProfileAvatar() {
  return apiFetch<ProfileResponse>(`/api/profile/avatar`, { method: "DELETE" });
}

export async function deleteAccount(input: { username: string; password: string }) {
  return apiFetch<{ ok: true }>(`/api/account`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
