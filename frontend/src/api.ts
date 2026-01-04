// frontend/src/api.ts
export type Category = "Fish" | "Shrimp" | "Snails" | "Plants" | "Equipment";
export type ListingStatus = "draft" | "pending" | "active" | "paused" | "expired" | "deleted";
export type ListingResolution = "none" | "sold";

export type ImageAsset = {
  url: string;
  thumbUrl?: string | null;
  mediumUrl?: string | null;
};

export type Listing = {
  id: string;
  title: string;
  category: Category;
  species: string;
  priceCents: number;
  location: string;
  description: string;
  contact: string | null;

  // legacy (may exist; backend also returns it)
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

const API_BASE =
  (import.meta as any).env?.VITE_API_URL?.toString().trim() ||
  "http://localhost:3001";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }

  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return undefined as unknown as T;
  return (await res.json()) as T;
}

// ----- URL helpers -----
export function resolveImageUrl(u: string | null | undefined) {
  if (!u) return null;
  const s = String(u);
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  // backend serves /uploads from same API base
  if (s.startsWith("/")) return `${API_BASE}${s}`;
  return s;
}

export function resolveAssets(images: Array<string | ImageAsset> | null | undefined): ImageAsset[] {
  const arr = images ?? [];
  return arr.map((x) => {
    if (typeof x === "string") return { url: x, thumbUrl: x, mediumUrl: x };
    return {
      url: x.url,
      thumbUrl: x.thumbUrl ?? x.url,
      mediumUrl: x.mediumUrl ?? x.url,
    };
  });
}

// ----- Owner token storage -----
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

// ----- Listings -----
export async function fetchListings(params?: {
  q?: string;
  category?: Category;
  species?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
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

  if (params?.sort) qs.set("sort", params.sort);
  if (params?.limit !== undefined) qs.set("limit", String(params.limit));
  if (params?.offset !== undefined) qs.set("offset", String(params.offset));

  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<{ items: Listing[]; total: number; limit: number; offset: number }>(`/api/listings${suffix}`);
}

export async function fetchListing(id: string) {
  return apiFetch<Listing>(`/api/listings/${encodeURIComponent(id)}`);
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

  // optional
  status?: "draft" | "active";
}) {
  const body = JSON.stringify(input);

  const res = await apiFetch<Listing & { ownerToken: string }>(`/api/listings`, {
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
  }
) {
  const token = getOwnerToken(id);
  if (!token) throw new Error("Missing owner token for this listing (not created on this device).");

  return apiFetch<Listing>(`/api/listings/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-owner-token": token,
    },
    body: JSON.stringify(input),
  });
}

export async function deleteListing(id: string) {
  const token = getOwnerToken(id);
  if (!token) throw new Error("Missing owner token for this listing (not created on this device).");

  return apiFetch<{ ok: true }>(`/api/listings/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: {
      "x-owner-token": token,
    },
  });
}

// ----- Action endpoints -----
async function postAction(id: string, action: "pause" | "resume" | "mark-sold") {
  const token = getOwnerToken(id);
  if (!token) throw new Error("Missing owner token for this listing (not created on this device).");

  return apiFetch<Listing>(`/api/listings/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    headers: {
      "x-owner-token": token,
    },
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

// ----- Uploads -----
export async function uploadImage(file: File): Promise<ImageAsset> {
  const fd = new FormData();
  fd.append("image", file);

  const res = await fetch(`${API_BASE}/api/uploads`, {
    method: "POST",
    body: fd,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upload ${res.status}: ${text || res.statusText}`);
  }

  const data = (await res.json()) as { url: string; thumbUrl: string; mediumUrl: string };
  return data;
}
