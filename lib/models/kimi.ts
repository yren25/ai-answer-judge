import { ModelProviderError } from "@/lib/models/types";

const KIMI_URL = "https://api.moonshot.cn/v1/chat/completions";
const KIMI_MODEL = "moonshot-v1-8k";

type KimiResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
};

export async function askKimi(question: string): Promise<string> {
  const apiKey = process.env.KIMI_API_KEY;

  let res: Response;
  try {
    res = await fetch(KIMI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: KIMI_MODEL,
        messages: [
          { role: "system", content: "你是一个有帮助的中文AI助手。" },
          { role: "user", content: question },
        ],
      }),
    });
  } catch (err) {
    console.error("Server Error:", err);
    throw new ModelProviderError("服务器错误（Kimi）", 500);
  }

  let data: KimiResponse;
  try {
    data = (await res.json()) as KimiResponse;
  } catch (err) {
    console.error("Server Error:", err);
    throw new ModelProviderError("服务器错误（Kimi）", 500);
  }

  if (!res.ok) {
    console.error("Kimi API Error:", data);
    throw new ModelProviderError(
      data?.error?.message || "Kimi 请求失败",
      res.status,
    );
  }

  return data?.choices?.[0]?.message?.content || "（Kimi没有返回内容）";
}
