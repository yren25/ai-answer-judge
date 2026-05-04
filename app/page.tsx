"use client";

import { useState } from "react";

export default function Home() {
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [deepseekAnswer, setDeepseekAnswer] = useState("");
  const [kimiAnswer, setKimiAnswer] = useState("");
  const [fusedAnswer, setFusedAnswer] = useState("");

  const handleSubmit = async () => {
    const q = question.trim();
    if (!q) {
      setError("请先输入问题。");
      return;
    }
  
    setLoading(true);
    setError("");
    setDeepseekAnswer("");
    setKimiAnswer("");
    setFusedAnswer("");
  
    try {
      const [deepseekRes, kimiRes] = await Promise.all([
        fetch("/api/ask", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ question: q }),
        }),
        fetch("/api/kimi", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ question: q }),
        }),
      ]);
  
      const deepseekData = (await deepseekRes.json()) as {
        answer?: string;
        error?: string;
      };
      const kimiData = (await kimiRes.json()) as {
        answer?: string;
        error?: string;
      };

      if (!deepseekRes.ok) {
        throw new Error(deepseekData.error || "DeepSeek 请求失败");
      }
      if (!kimiRes.ok) {
        throw new Error(kimiData.error || "Kimi 请求失败");
      }

      const deepseekText = deepseekData.answer?.trim() || "无返回";
      const kimiText = kimiData.answer?.trim() || "无返回";
      setDeepseekAnswer(deepseekText);
      setKimiAnswer(kimiText);

      const fuseRes = await fetch("/api/fuse", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: q,
          deepseekAnswer: deepseekText,
          kimiAnswer: kimiText,
        }),
      });
  
      const fuseData = (await fuseRes.json()) as {
        fusedAnswer?: string;
        error?: string;
      };

      if (!fuseRes.ok) {
        throw new Error(fuseData.error || "融合失败，请稍后重试");
      }

      setFusedAnswer(fuseData.fusedAnswer?.trim() || "暂无融合结果");
  
    } catch (err) {
      const message = err instanceof Error ? err.message : "请求失败，请稍后再试";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-gradient-to-b from-violet-100 via-slate-100 to-blue-100 text-zinc-900">
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-violet-300/30 via-transparent to-blue-300/35"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -top-40 left-1/2 h-[22rem] w-[min(120%,42rem)] -translate-x-1/2 rounded-full bg-violet-400/38 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute bottom-[-4rem] right-[-3rem] h-56 w-56 rounded-full bg-blue-400/36 blur-3xl sm:h-72 sm:w-72"
        aria-hidden
      />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-4 py-8 sm:px-6 sm:py-12">
        <div className="rounded-3xl border border-zinc-300/70 bg-white/70 p-5 shadow-[0_24px_64px_-20px_rgba(91,33,182,0.14),0_8px_24px_-12px_rgba(37,99,235,0.1)] backdrop-blur-xl sm:p-8 md:p-10">
          <header className="mb-7 space-y-2 sm:mb-8 sm:space-y-3">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl sm:font-bold">
              AI答案评审器
            </h1>
            <p className="max-w-prose text-sm leading-relaxed text-zinc-600 sm:text-base sm:leading-relaxed">
              多个AI回答对比与融合，帮助你获得更清晰、更可靠的答案
            </p>
          </header>

          <div className="space-y-2">
            <label
              htmlFor="question"
              className="text-xs font-medium text-zinc-600 sm:text-sm"
            >
              你的问题
            </label>
            <textarea
              id="question"
              className="min-h-[12rem] w-full resize-y rounded-2xl border border-zinc-300/80 bg-white/85 px-4 py-3.5 text-base leading-6 text-zinc-900 outline-none transition-shadow placeholder:text-zinc-500 focus:border-violet-400/80 focus:shadow-[0_0_0_3px_rgba(167,139,250,0.35)] disabled:opacity-55 sm:min-h-[11rem] sm:py-4 touch-manipulation"
              placeholder="请描述你的问题，越具体越好…"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={loading}
              aria-busy={loading}
              autoComplete="off"
            />
          </div>

          <button
            type="button"
            className="mt-5 flex min-h-[3rem] w-full items-center justify-center rounded-2xl bg-gradient-to-r from-violet-600 via-violet-500 to-blue-600 px-6 text-base font-semibold text-white shadow-[0_12px_32px_-8px_rgba(109,40,217,0.45),0_4px_12px_-4px_rgba(37,99,235,0.35)] outline-none transition-[filter,transform,box-shadow] hover:brightness-105 active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-violet-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-100 disabled:pointer-events-none disabled:opacity-45 sm:mt-6 sm:min-h-[2.875rem] sm:w-auto sm:px-8 touch-manipulation"
            onClick={handleSubmit}
            disabled={loading}
          >
            提交
          </button>

          {loading && (
            <div
              className="mt-7 flex items-center gap-3 text-sm text-zinc-600 sm:mt-8"
              role="status"
            >
              <span
                className="inline-flex h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-zinc-300 border-t-violet-600"
                aria-hidden
              />
              <span>思考中...</span>
            </div>
          )}

          {error && !loading && (
            <div
              className="mt-7 rounded-2xl border border-red-200/90 bg-red-50/90 p-4 text-sm leading-relaxed text-red-800 shadow-sm sm:mt-8 sm:p-5 sm:text-[0.9375rem]"
              role="alert"
            >
              {error}
            </div>
          )}

          {(deepseekAnswer || kimiAnswer || fusedAnswer) && !loading && (
            <div className="mt-8 space-y-4">
              <div className="rounded-xl bg-white/70 p-4 backdrop-blur">
                <h3 className="mb-2 font-bold">🧠 DeepSeek</h3>
                <p className="whitespace-pre-wrap">{deepseekAnswer}</p>
              </div>

              <div className="rounded-xl bg-white/70 p-4 backdrop-blur">
                <h3 className="mb-2 font-bold">🌙 Kimi</h3>
                <p className="whitespace-pre-wrap">{kimiAnswer}</p>
              </div>

              <div className="rounded-xl bg-white/75 p-4 backdrop-blur">
                <h3 className="mb-2 font-bold">✨ 融合后的最佳答案</h3>
                <p className="whitespace-pre-wrap">{fusedAnswer}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
