import { NextResponse } from "next/server";

import { askQwen } from "@/lib/models/qwen";
import { isModelProviderError } from "@/lib/models/types";

function coerceQuestion(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw == null) return "";
  return String(raw);
}

export async function POST(req: Request) {
  try {
    const { question } = (await req.json()) as { question?: unknown };

    const answer = await askQwen(coerceQuestion(question));
    return NextResponse.json({ answer });
  } catch (err) {
    if (isModelProviderError(err)) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status },
      );
    }
    console.error("Server Error:", err);
    return NextResponse.json(
      { error: "服务器错误（Qwen）" },
      { status: 500 },
    );
  }
}
