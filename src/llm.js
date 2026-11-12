// All calls to Claude go through here.
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const EFFORT = process.env.CLAUDE_EFFORT || "medium";
export const WEB_RESEARCH = process.env.IC_WEB_RESEARCH !== "0";

export const isLive = () =>
  Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) || process.env.IC_MODE === "live";

let client;
const getClient = () => (client ??= new Anthropic());

/**
 * Ask Claude one question.
 * - system: the seat's persona + committee rules
 * - prompt: what we want from the seat this round
 * - schema: optional JSON schema -> returns a parsed object (structured output)
 * - webSearch: let Claude search the web (used for the fact round)
 */
export async function ask({ system, prompt, schema, webSearch = false, maxTokens = 16000 }) {
  const params = {
    model: MODEL,
    max_tokens: maxTokens,
    system,
    thinking: { type: "adaptive" },
    output_config: { effort: EFFORT, ...(schema ? { format: { type: "json_schema", schema } } : {}) },
    // If a safety classifier declines, the API retries on a fallback model automatically.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    ...(webSearch ? { tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }] } : {}),
  };

  let messages = [{ role: "user", content: prompt }];
  let response;
  for (let i = 0; i < 6; i++) {
    response = await getClient().beta.messages.create({ ...params, messages });
    // Long web searches can pause; send the partial turn back so the server continues it.
    if (response.stop_reason === "pause_turn") {
      messages = [...messages, { role: "assistant", content: response.content }];
      continue;
    }
    break;
  }
  if (response.stop_reason === "refusal") {
    throw new Error("The model declined this request" + (response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : ""));
  }

  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  const sources = [];
  for (const b of response.content) {
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content) if (r.url) sources.push({ title: r.title, url: r.url });
    }
  }
  if (!schema) return { text, sources };
  try {
    return { data: JSON.parse(text), sources };
  } catch {
    throw new Error(`Could not parse the model's JSON answer (stop_reason=${response.stop_reason})`);
  }
}
