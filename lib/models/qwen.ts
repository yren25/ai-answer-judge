import { ModelProviderError } from "@/lib/models/types";

const QWEN_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const QWEN_MODEL = "qwen-plus";

type QwenResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
  message?: string;
};

/**
 * DashScope Qwen compatible-mode chat. If API key is missing, throws 503 so the route can stay "off".
 */
export async function askQwen(question: string): Promise<string> {
  const apiKey = process.env.QWEN_API_KEY?.trim();
  if (!apiKey) {
    throw new ModelProviderError(
      "通义千问暂不可用：未配置 API Key",
      503,
    );
  }

  let res: Response;
  try {
    res = await fetch(QWEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: QWEN_MODEL,
        messages: [
          { role: "system", content: "你是一个有帮助的AI助手" },
          { role: "user", content: question },
        ],
      }),
    });
  } catch (err) {
    console.error("Server Error:", err);
    throw new ModelProviderError("服务器错误（Qwen）", 500);
  }

  let data: QwenResponse;
  try {
    data = (await res.json()) as QwenResponse;
  } catch (err) {
    console.error("Server Error:", err);
    throw new ModelProviderError("服务器错误（Qwen）", 500);
  }

  if (!res.ok) {
    console.error("Qwen API Error:", data);
    const msg =
      data?.error?.message || data?.message || "Qwen 请求失败";
    throw new ModelProviderError(msg, res.status);
  }

  return data?.choices?.[0]?.message?.content || "（Qwen没有返回内容）";
}
