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
    path === "/api/auth/logout"
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

export function adminFetchApprovals(params?: { kind?: "all" | "sale" | "wanted" }) {
  const qs = new URLSearchParams();
  if (params?.kind) qs.set("kind", params.kind);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<{ items: AdminApprovalItem[] }>(`/api/admin/approvals${suffix}`);
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
  resolvedByUserId: number | null;
  resolvedNote: string | null;
};

export function adminFetchReports(params?: { status?: "open" | "resolved" }) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<{ items: AdminReport[] }>(`/api/admin/reports${suffix}`);
}

export function adminResolveReport(id: string, note?: string) {
  return apiFetch<{ ok: true }>(`/api/admin/reports/${id}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note: note ?? null }),
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
};

export function adminFetchUsers(params?: { query?: string; limit?: number; offset?: number }) {
  const qs = new URLSearchParams();
  if (params?.query) qs.set("query", params.query);
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

export async function fetchWantedPost(id: string) {
  return apiFetch<WantedPost>(`/api/wanted/${encodeURIComponent(id)}`);
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

export async function fetchListing(id: string) {
  return apiFetch<Listing>(`/api/listings/${encodeURIComponent(id)}`);
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
  return apiFetch<{ user: AuthUser }>(`/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
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
