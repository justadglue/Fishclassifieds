export type ListingKind = "sale" | "wanted";

export function parseListingKind(v: string | null | undefined): ListingKind {
  return v === "wanted" ? "wanted" : "sale";
}

export function browsePath(kind: ListingKind) {
  return kind === "wanted" ? "/browse?type=wanted" : "/browse?type=sale";
}

export function listingDetailPath(kind: ListingKind, id: string) {
  return `/listing/${kind}/${encodeURIComponent(id)}`;
}

export function listingEditPath(kind: ListingKind, id: string) {
  return `/edit/${kind}/${encodeURIComponent(id)}`;
}

export function listingPostPath(kind: ListingKind) {
  return `/post/${kind}`;
}

