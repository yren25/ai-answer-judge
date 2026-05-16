import { postProcessFusedAnswerHeadings } from "@/lib/answerText";
import { askClaude } from "@/lib/models/claude";

/**
 * Merges DeepSeek + Kimi + Qwen answers via Claude（面向中文用户、语气自然友好）.
 */
export async function fuseAnswers(input: {
  question: string;
  deepseekAnswer: string;
  kimiAnswer: string;
  qwenAnswer: string;
}): Promise<string> {
  const { question, deepseekAnswer, kimiAnswer, qwenAnswer } = input;

  const prompt = [
    "你是一名专业的答案整合助手。下面是同一道用户问题下，三个模型给出的回答：",
    "• 回答甲：DeepSeek",
    "• 回答乙：Kimi",
    "• 回答丙：Qwen（通义千问）",
    "",
    "请你：",
    "1. 仔细比较三份回答，删除重复表述，避免啰嗦。",
    "2. 保留更准确、更完整、对用户更有用的信息。",
    "3. 若存在矛盾：能判断时简要说明取舍；无法确定时采用稳妥说法，并诚实说明不确定性。",
    "4. 最终只输出一份完整的中文答案，结构清晰（用小标题或分段即可），语气自然、友善、像真人在帮忙。需要 emoji 时直接写 Unicode 字符，不要用 ** 包裹 emoji。",
    "5. 不要使用 Markdown 标题语法（禁止行首 #、##、### 等）；小标题请用「emoji + 文字」或单独一行加粗文字。",
    "6. 不要复述本任务说明，不要标注「回答甲/乙/丙」，不要用「以下是整合结果」这类套话。",
    "",
    "【用户问题】",
    question.trim(),
    "",
    "【DeepSeek 的回答】",
    deepseekAnswer.trim(),
    "",
    "【Kimi 的回答】",
    kimiAnswer.trim(),
    "",
    "【Qwen 的回答】",
    qwenAnswer.trim(),
  ].join("\n");

  const raw = await askClaude(prompt);
  return postProcessFusedAnswerHeadings(raw, {
    deepseekAnswer,
    kimiAnswer,
    qwenAnswer,
  });
}
