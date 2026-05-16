import { ModelProviderError } from "@/lib/models/types";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-chat";

type DeepSeekMessage = { role: string; content: string };

type DeepSeekResponse = {
  choices?: Array<{
    message?: { content?: string };
  }>;
  error?: { message?: string };
};

function requireDeepSeekApiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    throw new ModelProviderError("DEEPSEEK_API_KEY is not configured", 500);
  }
  return key;
}

/**
 * Low-level chat completion (used by fusion and single-turn ask).
 */
export async function deepseekChat(
  messages: DeepSeekMessage[],
): Promise<string> {
  const apiKey = requireDeepSeekApiKey();

  let res: Response;
  try {
    res = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
      }),
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to reach DeepSeek API";
    throw new ModelProviderError(message, 502);
  }

  let data: DeepSeekResponse;
  try {
    data = (await res.json()) as DeepSeekResponse;
  } catch {
    throw new ModelProviderError("Invalid response from DeepSeek", 502);
  }

  if (!res.ok) {
    const msg =
      data.error?.message ?? `DeepSeek API error (${res.status})`;
    throw new ModelProviderError(
      msg,
      res.status >= 400 && res.status < 600 ? res.status : 502,
    );
  }

  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new ModelProviderError(
      "Empty or unexpected response from DeepSeek",
      502,
    );
  }

  return text;
}

/**
 * Single user message — same behavior as /api/ask.
 */
export async function askDeepSeek(question: string): Promise<string> {
  return deepseekChat([{ role: "user", content: question }]);
}
