import { NextResponse } from "next/server";

import { clampHistoryTitle } from "@/lib/historyTitle";
import { summarizeHistoryTitle } from "@/lib/models/summarizeTitle";
import { isModelProviderError } from "@/lib/models/types";

function coerceQuestion(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw == null) return "";
  return String(raw);
}

export async function POST(req: Request) {
  let body: { question?: unknown };
  try {
    body = (await req.json()) as { question?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const question = coerceQuestion(body.question).trim();
  if (!question) {
    return NextResponse.json(
      { error: 'Body must include non-empty "question"' },
      { status: 400 },
    );
  }

  try {
    const title = await summarizeHistoryTitle(question);
    return NextResponse.json({ title: clampHistoryTitle(title, 10) });
  } catch (err) {
    if (isModelProviderError(err)) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status },
      );
    }
    console.error("summarize-title:", err);
    return NextResponse.json({ error: "标题生成失败" }, { status: 500 });
  }
}
