import { deepseekChat } from "@/lib/models/deepseek";
import { clampHistoryTitle } from "@/lib/historyTitle";

/**
 * Produce a ≤10-char Chinese title for sidebar history via DeepSeek.
 */
export async function summarizeHistoryTitle(question: string): Promise<string> {
  const q = question.trim().slice(0, 3000);
  if (!q) return "未命名对话";

  const raw = await deepseekChat([
    {
      role: "system",
      content:
        "你是对话标题助手。用户会提出一个问题。请用不超过10个汉字概括核心主题。不要标点、引号、书名号、不要解释、不要换行，只输出标题本身。若问题极短可直接截取意涵。",
    },
    { role: "user", content: q },
  ]);

  const line = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] ?? raw;
  return clampHistoryTitle(line, 10);
}
