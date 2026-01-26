import { z } from "zod";

export type PopularSearchCandidate = {
  term: string;
  browseType: "sale" | "wanted";
  category: string;
  count: number;
  unique: number;
};

export const PopularSearchItemSchema = z.object({
  label: z.string().min(1).max(80),
  include_terms: z.array(z.string().min(1)).max(100).optional().default([]),
  exclude_terms: z.array(z.string().min(1)).max(100).optional().default([]),
  confidence: z.number().min(0).max(1).optional().nullable(),
});

export const PopularSearchLlmOutputSchema = z.object({
  items: z.array(PopularSearchItemSchema).min(0).max(50),
  notes: z.string().optional().nullable(),
});

export type PopularSearchLlmOutput = z.infer<typeof PopularSearchLlmOutputSchema>;

