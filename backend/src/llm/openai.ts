import { PopularSearchLlmOutputSchema, type PopularSearchCandidate, type PopularSearchLlmOutput } from "./types.js";

function buildUserPrompt(input: { candidates: PopularSearchCandidate[]; outputLimit: number }) {
  const candidates = input.candidates.slice(0, 250).map((c) => ({
    term: c.term,
    browseType: c.browseType,
    category: c.category,
    count: c.count,
    unique: c.unique,
  }));

  return [
    `Using the system instructions, propose up to ${input.outputLimit} items.`,
    `Candidates JSON:`,
    JSON.stringify({ candidates }, null, 2),
  ].join("\n");
}

export async function generatePopularSearchesOpenAI(input: {
  apiKey: string;
  model: string;
  metaPrompt: string;
  candidates: PopularSearchCandidate[];
  outputLimit: number;
}): Promise<{ output: PopularSearchLlmOutput; rawText: string }> {
  const prompt = buildUserPrompt({ candidates: input.candidates, outputLimit: input.outputLimit });
  const body = {
    model: input.model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: String(input.metaPrompt ?? "").trim() || "Return JSON only." },
      { role: "user", content: prompt },
    ],
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OpenAI error ${res.status}: ${text.slice(0, 500)}`);
  }

  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("OpenAI response was not valid JSON");
  }

  const content = parsed?.choices?.[0]?.message?.content;
  const rawText = typeof content === "string" ? content : "";
  if (!rawText) throw new Error("OpenAI response missing message content");

  let obj: any = null;
  try {
    obj = JSON.parse(rawText);
  } catch {
    throw new Error("OpenAI model output was not valid JSON");
  }

  const validated = PopularSearchLlmOutputSchema.safeParse(obj);
  if (!validated.success) {
    throw new Error(`OpenAI output did not match schema: ${validated.error.message}`);
  }

  return { output: validated.data, rawText };
}

