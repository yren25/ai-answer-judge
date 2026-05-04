import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { question } = await req.json();

    const res = await fetch(
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.QWEN_API_KEY}`,
        },
        body: JSON.stringify({
          model: "qwen-plus",
          messages: [
            { role: "system", content: "你是一个有帮助的AI助手" },
            { role: "user", content: question },
          ],
        }),
      }
    );

    const data = await res.json();

    // 👉 如果接口返回错误，直接打印出来（方便你debug）
    if (!res.ok) {
      console.error("Qwen API Error:", data);
      return NextResponse.json(
        { error: data?.error?.message || "Qwen 请求失败" },
        { status: res.status }
      );
    }

    return NextResponse.json({
      answer:
        data?.choices?.[0]?.message?.content || "（Qwen没有返回内容）",
    });
  } catch (err) {
    console.error("Server Error:", err);
    return NextResponse.json(
      { error: "服务器错误（Qwen）" },
      { status: 500 }
    );
  }
}