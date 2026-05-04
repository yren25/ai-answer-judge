import { NextResponse } from "next/server";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-chat";

type FuseBody = {
  question?: unknown;
  deepseekAnswer?: unknown;
  kimiAnswer?: unknown;
};

type DeepSeekMessage = {
  role: "system" | "user";
  content: string;
};

type DeepSeekResponse = {
  choices?: Array<{
    message?: { content?: string };
  }>;
  error?: { message?: string };
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function POST(request: Request) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "DEEPSEEK_API_KEY is not configured" },
      { status: 500 },
    );
  }

  let body: FuseBody;
  try {
    body = (await request.json()) as FuseBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { question, deepseekAnswer, kimiAnswer } = body;

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

  const messages: DeepSeekMessage[] = [
    {
      role: "system",
      content:
        "You are an expert AI judge. Compare two candidate answers for the same user question. " +
        "Assess factuality, completeness, clarity, and usefulness. Then produce one merged final answer " +
        "that is clearer, more reliable, and concise. Output only the final merged answer.",
    },
    {
      role: "user",
      content:
        `User question:\n${question.trim()}\n\n` +
        `Answer A (DeepSeek):\n${deepseekAnswer.trim()}\n\n` +
        `Answer B (Kimi):\n${kimiAnswer.trim()}\n\n` +
        "Please return the best fused answer.",
    },
  ];

  try {
    const res = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
      }),
    });

    const data = (await res.json()) as DeepSeekResponse;

    if (!res.ok) {
      const message = data.error?.message ?? `DeepSeek API error (${res.status})`;
      return NextResponse.json(
        { error: message },
        { status: res.status >= 400 && res.status < 600 ? res.status : 502 },
      );
    }

    const fusedAnswer = data.choices?.[0]?.message?.content?.trim();
    if (!fusedAnswer) {
      return NextResponse.json(
        { error: "Empty or unexpected response from DeepSeek" },
        { status: 502 },
      );
    }

    return NextResponse.json({ fusedAnswer });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to reach DeepSeek API";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
