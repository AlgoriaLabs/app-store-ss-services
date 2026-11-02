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

export async function chatJson(messages: ChatMessage[], signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(config.llm.timeoutMs);
  const response = await fetch(`${config.llm.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.llm.apiKey ? { Authorization: `Bearer ${config.llm.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.llm.model,
      messages,
      temperature: 0.7,
      max_tokens: 1200,
      response_format: { type: "json_object" },
    }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error(`model API answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content ?? "";
  // Some models wrap JSON in a code fence even in JSON mode.
  const json = content.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  return JSON.parse(json);
}
