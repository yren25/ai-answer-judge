import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { question } = await req.json();

    const res = await fetch("https://api.moonshot.cn/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.KIMI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "moonshot-v1-8k",
        messages: [
          { role: "system", content: "你是一个有帮助的中文AI助手。" },
          { role: "user", content: question },
        ],
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("Kimi API Error:", data);
      return NextResponse.json(
        { error: data?.error?.message || "Kimi 请求失败" },
        { status: res.status }
      );
    }

    return NextResponse.json({
      answer: data?.choices?.[0]?.message?.content || "（Kimi没有返回内容）",
    });
  } catch (err) {
    console.error("Server Error:", err);
    return NextResponse.json({ error: "服务器错误（Kimi）" }, { status: 500 });
  }
}