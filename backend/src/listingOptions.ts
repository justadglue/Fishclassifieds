// Single source of truth for listing-related dropdown options.
// Frontend should load these via GET /api/meta/options.

export const LISTING_CATEGORIES = [
    "Fish",
    "Shrimp",
    "Snails",
    "Crabs",
    "Crayfish",
    "Clams & Mussels",
    "Plants",
    "Corals",
    "Equipment",
    "Accessories",
    "Services",
    "Other",
] as const;
export type ListingCategory = (typeof LISTING_CATEGORIES)[number];

export const LISTING_SEXES = ["Male", "Female", "Various", "Unknown", "Breeding pair"] as const;
export type ListingSex = (typeof LISTING_SEXES)[number];

export const WATER_TYPES = ["Freshwater", "Saltwater", "Brackish"] as const;
export type WaterType = (typeof WATER_TYPES)[number];

// Categories where bio fields (species / sex / water type) are REQUIRED.
export const BIO_FIELDS_REQUIRED_CATEGORIES = [
    "Fish",
    "Shrimp",
    "Snails",
    "Crabs",
    "Crayfish",
    "Clams & Mussels",
    "Plants",
    "Corals",
] as const;

export const OTHER_CATEGORY = "Other" as const;

