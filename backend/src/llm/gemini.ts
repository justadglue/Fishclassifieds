import { PopularSearchLlmOutputSchema, type PopularSearchCandidate, type PopularSearchLlmOutput } from "./types.js";

function buildPrompt(input: { metaPrompt: string; candidates: PopularSearchCandidate[]; outputLimit: number }) {
  const candidates = input.candidates.slice(0, 250).map((c) => ({
    term: c.term,
    browseType: c.browseType,
    category: c.category,
    count: c.count,
    unique: c.unique,
  }));

  const meta = String(input.metaPrompt ?? "").trim();
  return [
    meta ? meta : `Return ONLY valid JSON.`,
    ``,
    `Using the instructions above, propose up to ${input.outputLimit} items.`,
    `Candidates JSON:`,
    JSON.stringify({ candidates }, null, 2),
  ].join("\n");
}

export async function generatePopularSearchesGemini(input: {
  apiKey: string;
  model: string;
  metaPrompt: string;
  candidates: PopularSearchCandidate[];
  outputLimit: number;
}): Promise<{ output: PopularSearchLlmOutput; rawText: string }> {
  const prompt = buildPrompt({ metaPrompt: input.metaPrompt, candidates: input.candidates, outputLimit: input.outputLimit });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(
    input.apiKey
  )}`;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Gemini error ${res.status}: ${text.slice(0, 500)}`);
  }

  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Gemini response was not valid JSON");
  }

  const rawText =
    parsed?.candidates?.[0]?.content?.parts?.map((p: any) => (p && typeof p.text === "string" ? p.text : "")).join("") ?? "";
  if (!rawText) throw new Error("Gemini response missing text");

  let obj: any = null;
  try {
    obj = JSON.parse(rawText);
  } catch {
    throw new Error("Gemini model output was not valid JSON");
  }

  const validated = PopularSearchLlmOutputSchema.safeParse(obj);
  if (!validated.success) {
    throw new Error(`Gemini output did not match schema: ${validated.error.message}`);
  }

  return { output: validated.data, rawText };
}

