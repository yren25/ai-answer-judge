import { NextResponse } from "next/server";

import { askKimi } from "@/lib/models/kimi";
import { isModelProviderError } from "@/lib/models/types";

function coerceQuestion(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw == null) return "";
  return String(raw);
}

export async function POST(req: Request) {
  try {
    const { question } = (await req.json()) as { question?: unknown };

    const answer = await askKimi(coerceQuestion(question));
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
      { error: "服务器错误（Kimi）" },
      { status: 500 },
    );
  }
}
