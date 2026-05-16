/** Strip punctuation/space and take first `max` Unicode chars (for CJK). */
export function clampHistoryTitle(raw: string, max = 10): string {
  const cleaned = raw
    .trim()
    .replace(/[\s.。!！?？,，;；:""''「」【】、··\n\r]/g, "");
  const chars = Array.from(cleaned);
  const out = chars.slice(0, max).join("");
  return out.length > 0 ? out : "未命名对话";
}
