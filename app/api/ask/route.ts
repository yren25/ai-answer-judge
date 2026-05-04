import { NextResponse } from "next/server";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-chat";

type AskBody = {
  question?: unknown;
};

type DeepSeekMessage = { role: string; content: string };

type DeepSeekResponse = {
  choices?: Array<{
    message?: { content?: string };
  }>;
  error?: { message?: string };
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
    const res = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: question }] satisfies DeepSeekMessage[],
      }),
    });

    const data = (await res.json()) as DeepSeekResponse;

    if (!res.ok) {
      const message =
        data.error?.message ?? `DeepSeek API error (${res.status})`;
      return NextResponse.json(
        { error: message },
        { status: res.status >= 400 && res.status < 600 ? res.status : 502 },
      );
    }

    const answer = data.choices?.[0]?.message?.content?.trim();
    if (!answer) {
      return NextResponse.json(
        { error: "Empty or unexpected response from DeepSeek" },
        { status: 502 },
      );
    }

    return NextResponse.json({ answer });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to reach DeepSeek API";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
