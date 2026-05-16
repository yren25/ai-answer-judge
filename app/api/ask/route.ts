import { NextResponse } from "next/server";

import { askDeepSeek } from "@/lib/models/deepseek";
import { isModelProviderError } from "@/lib/models/types";

type AskBody = {
  question?: unknown;
};

export async function POST(request: Request) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "DEEPSEEK_API_KEY is not configured" },
      { status: 500 },
    );
  }

  let body: AskBody;
  try {
    body = (await request.json()) as AskBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const question = body.question;
  if (typeof question !== "string" || question.trim().length === 0) {
    return NextResponse.json(
      { error: "Body must include a non-empty string field \"question\"" },
      { status: 400 },
    );
  }

  try {
    const answer = await askDeepSeek(question);
    return NextResponse.json({ answer });
  } catch (err) {
    if (isModelProviderError(err)) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status },
      );
    }
    const message =
      err instanceof Error ? err.message : "Failed to reach DeepSeek API";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
