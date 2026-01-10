export type Category = "Fish" | "Shrimp" | "Snails" | "Plants" | "Equipment";
export type ListingStatus = "draft" | "pending" | "active" | "paused" | "expired" | "deleted";
export type ListingResolution = "none" | "sold";

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
  title: string;
  category: Category;
  species: string;
  priceCents: number;
  location: string;
  description: string;
  contact: string | null;
  imageUrl: string | null;
  images: ImageAsset[];
  status: ListingStatus;
  resolution: ListingResolution;
  expiresAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SortMode = "newest" | "price_asc" | "price_desc";
export type WantedStatus = "open" | "closed";

export type WantedPost = {
  id: string;
  userId: number;
  userDisplayName: string | null;
  username: string | null;
  title: string;
  category: Category;
  species: string | null;
  budgetMinCents: number | null;
  budgetMaxCents: number | null;
  location: string;
  status: WantedStatus;
  description: string;
  createdAt: string;
  updatedAt: string;
};

const API_BASE = (import.meta as any).env?.VITE_API_URL?.toString().trim() || "http://localhost:3001";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}:${text || res.statusText}`);
  }

  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return undefined as unknown as T;
  return (await res.json()) as T;
}

export function resolveImageUrl(u: string | null | undefined) {
  if (!u) return null;
  const s = String(u);
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  if (s.startsWith("/")) return `${API_BASE}${s}`;
  return s;
}

export function resolveAssets(images: Array<string | ImageAsset> | null | undefined): ImageAsset[] {
  const arr = images ?? [];
  return arr.map((x) => {
    if (typeof x === "string") {
      const ru = resolveImageUrl(x) ?? x;
      return { fullUrl: ru, thumbUrl: ru, medUrl: ru };
    }
    const full = resolveImageUrl(x.fullUrl) ?? x.fullUrl;
    const thumb = resolveImageUrl(x.thumbUrl) ?? x.thumbUrl;
    const med = resolveImageUrl(x.medUrl) ?? x.medUrl;
    return { fullUrl: full, thumbUrl: thumb, medUrl: med };
  });
}

const OWNER_TOKEN_KEY = "fish_owner_tokens_v1";

function loadOwnerMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(OWNER_TOKEN_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof k === "string" && typeof v === "string" && v.trim()) out[k] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

function saveOwnerMap(map: Record<string, string>) {
  localStorage.setItem(OWNER_TOKEN_KEY, JSON.stringify(map));
}

export function setOwnerToken(listingId: string, token: string) {
  const map = loadOwnerMap();
  map[String(listingId)] = String(token);
  saveOwnerMap(map);
}

export function getOwnerToken(listingId: string) {
  const map = loadOwnerMap();
  return map[String(listingId)] ?? null;
}

export function removeOwnerToken(listingId: string) {
  const map = loadOwnerMap();
  delete map[String(listingId)];
  saveOwnerMap(map);
}

export function listOwnedIds(): string[] {
  const map = loadOwnerMap();
  return Object.keys(map);
}

export async function fetchMyListings(params?: { limit?: number; offset?: number; includeDeleted?: boolean }) {
  const qs = new URLSearchParams();
  if (params?.limit !== undefined) qs.set("limit", String(params.limit));
  if (params?.offset !== undefined) qs.set("offset", String(params.offset));
  if (params?.includeDeleted) qs.set("includeDeleted", "1");
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<{ items: Listing[]; total: number; limit: number; offset: number }>(`/api/my/listings${suffix}`);
}

export async function fetchListings(params?: {
  q?: string;
  category?: Category;
  species?: string;
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
  status?: WantedStatus;
  minBudgetCents?: number;
  maxBudgetCents?: number;
  limit?: number;
  offset?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.q) qs.set("q", params.q);
  if (params?.category) qs.set("category", params.category);
  if (params?.species) qs.set("species", params.species);
  if (params?.status) qs.set("status", params.status);
  if (params?.minBudgetCents !== undefined) qs.set("min", String(params.minBudgetCents));
  if (params?.maxBudgetCents !== undefined) qs.set("max", String(params.maxBudgetCents));
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
  budgetMinCents?: number | null;
  budgetMaxCents?: number | null;
  location: string;
  description: string;
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
    budgetMinCents?: number | null;
    budgetMaxCents?: number | null;
    location?: string;
    description?: string;
  }
) {
  return apiFetch<WantedPost>(`/api/wanted/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

async function postWantedAction(id: string, action: "close" | "reopen") {
  return apiFetch<WantedPost>(`/api/wanted/${encodeURIComponent(id)}/${action}`, { method: "POST" });
}

export function closeWantedPost(id: string) {
  return postWantedAction(id, "close");
}

export function reopenWantedPost(id: string) {
  return postWantedAction(id, "reopen");
}

export async function deleteWantedPost(id: string) {
  return apiFetch<{ ok: true }>(`/api/wanted/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function fetchListing(id: string) {
  // Include owner token when available so owners can see non-public lifecycle states.
  const token = getOwnerToken(id);
  const headers = token ? { "x-owner-token": token } : undefined;
  return apiFetch<Listing>(`/api/listings/${encodeURIComponent(id)}`, headers ? { headers } : undefined);
}

export async function claimListing(id: string) {
  const token = getOwnerToken(id);
  if (!token) throw new Error("Missing owner token for this listing on this device.");
  return apiFetch<Listing>(`/api/listings/${encodeURIComponent(id)}/claim`, {
    method: "POST",
    headers: { "x-owner-token": token },
  });
}

export async function createListing(input: {
  title: string;
  category: Category;
  species: string;
  priceCents: number;
  location: string;
  description: string;
  contact?: string | null;
  images?: Array<string | ImageAsset>;
  imageUrl?: string | null;
  status?: "draft" | "active";
}) {
  const body = JSON.stringify(input);
  const res = await apiFetch<Listing & { ownerToken?: string }>(`/api/listings`, {
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
    priceCents?: number;
    location?: string;
    description?: string;
    contact?: string | null;
    images?: Array<string | ImageAsset>;
    imageUrl?: string | null;
    featured?: boolean;
    featuredUntil?: number | null;
  }
) {
  const token = getOwnerToken(id);
  return apiFetch<Listing>(`/api/listings/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-owner-token": token } : {}),
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
  const token = getOwnerToken(id);
  return apiFetch<{ ok: true }>(`/api/listings/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: token ? { "x-owner-token": token } : undefined,
  });
}

async function postAction(id: string, action: "pause" | "resume" | "mark-sold") {
  const token = getOwnerToken(id);
  return apiFetch<Listing>(`/api/listings/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    headers: token ? { "x-owner-token": token } : undefined,
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

export type AuthUser = { id: number; email: string; displayName: string; username: string };

export async function authRegister(input: { email: string; username: string; password: string; displayName: string }) {
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
  profile: UserProfile;
};

export async function fetchProfile() {
  return apiFetch<ProfileResponse>(`/api/profile`);
}

export async function updateProfile(input: {
  displayName: string;
  avatarUrl?: string | null;
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

export async function deleteAccount(input: { username: string; password: string }) {
  return apiFetch<{ ok: true }>(`/api/account`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
