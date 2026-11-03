// A minimal client for any OpenAI-compatible chat completions API: Gemini (its /v1beta/openai endpoint), OpenRouter,
// Groq, Together, DeepSeek, OpenAI or a local Ollama. It asks for a JSON object and returns it parsed, or throws.
// The copywriter falls back to text from the repository when this throws, so a model outage never fails a job.

import { config } from "./config.js";

export type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user";
  content: string | Part[];
}

export function llmConfigured(): boolean {
  return config.llm.apiKey !== "" || /localhost|127\.0\.0\.1|ollama/.test(config.llm.baseUrl);
}

class Busy extends Error {}

async function call(model: string, messages: ChatMessage[], signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(config.llm.timeoutMs);
  const response = await fetch(`${config.llm.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.llm.apiKey ? { Authorization: `Bearer ${config.llm.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      // Room for a thinking model's reasoning as well as the answer.
      max_tokens: 4000,
      response_format: { type: "json_object" },
      ...(config.llm.reasoningEffort ? { reasoning_effort: config.llm.reasoningEffort } : {}),
    }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (response.status === 429 || response.status >= 500) throw new Busy(`model API answered ${response.status}`);
  if (!response.ok) throw new Error(`model API answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content ?? "";
  // Some models wrap JSON in a code fence even in JSON mode.
  const json = content.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  return JSON.parse(json);
}

/** Asks for a JSON object. A busy model (429, 5xx) is retried once, then the fallback model is tried. */
export async function chatJson(messages: ChatMessage[], signal?: AbortSignal): Promise<unknown> {
  const models = [config.llm.model, config.llm.model, ...(config.llm.fallbackModel ? [config.llm.fallbackModel] : [])];
  let last: unknown;
  for (const [attempt, model] of models.entries()) {
    try {
      return await call(model, messages, signal);
    } catch (error) {
      if (!(error instanceof Busy)) throw error;
      last = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  throw last;
}
