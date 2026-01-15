// Single source of truth for listing-related dropdown options.
// Frontend should load these via GET /api/meta/options.

export const LISTING_CATEGORIES = ["Fish", "Shrimp", "Snails", "Plants", "Equipment"] as const;
export type ListingCategory = (typeof LISTING_CATEGORIES)[number];

export const LISTING_SEXES = ["Male", "Female", "Various", "Unknown"] as const;
export type ListingSex = (typeof LISTING_SEXES)[number];

