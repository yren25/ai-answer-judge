import { ModelProviderError } from "@/lib/models/types";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
/** Override with ANTHROPIC_MODEL; default is Haiku 4.5 alias (see Anthropic model list). */
const CLAUDE_MODEL =
  process.env.ANTHROPIC_MODEL?.trim() || "claude-haiku-4-5";

type AnthropicContentBlock = { type: string; text?: string };

type AnthropicOkResponse = {
  content?: AnthropicContentBlock[];
};

type AnthropicErrBody = {
  type?: string;
  error?: { type?: string; message?: string };
};

function extractPlainText(content: AnthropicContentBlock[] | undefined): string {
  if (!content?.length) return "";
  return content
    .filter(
      (b): b is AnthropicContentBlock & { type: "text"; text: string } =>
        b.type === "text" && typeof b.text === "string",
    )
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/**
 * Single-turn Messages API call; returns plain text (text blocks only).
 */
export async function askClaude(prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new ModelProviderError("未配置 ANTHROPIC_API_KEY", 503);
  }

  let res: Response;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch {
    throw new ModelProviderError("无法连接 Claude，请稍后重试", 502);
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    throw new ModelProviderError("Claude 返回了无法解析的响应", 502);
  }

  const body = raw as AnthropicOkResponse & AnthropicErrBody;

  if (!res.ok) {
    const msg =
      body.error?.message?.trim() ||
      `Claude 请求失败（HTTP ${res.status}）`;
    throw new ModelProviderError(
      msg,
      res.status >= 400 && res.status < 600 ? res.status : 502,
    );
  }

  const text = extractPlainText(body.content);
  if (!text) {
    throw new ModelProviderError("Claude 返回内容为空", 502);
  }

  return text;
}
