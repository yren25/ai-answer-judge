import type { ReactNode } from "react";
import { createElement } from "react";

/** 答案正文：彩色 emoji 回退栈（与欢迎页一致） */
export const ANSWER_EMOJI_FONT_STACK =
  'ui-emoji, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", sans-serif';

const BOLD_SEGMENT_RE = /\*\*([^*]+)\*\*/g;
const MARKDOWN_HEADING_RE = /^(#{1,6})\s+(.+)$/;
const EMOJI_CLUSTER_RE =
  /^((?:\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)+)/u;

export type FusedAnswerSources = {
  deepseekAnswer: string;
  kimiAnswer: string;
  qwenAnswer: string;
};

function graphemeSegmenter(): Intl.Segmenter | null {
  if (typeof Intl === "undefined" || !("Segmenter" in Intl)) return null;
  return new Intl.Segmenter("zh", { granularity: "grapheme" });
}

export function answerGraphemeLength(text: string): number {
  const seg = graphemeSegmenter();
  if (!seg) return [...text].length;
  let n = 0;
  for (const _ of seg.segment(text)) n++;
  return n;
}

export function sliceAnswerText(text: string, graphemeCount: number): string {
  if (graphemeCount <= 0) return "";
  const seg = graphemeSegmenter();
  if (!seg) return [...text].slice(0, graphemeCount).join("");
  let n = 0;
  let out = "";
  for (const { segment } of seg.segment(text)) {
    if (n >= graphemeCount) break;
    out += segment;
    n++;
  }
  return out;
}

/** 流式展示时去掉末尾未闭合的 **，避免长时间只露出「**」 */
export function stripIncompleteMarkdownBold(text: string): string {
  const open = text.match(/\*\*([^*]*)$/);
  if (open) return text.slice(0, -open[0].length);
  if (/\*\*$/.test(text)) return text.slice(0, -2);
  if (/\*$/.test(text) && !text.endsWith("**")) return text.slice(0, -1);
  return text;
}

function normalizeHeadingTitle(title: string): string {
  return title
    .trim()
    .replace(/^\*\*|\*\*$/g, "")
    .replace(/[\s.。!！?？,，;；:""''「」【】、·\-—–]/g, "")
    .toLowerCase();
}

function parseMarkdownHeadingLine(
  line: string,
): { title: string; emoji: string } | null {
  const m = line.trimEnd().match(MARKDOWN_HEADING_RE);
  if (!m) return null;

  let rest = m[2].trim();
  let emoji = "";
  const em = rest.match(EMOJI_CLUSTER_RE);
  if (em) {
    emoji = em[1];
    rest = rest.slice(em[0].length).trim();
  }
  rest = rest.replace(/^\*\*|\*\*$/g, "").trim();
  if (!rest) return null;
  return { title: rest, emoji };
}

function registerHeadingEmoji(map: Map<string, string>, title: string, emoji: string) {
  const key = normalizeHeadingTitle(title);
  if (key && emoji && !map.has(key)) map.set(key, emoji);
}

/** 从三份原始回答里收集「小标题 → 行首 emoji」 */
function buildHeadingEmojiMap(sources: string[]): Map<string, string> {
  const map = new Map<string, string>();

  for (const src of sources) {
    if (!src?.trim()) continue;
    for (const line of src.split("\n")) {
      const heading = parseMarkdownHeadingLine(line);
      if (heading?.emoji && heading.title) {
        registerHeadingEmoji(map, heading.title, heading.emoji);
        continue;
      }

      const trimmed = line.trim();
      const bold = trimmed.match(/^\*\*([^*]+)\*\*$/);
      if (bold) {
        const inner = bold[1].trim();
        const em = inner.match(EMOJI_CLUSTER_RE);
        if (em) {
          const title = inner.slice(em[0].length).trim();
          if (title) registerHeadingEmoji(map, title, em[1]);
        }
        continue;
      }

      const plain = trimmed.match(/^((?:\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)+)\s+(.+)$/u);
      if (plain) {
        const title = plain[2].trim();
        if (title.length > 0 && title.length <= 32) {
          registerHeadingEmoji(map, title, plain[1]);
        }
      }
    }
  }

  return map;
}

function lookupHeadingEmoji(map: Map<string, string>, title: string): string {
  const key = normalizeHeadingTitle(title);
  if (!key) return "";
  const direct = map.get(key);
  if (direct) return direct;

  let best = "";
  let bestOverlap = 0;
  for (const [k, emoji] of map) {
    if (!k.includes(key) && !key.includes(k)) continue;
    const overlap = Math.min(k.length, key.length);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = emoji;
    }
  }
  return best;
}

/**
 * 融合答案里的 # / ## 小标题：优先换成三份原文里同标题的 emoji；
 * 找不到则去掉 # 只保留标题文字。
 */
export function postProcessFusedAnswerHeadings(
  fused: string,
  sources: FusedAnswerSources,
): string {
  const map = buildHeadingEmojiMap([
    sources.deepseekAnswer,
    sources.kimiAnswer,
    sources.qwenAnswer,
  ]);

  return fused
    .split("\n")
    .map((line) => {
      const heading = parseMarkdownHeadingLine(line);
      if (!heading) return line;

      let { title, emoji } = heading;
      if (!emoji) emoji = lookupHeadingEmoji(map, title);
      return emoji ? `${emoji} ${title}` : title;
    })
    .join("\n");
}

/**
 * 轻量 Markdown：将 **片段** 渲染为加粗，其余原样保留（含 emoji）。
 * 模型常用 **😊** 包裹 emoji，纯文本会显示成「**」而看不到表情。
 */
export function renderAnswerBody(text: string): ReactNode {
  if (!text) return null;

  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(BOLD_SEGMENT_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) {
      parts.push(text.slice(last, idx));
    }
    parts.push(
      createElement(
        "strong",
        { key: `b-${key++}`, className: "font-semibold" },
        m[1],
      ),
    );
    last = idx + m[0].length;
  }
  if (last < text.length) {
    parts.push(text.slice(last));
  }

  if (parts.length === 0) return text;
  if (parts.length === 1) return parts[0];
  return parts.map((part, i) =>
    typeof part === "string"
      ? createElement("span", { key: `t-${i}` }, part)
      : part,
  );
}
