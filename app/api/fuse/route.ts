import { NextResponse } from "next/server";

import { fuseAnswers } from "@/lib/fusion";
import { isModelProviderError } from "@/lib/models/types";

type FuseBody = {
  question?: unknown;
  deepseekAnswer?: unknown;
  kimiAnswer?: unknown;
  qwenAnswer?: unknown;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey?.trim()) {
    return NextResponse.json(
      { error: "融合服务未配置：请设置 ANTHROPIC_API_KEY" },
      { status: 500 },
    );
  }

  let body: FuseBody;
  try {
    body = (await request.json()) as FuseBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { question, deepseekAnswer, kimiAnswer, qwenAnswer } = body;

  if (!isNonEmptyString(question)) {
    return NextResponse.json(
      { error: 'Body must include a non-empty string field "question"' },
      { status: 400 },
    );
  }

  if (!isNonEmptyString(deepseekAnswer)) {
    return NextResponse.json(
      { error: 'Body must include a non-empty string field "deepseekAnswer"' },
      { status: 400 },
    );
  }

  if (!isNonEmptyString(kimiAnswer)) {
    return NextResponse.json(
      { error: 'Body must include a non-empty string field "kimiAnswer"' },
      { status: 400 },
    );
  }

  if (!isNonEmptyString(qwenAnswer)) {
    return NextResponse.json(
      { error: 'Body must include a non-empty string field "qwenAnswer"' },
      { status: 400 },
    );
  }

  try {
    const fusedAnswer = await fuseAnswers({
      question: question.trim(),
      deepseekAnswer: deepseekAnswer.trim(),
      kimiAnswer: kimiAnswer.trim(),
      qwenAnswer: qwenAnswer.trim(),
    });

    return NextResponse.json({ fusedAnswer });
  } catch (err) {
    if (isModelProviderError(err)) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status },
      );
    }
    const message =
      err instanceof Error ? err.message : "融合服务暂时不可用，请稍后重试";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
