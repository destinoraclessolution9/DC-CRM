// Shared AI form reader for order-form-ocr and cps-form-ocr.
//
// Gemini quota on the key runs out (429), so a read walks a chain:
//   gemini-2.5-flash → gemini-flash-lite-latest → gemini-flash-latest
//   → Claude (only when ANTHROPIC_API_KEY is set as a function secret)
// Each Gemini model has its own quota; Claude is a different provider, so it
// still answers when every Gemini quota is used up.
//
// Errors are thrown as `upstream_<status>` (or `parse`) — never the upstream
// body — so the caller can tell the phone what happened.

// @ts-ignore
import Anthropic from "npm:@anthropic-ai/sdk@0.132.1";

// @ts-ignore
const GEMINI_API_KEY: string = Deno.env.get("GEMINI_API_KEY") || "";
// @ts-ignore
const ANTHROPIC_API_KEY: string = Deno.env.get("ANTHROPIC_API_KEY") || "";

const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-flash-lite-latest", "gemini-flash-latest"];
const CLAUDE_MODEL = "claude-opus-5-5";

// The next provider is worth trying on quota / overload / model-gone.
const _fallThrough = (e: unknown) => /^upstream_(429|503|529|404|500)$/.test(String((e as any)?.message || e));

export interface ReadRequest {
  tag: string;                      // log prefix, e.g. "order-form-ocr"
  prompt: string;
  imageBase64: string;
  mimeType: string;
  schema: Record<string, unknown>;  // Gemini OpenAPI-style schema (type: "OBJECT", nullable…)
  thinkingBudget?: number;          // Gemini 2.5 thinking budget; omit for the model default
}

async function readWithGemini(model: string, r: ReadRequest) {
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: r.prompt }, { inline_data: { mime_type: r.mimeType, data: r.imageBase64 } }] }],
    generationConfig: {
      temperature: 0.1,
      response_mime_type: "application/json",
      response_schema: r.schema,
      ...(r.thinkingBudget != null ? { thinkingConfig: { thinkingBudget: r.thinkingBudget } } : {}),
    },
  };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`[${r.tag}] Gemini ${model} error ${res.status}:`, (await res.text()).slice(0, 300));
    throw new Error(`upstream_${res.status}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) { console.error(`[${r.tag}] Gemini ${model} returned no text`); throw new Error("parse"); }
  try { return JSON.parse(text); } catch { console.error(`[${r.tag}] Gemini ${model} returned non-JSON`); throw new Error("parse"); }
}

// Gemini's OpenAPI subset → JSON Schema, given to Claude in the prompt.
// nullable fields become [type, "null"]; every object property is listed.
export function toJsonSchema(s: any): any {
  if (!s || typeof s !== "object") return s;
  const t = String(s.type || "").toLowerCase();
  let out: any;
  if (t === "object") {
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s.properties || {})) props[k] = toJsonSchema(v);
    out = { type: "object", properties: props, required: Object.keys(props), additionalProperties: false };
  } else if (t === "array") {
    out = { type: "array", items: toJsonSchema(s.items || { type: "STRING" }) };
  } else {
    out = { type: t || "string" };
    if (Array.isArray(s.enum)) out.enum = s.nullable ? [...s.enum, null] : [...s.enum];
  }
  if (s.nullable && out.type !== "object") out.type = [out.type, "null"];
  return out;
}

let _claude: any = null;
async function readWithClaude(r: ReadRequest) {
  if (!_claude) _claude = new Anthropic({ apiKey: ANTHROPIC_API_KEY, maxRetries: 1, timeout: 40_000 });
  const media = /^image\/(jpeg|png|webp|gif)$/.test(r.mimeType) ? r.mimeType : "image/jpeg";
  try {
    const msg = await _claude.beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // The order form has ~80 nullable values — more than structured outputs
      // takes in one schema — so the schema goes in the prompt and the reply is parsed.
      output_config: { effort: "low" },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: media, data: r.imageBase64 } },
          { type: "text", text: `${r.prompt}

Reply with ONLY one JSON object (no code fence) matching this JSON Schema; use null for anything not on the form:
${JSON.stringify(toJsonSchema(r.schema))}` },
        ],
      }],
    });
    if (msg.stop_reason === "refusal") { console.error(`[${r.tag}] Claude declined:`, msg.stop_details?.category); throw new Error("parse"); }
    const text = (msg.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    const i = text.indexOf("{"), j = text.lastIndexOf("}");
    try { return JSON.parse(text.slice(i, j + 1)); } catch { console.error(`[${r.tag}] Claude returned non-JSON`); throw new Error("parse"); }
  } catch (e: any) {
    if (e instanceof Anthropic.APIError && typeof e.status === "number") {
      console.error(`[${r.tag}] Claude error ${e.status}:`, String(e.message || "").slice(0, 200));
      throw new Error(`upstream_${e.status}`);
    }
    if (e instanceof Anthropic.APIConnectionError) throw new Error("upstream_503");
    throw e;
  }
}

// Returns { result, provider } or throws the last provider's error.
export async function readForm(r: ReadRequest): Promise<{ result: any; provider: string }> {
  let last: unknown = new Error("upstream_503");
  const chain: Array<[string, () => Promise<any>]> = [];
  if (GEMINI_API_KEY) for (const m of GEMINI_MODELS) chain.push([m, () => readWithGemini(m, r)]);
  if (ANTHROPIC_API_KEY) chain.push([CLAUDE_MODEL, () => readWithClaude(r)]);
  for (const [name, run] of chain) {
    try { return { result: await run(), provider: name }; }
    catch (e) {
      last = e;
      if (!_fallThrough(e)) throw e;
      console.warn(`[${r.tag}] ${name} unavailable (${(e as any)?.message}) — trying the next`);
    }
  }
  throw last;
}

// Plain message for the phone, from a readForm error.
export function readError(e: unknown): { code: string; detail: string; status: number } {
  const msg = String((e as any)?.message || e);
  const busy = /^upstream_(429|503|529)$/.test(msg);
  return {
    code: msg.startsWith("upstream_") ? msg : "parse",
    detail: busy ? "AI reader is busy right now — key the fields in" : "AI couldn't read this photo",
    status: busy ? 503 : 500,
  };
}
