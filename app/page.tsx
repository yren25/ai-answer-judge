"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { clampHistoryTitle } from "@/lib/historyTitle";

/** Bump when replacing file so browsers skip cached PNG / old optimizer output. */
const DEEPSEEK_ICON_SRC = "/brands/deepseek.png?v=5";

type AnswerTab = "fused" | "deepseek" | "kimi" | "qwen";

/** 1 = DeepSeek, 2 = Kimi, 3 = Qwen, 4 = 融合 */
type LoadingStep = 0 | 1 | 2 | 3 | 4;

const STEP_LABELS = [
  "AI 正在分析 DeepSeek...",
  "AI 正在分析 Kimi...",
  "AI 正在分析 Qwen...",
  "AI 正在生成最终答案...",
] as const;

type ChatTurn = {
  id: string;
  userMessage: string;
  status: "loading" | "done" | "error";
  loadingStep: LoadingStep;
  deepseekAnswer: string;
  kimiAnswer: string;
  qwenAnswer: string;
  fusedAnswer: string;
  error: string;
  activeTab: AnswerTab;
};

const FUSED_MODELS = [
  {
    id: "deepseek",
    label: "DeepSeek",
    sub: "深度求索 · 对话",
    icon: DEEPSEEK_ICON_SRC,
    iconBg: "bg-white",
    unoptimized: true as const,
    iconClass: "bg-white object-contain p-1.5",
  },
  {
    id: "kimi",
    label: "Kimi",
    sub: "月之暗面 · 对话",
    icon: "/brands/kimi.png",
    iconBg: "bg-black",
    unoptimized: false as const,
    iconClass: "object-contain p-2",
  },
  {
    id: "qwen",
    label: "Qwen",
    sub: "通义千问 · 对话",
    icon: "/brands/qwen.png",
    iconBg: "bg-white",
    unoptimized: false as const,
    iconClass: "object-contain p-2",
  },
] as const;

const HISTORY_STORAGE_KEY = "btd-chat-history";
const MAX_HISTORY_ITEMS = 80;

type ChatHistoryItem = {
  id: string;
  title: string;
  /** 最近一条用户问题（检索、摘要用；首条亦用于旧版兼容） */
  question: string;
  deepseekAnswer: string;
  kimiAnswer: string;
  qwenAnswer: string;
  fusedAnswer: string;
  createdAt: number;
  /** 同一会话多轮；缺省由 question 与各答案推导单轮 */
  turns?: ChatTurn[];
};

function legacyTurnFromItem(item: ChatHistoryItem): ChatTurn {
  return {
    id: `${item.id}-legacy`,
    userMessage: item.question,
    status: "done",
    loadingStep: 0,
    deepseekAnswer: item.deepseekAnswer,
    kimiAnswer: item.kimiAnswer,
    qwenAnswer: item.qwenAnswer,
    fusedAnswer: item.fusedAnswer,
    error: "",
    activeTab: "fused",
  };
}

/** 线程区自动滚底：忽略仅切换答案来源 tab（activeTab）的更新 */
function threadLayoutSignature(turns: ChatTurn[]): string {
  return turns
    .map((t) =>
      JSON.stringify({
        id: t.id,
        status: t.status,
        userMessage: t.userMessage,
        loadingStep: t.loadingStep,
        error: t.error,
        deepseekAnswer: t.deepseekAnswer,
        kimiAnswer: t.kimiAnswer,
        qwenAnswer: t.qwenAnswer,
        fusedAnswer: t.fusedAnswer,
      }),
    )
    .join("\0");
}

/** 对话正文滚动层：桌面为 #chat-thread-scroll，窄屏为 main 或 window */
function getPreferredChatScrollContainer(): HTMLElement | null {
  const thread = document.getElementById("chat-thread-scroll");
  if (thread && thread.scrollHeight > thread.clientHeight + 2) return thread;
  const mainEl = document.querySelector("main");
  if (
    mainEl instanceof HTMLElement &&
    mainEl.scrollHeight > mainEl.clientHeight + 2
  ) {
    return mainEl;
  }
  return null;
}

/** 将元素滚入可视区（兼容文档滚动或 main / 对话内滚动层） */
function scrollDocumentToElementTop(
  el: HTMLElement,
  marginTop = 0,
  behavior: ScrollBehavior = "auto",
) {
  el.scrollIntoView({ block: "start", behavior });
  if (marginTop > 0) {
    requestAnimationFrame(() => {
      const scroller = getPreferredChatScrollContainer();
      if (scroller) {
        scroller.scrollTop = Math.max(0, scroller.scrollTop - marginTop);
      } else {
        window.scrollBy({ top: -marginTop, behavior: "auto" });
      }
    });
  }
}

function scrollDocumentToBottom(behavior: ScrollBehavior = "smooth") {
  const scroller = getPreferredChatScrollContainer();
  if (scroller) {
    scroller.scrollTo({ top: scroller.scrollHeight, behavior });
    return;
  }
  window.scrollTo({
    top: document.documentElement.scrollHeight,
    behavior,
  });
}

/** 手机窄屏：跟随时滚到输入 dock，避免 scrollHeight 含异常空白导致「猛滑到底」 */
function scrollChatDockIntoView(behavior: ScrollBehavior = "smooth") {
  const dock = document.getElementById("chat-dock");
  if (dock) {
    dock.scrollIntoView({ block: "end", behavior });
    return;
  }
  scrollDocumentToBottom(behavior);
}

function answerPanelForTab(
  tab: AnswerTab,
  turn: ChatTurn,
): { title: string; body: string } {
  switch (tab) {
    case "fused":
      return { title: "✨ 融合后的最佳答案", body: turn.fusedAnswer };
    case "deepseek":
      return { title: "DeepSeek 原始回答", body: turn.deepseekAnswer };
    case "kimi":
      return { title: "Kimi 原始回答", body: turn.kimiAnswer };
    default:
      return { title: "Qwen 原始回答", body: turn.qwenAnswer };
  }
}

const ANSWER_TABS: AnswerTab[] = ["fused", "deepseek", "kimi", "qwen"];

/** 历史会话：各轮各 tab 仅直接展示全文，不重复生成动效 */
function markAnswerRevealKeysForHistory(turns: ChatTurn[], into: Set<string>) {
  for (const turn of turns) {
    if (turn.status !== "done") continue;
    for (const tab of ANSWER_TABS) {
      const { body } = answerPanelForTab(tab, turn);
      if (body.length > 0) into.add(`${turn.id}-${tab}`);
    }
  }
}

/** 答案正文渐进显示（完成态）；减少动效时一次展示全文 */
function AnswerBodyStream({
  text,
  revealKey,
  isDark,
  onRevealConsumed,
}: {
  text: string;
  revealKey: string;
  isDark: boolean;
  onRevealConsumed: (key: string) => void;
}) {
  const [shown, setShown] = useState(0);
  const consumedRef = useRef(false);

  const fireConsumed = useCallback(() => {
    if (consumedRef.current) return;
    consumedRef.current = true;
    onRevealConsumed(revealKey);
  }, [onRevealConsumed, revealKey]);

  useEffect(() => {
    return () => {
      if (consumedRef.current) return;
      consumedRef.current = true;
      onRevealConsumed(revealKey);
    };
  }, [revealKey, onRevealConsumed]);

  useEffect(() => {
    const full = text ?? "";
    setShown(0);
    if (!full) {
      fireConsumed();
      return;
    }

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) {
      setShown(full.length);
      fireConsumed();
      return;
    }

    const perMs = 16;
    const maxMs = 14000;
    const minMs = 480;
    const duration = Math.min(maxMs, Math.max(minMs, full.length * perMs));
    const start = performance.now();
    let raf = 0;
    let cancelled = false;

    const tick = (now: number) => {
      if (cancelled) return;
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 2.4;
      const next = Math.min(full.length, Math.floor(full.length * eased));
      setShown(next);
      if (t < 1) raf = requestAnimationFrame(tick);
      else {
        setShown(full.length);
        fireConsumed();
      }
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [text, revealKey, fireConsumed]);

  const full = text ?? "";
  const slice = full.slice(0, shown);
  const streaming = shown < full.length;

  return (
    <p
      className={`relative z-0 whitespace-pre-wrap break-words text-sm font-normal leading-[1.8] ${
        isDark ? "text-zinc-200" : "text-zinc-800"
      }`}
    >
      {slice}
      {streaming ? (
        <span
          className={`ml-0.5 inline-block h-[1em] w-px translate-y-px align-text-bottom motion-safe:animate-pulse ${
            isDark ? "bg-violet-400/85" : "bg-violet-600/75"
          }`}
          aria-hidden
        />
      ) : null}
    </p>
  );
}

/** 融合 → DeepSeek → Kimi → Qwen：切到右侧来源时自右滑入，反之自左滑入 */
const ANSWER_TAB_AXIS_ORDER: Record<AnswerTab, number> = {
  fused: 0,
  deepseek: 1,
  kimi: 2,
  qwen: 3,
};

function AnswerPanelTabSwitch({
  activeTab,
  children,
}: {
  activeTab: AnswerTab;
  children: ReactNode;
}) {
  const prevOrderRef = useRef<number | null>(null);
  const o = ANSWER_TAB_AXIS_ORDER[activeTab];
  const p = prevOrderRef.current;
  let slideClass = "";
  if (p !== null && p !== o) {
    slideClass =
      o > p ? "answer-source-from-right" : "answer-source-from-left";
  }
  useLayoutEffect(() => {
    prevOrderRef.current = o;
  }, [o]);

  return (
    <div className="min-w-0 overflow-x-hidden">
      <div key={activeTab} className={`min-w-0 ${slideClass}`}>
        {children}
      </div>
    </div>
  );
}

function parseStoredTurns(raw: unknown): ChatTurn[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: ChatTurn[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") return undefined;
    const t = row as Record<string, unknown>;
    if (typeof t.id !== "string" || typeof t.userMessage !== "string")
      return undefined;
    const st = t.status;
    if (st !== "loading" && st !== "done" && st !== "error") return undefined;
    const at = t.activeTab;
    const activeTab: AnswerTab =
      at === "deepseek" || at === "kimi" || at === "qwen" ? at : "fused";
    const ls = t.loadingStep;
    out.push({
      id: t.id,
      userMessage: t.userMessage,
      status: st,
      loadingStep:
        ls === 0 || ls === 1 || ls === 2 || ls === 3 || ls === 4 ? ls : 0,
      deepseekAnswer:
        typeof t.deepseekAnswer === "string" ? t.deepseekAnswer : "",
      kimiAnswer: typeof t.kimiAnswer === "string" ? t.kimiAnswer : "",
      qwenAnswer: typeof t.qwenAnswer === "string" ? t.qwenAnswer : "",
      fusedAnswer: typeof t.fusedAnswer === "string" ? t.fusedAnswer : "",
      error: typeof t.error === "string" ? t.error : "",
      activeTab,
    });
  }
  return out.length > 0 ? out : undefined;
}

function IconSearch(props: { className?: string }) {
  return (
    <svg
      className={props.className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 21l-4.3-4.3M10.5 18a7.5 7.5 0 110-15 7.5 7.5 0 010 15z"
      />
    </svg>
  );
}

function IconPlus(props: { className?: string }) {
  return (
    <svg
      className={props.className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path strokeLinecap="round" d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** 缩小侧栏：向左收起 */
function IconChevronLeft(props: { className?: string }) {
  return (
    <svg
      className={props.className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
    </svg>
  );
}

/** 展开侧栏 */
function IconChevronRight(props: { className?: string }) {
  return (
    <svg
      className={props.className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6-6-6" />
    </svg>
  );
}

/** 展开历史侧栏（手机端） */
function IconMenu(props: { className?: string }) {
  return (
    <svg
      className={props.className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function IconMic(props: { className?: string }) {
  return (
    <svg
      className={props.className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 14a3 3 0 003-3V6a3 3 0 10-6 0v5a3 3 0 003 3z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19 11a7 7 0 01-14 0M12 18v3"
      />
    </svg>
  );
}

function IconSend(props: { className?: string }) {
  return (
    <svg
      className={props.className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 12h14m0 0l-6-6m6 6l-6 6"
      />
    </svg>
  );
}

/** 浅色模式：点击后切换为深色 */
function IconMoon(props: { className?: string }) {
  return (
    <svg
      className={props.className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 14.5A8.5 8.5 0 018.5 3a8.46 8.46 0 00-1.2.08 7 7 0 109.24 9.24c.036-.4.055-.806.055-1.22 0-.43-.02-.855-.06-1.27z"
      />
    </svg>
  );
}

/** 深色模式：点击后切换为浅色 */
function IconSun(props: { className?: string }) {
  return (
    <svg
      className={props.className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden
    >
      <circle cx="12" cy="12" r="4" />
      <path
        strokeLinecap="round"
        d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
      />
    </svg>
  );
}

/** 本地时段问候（仅未进入对话时的欢迎页展示） — 文字与 emoji 分开渲染，避免主字体无彩色 emoji 时符号丢失 */
type WelcomeHeading = { text: string; emoji: string };

function welcomeHeadingFromLocalHour(hour: number): WelcomeHeading {
  if (hour >= 5 && hour < 12) return { text: "上午好", emoji: "🌅" };
  if (hour >= 12 && hour < 14) return { text: "中午好", emoji: "☀️" };
  if (hour >= 14 && hour < 18) return { text: "下午好", emoji: "🌤️" };
  return { text: "晚上好", emoji: "🌙" };
}

const WELCOME_EMOJI_FONT =
  'ui-emoji, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", sans-serif';

/**
 * 与桌面 `sm:px-8` 对齐的主栏水平内边距：全宽度下统一为 1rem + safe-area。
 */
const SHELL_PAD_X =
  "pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))] sm:pl-8 sm:pr-8";



/** 侧栏抽屉滑入滑出、遮罩、桌面主栏 margin：共用时长与曲线 */
const MOBILE_DRAWER_EASE =
  "duration-[350ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none";

export default function Home() {
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([]);
  const [welcomeHeading, setWelcomeHeading] = useState<WelcomeHeading | null>(
    null,
  );
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [chatHistory, setChatHistory] = useState<ChatHistoryItem[]>([]);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  const activeHistoryIdRef = useRef<string | null>(null);
  const chatHistoryRef = useRef<ChatHistoryItem[]>([]);
  const openHistoryScrollPendingRef = useRef(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  /** viewports under Tailwind `sm` (640px): icon rail + full drawer when expanded */
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  /** 已进入对话流：居中欢迎页 + 大输入 → 线程 + 底部输入条 */
  const [chatSessionActive, setChatSessionActive] = useState(false);
  const [chatDockEntered, setChatDockEntered] = useState(false);
  const questionTextareaRef = useRef<HTMLTextAreaElement>(null);
  const threadLayoutSigRef = useRef<string | null>(null);
  /** 用户刚发送的新一轮：layout 后把该轮用户问题滚到视口顶部附近 */
  const pendingNewQuestionScrollIdRef = useRef<string | null>(null);
  /** 每个 turn × tab 的答案动效只播放一次；历史会话预填充不设动效 */
  const answerRevealSeenRef = useRef<Set<string>>(new Set());
  const [, setAnswerRevealTick] = useState(0);
  const markAnswerRevealConsumed = useCallback((key: string) => {
    answerRevealSeenRef.current.add(key);
    setAnswerRevealTick((n) => n + 1);
  }, []);

  useEffect(() => {
    activeHistoryIdRef.current = activeHistoryId;
  }, [activeHistoryId]);

  useEffect(() => {
    chatHistoryRef.current = chatHistory;
  }, [chatHistory]);

  const turnInFlight = useMemo(
    () => chatTurns.some((t) => t.status === "loading"),
    [chatTurns],
  );

  const fitQuestionTextareaHeight = useCallback(() => {
    const el = questionTextareaRef.current;
    if (!el) return;
    const cs = window.getComputedStyle(el);
    const linePx = parseFloat(cs.lineHeight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const minRows = chatSessionActive ? 1 : 2;
    const minH =
      (Number.isFinite(linePx) ? linePx : 22.5) * minRows +
      (Number.isFinite(padY) ? padY : 24);
    const maxH = Math.min(window.innerHeight * 0.4, 16 * 16);
    el.style.height = "auto";
    const sh = el.scrollHeight;
    const next = Math.min(Math.max(sh, minH), maxH);
    el.style.height = `${next}px`;
    el.style.overflowY = next >= maxH - 1 ? "auto" : "hidden";
  }, [chatSessionActive]);

  useEffect(() => {
    if (!chatSessionActive) return;
    const sig = threadLayoutSignature(chatTurns);

    if (openHistoryScrollPendingRef.current) {
      openHistoryScrollPendingRef.current = false;
      threadLayoutSigRef.current = sig;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const lastTurn = chatTurns[chatTurns.length - 1];
          if (!lastTurn) {
            window.scrollTo({ top: 0, behavior: "auto" });
            return;
          }
          const anchor = document.getElementById(
            `thread-user-anchor-${lastTurn.id}`,
          );
          if (anchor) {
            scrollDocumentToElementTop(anchor, 10);
            return;
          }
          if (isMobileLayout) scrollChatDockIntoView("auto");
          else scrollDocumentToBottom("auto");
        });
      });
      return;
    }

    /* 生成过程中与完成后均不自动滚到底：用户留在当前问题附近，可自行下滚查看答案 */
    if (threadLayoutSigRef.current === sig) return;
    threadLayoutSigRef.current = sig;
  }, [chatTurns, chatSessionActive, isMobileLayout]);

  useLayoutEffect(() => {
    if (!chatSessionActive) return;
    const id = pendingNewQuestionScrollIdRef.current;
    if (!id) return;
    pendingNewQuestionScrollIdRef.current = null;
    const anchor = document.getElementById(`thread-user-anchor-${id}`);
    if (!anchor) return;
    scrollDocumentToElementTop(anchor, 0, "smooth");
  }, [chatTurns, chatSessionActive]);

  useEffect(() => {
    fitQuestionTextareaHeight();
  }, [question, fitQuestionTextareaHeight]);

  useEffect(() => {
    fitQuestionTextareaHeight();
  }, [chatSessionActive, fitQuestionTextareaHeight]);

  useEffect(() => {
    window.addEventListener("resize", fitQuestionTextareaHeight);
    return () => window.removeEventListener("resize", fitQuestionTextareaHeight);
  }, [fitQuestionTextareaHeight]);

  useEffect(() => {
    if (!chatSessionActive) {
      setChatDockEntered(false);
      return;
    }
    setChatDockEntered(false);
    const id = window.requestAnimationFrame(() => setChatDockEntered(true));
    return () => cancelAnimationFrame(id);
  }, [chatSessionActive]);

  useLayoutEffect(() => {
    if (typeof window === "undefined" || chatSessionActive) return;
    setWelcomeHeading(welcomeHeadingFromLocalHour(new Date().getHours()));
  }, [chatSessionActive]);

  const persistSidebarCollapsed = (collapsed: boolean) => {
    try {
      localStorage.setItem("btd-sidebar-collapsed", collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem("btd-theme");
      if (saved === "light" || saved === "dark") setTheme(saved);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("btd-theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const apply = () => {
      const narrow = mq.matches;
      setIsMobileLayout(narrow);
      if (narrow) {
        setSidebarCollapsed(true);
      } else {
        try {
          setSidebarCollapsed(
            localStorage.getItem("btd-sidebar-collapsed") === "1",
          );
        } catch {
          setSidebarCollapsed(false);
        }
      }
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as unknown;
      if (!Array.isArray(data)) return;
      const next: ChatHistoryItem[] = [];
      for (const row of data) {
        if (!row || typeof row !== "object") continue;
        const o = row as Record<string, unknown>;
        if (
          typeof o.id === "string" &&
          typeof o.title === "string" &&
          typeof o.question === "string" &&
          typeof o.deepseekAnswer === "string" &&
          typeof o.kimiAnswer === "string" &&
          typeof o.fusedAnswer === "string" &&
          typeof o.createdAt === "number"
        ) {
          const turns = parseStoredTurns(o.turns);
          next.push({
            id: o.id,
            title: clampHistoryTitle(o.title, 10),
            question: o.question,
            deepseekAnswer: o.deepseekAnswer,
            kimiAnswer: o.kimiAnswer,
            qwenAnswer:
              typeof o.qwenAnswer === "string" ? o.qwenAnswer : "",
            fusedAnswer: o.fusedAnswer,
            createdAt: o.createdAt,
            ...(turns ? { turns } : {}),
          });
        }
      }
      setChatHistory(next.slice(0, MAX_HISTORY_ITEMS));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(chatHistory));
    } catch {
      /* ignore */
    }
  }, [chatHistory]);

  const mobileDrawerOpen = isMobileLayout && !sidebarCollapsed;
  const desktopChatLayout = chatSessionActive && !isMobileLayout;
  /** 手机端统一：侧栏为滑出抽屉，主区全宽 + 左上角 FAB（欢迎与对话相同） */
  const mobileImmersiveShell = isMobileLayout;
  /**
   * 桌面：侧栏 fixed，主区须同时设置 margin-left 与 width: calc(100% - 侧栏宽)，
   * 否则 w-full + ml 会横向溢出，滚动/滚轮只在窄条上生效。
   */
  const mainSidebarLayout = isMobileLayout
    ? "w-full"
    : sidebarCollapsed
      ? "w-full sm:ml-16 sm:w-[calc(100%-4rem)] sm:max-w-none"
      : "w-full sm:ml-[min(16rem,max(12rem,14.285714vw))] sm:w-[calc(100%-min(16rem,max(12rem,14.285714vw)))] sm:max-w-none";
  /** 手机 + 对话：main 滚动；桌面 + 对话：main 定高裁切，仅线程区滚动，输入 dock 固定在主列底 */
  const mainHeightAndScroll =
    isMobileLayout && chatSessionActive
      ? "min-h-0 max-h-dvh overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]"
      : desktopChatLayout
        ? "min-h-dvh sm:min-h-0 sm:h-dvh sm:max-h-dvh sm:overflow-hidden"
        : "min-h-dvh sm:min-h-screen";
  /** 桌面：侧栏 fixed 下壳层不参与命中，滚轮穿过空白区滚动文档；可点/可滚区域单独打开 */
  const sidebarInteractPointer =
    !mobileImmersiveShell ? "pointer-events-auto" : "";
  const [fabPlusPop, setFabPlusPop] = useState(false);
  const [fabMenuArm, setFabMenuArm] = useState(false);

  useEffect(() => {
    if (!mobileDrawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileDrawerOpen]);

  const filteredHistory = useMemo(() => {
    const needle = historyQuery.trim().toLowerCase();
    if (!needle) return chatHistory;
    return chatHistory.filter((h) => {
      if (
        h.title.toLowerCase().includes(needle) ||
        h.question.toLowerCase().includes(needle)
      ) {
        return true;
      }
      return (
        h.turns?.some((t) =>
          t.userMessage.toLowerCase().includes(needle),
        ) ?? false
      );
    });
  }, [chatHistory, historyQuery]);

  const startNewChat = () => {
    setQuestion("");
    setChatSessionActive(false);
    setChatTurns([]);
    setActiveHistoryId(null);
    setError("");
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 639px)").matches
    ) {
      setSidebarCollapsed(true);
      persistSidebarCollapsed(true);
    }
  };

  const applyHistoryItem = (item: ChatHistoryItem) => {
    setQuestion("");
    setChatSessionActive(true);
    const raw =
      item.turns && item.turns.length > 0
        ? item.turns
        : [legacyTurnFromItem(item)];
    markAnswerRevealKeysForHistory(raw, answerRevealSeenRef.current);
    setAnswerRevealTick((n) => n + 1);
    openHistoryScrollPendingRef.current = true;
    setChatTurns(raw.map((t) => ({ ...t })));
    setActiveHistoryId(item.id);
    setError("");
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 639px)").matches
    ) {
      setSidebarCollapsed(true);
      persistSidebarCollapsed(true);
    }
  };

  const patchTurn = useCallback((turnId: string, patch: Partial<ChatTurn>) => {
    setChatTurns((prev) =>
      prev.map((t) => (t.id === turnId ? { ...t, ...patch } : t)),
    );
  }, []);

  const handleSubmit = async () => {
    const q = question.trim();
    if (!q) {
      setError("请先输入问题。");
      return;
    }

    const turnId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `t-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const newTurn: ChatTurn = {
      id: turnId,
      userMessage: q,
      status: "loading",
      loadingStep: 1,
      deepseekAnswer: "",
      kimiAnswer: "",
      qwenAnswer: "",
      fusedAnswer: "",
      error: "",
      activeTab: "fused",
    };

    setChatSessionActive(true);
    pendingNewQuestionScrollIdRef.current = turnId;
    setChatTurns((prev) => [...prev, newTurn]);
    setQuestion("");
    setError("");

    try {
      const deepseekRes = await fetch("/api/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ question: q }),
      });
      const deepseekData = (await deepseekRes.json()) as {
        answer?: string;
        error?: string;
      };
      if (!deepseekRes.ok) {
        throw new Error(deepseekData.error || "DeepSeek 请求失败");
      }
      const deepseekText = deepseekData.answer?.trim() || "无返回";
      patchTurn(turnId, { deepseekAnswer: deepseekText, loadingStep: 2 });

      const kimiRes = await fetch("/api/kimi", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ question: q }),
      });
      const kimiData = (await kimiRes.json()) as {
        answer?: string;
        error?: string;
      };
      if (!kimiRes.ok) {
        throw new Error(kimiData.error || "Kimi 请求失败");
      }
      const kimiText = kimiData.answer?.trim() || "无返回";
      patchTurn(turnId, { kimiAnswer: kimiText, loadingStep: 3 });

      const qwenRes = await fetch("/api/qwen", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ question: q }),
      });
      const qwenData = (await qwenRes.json()) as {
        answer?: string;
        error?: string;
      };
      if (!qwenRes.ok) {
        throw new Error(qwenData.error || "Qwen 请求失败");
      }
      const qwenText = qwenData.answer?.trim() || "无返回";
      patchTurn(turnId, { qwenAnswer: qwenText, loadingStep: 4 });

      const fuseRes = await fetch("/api/fuse", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: q,
          deepseekAnswer: deepseekText,
          kimiAnswer: kimiText,
          qwenAnswer: qwenText,
        }),
      });

      const fuseData = (await fuseRes.json()) as {
        fusedAnswer?: string;
        error?: string;
      };

      if (!fuseRes.ok) {
        throw new Error(fuseData.error || "融合失败，请稍后重试");
      }

      const fusedText = fuseData.fusedAnswer?.trim() || "暂无融合结果";

      patchTurn(turnId, {
        fusedAnswer: fusedText,
        status: "done",
        loadingStep: 0,
      });

      const completedTurn: ChatTurn = {
        id: turnId,
        userMessage: q,
        status: "done",
        loadingStep: 0,
        deepseekAnswer: deepseekText,
        kimiAnswer: kimiText,
        qwenAnswer: qwenText,
        fusedAnswer: fusedText,
        error: "",
        activeTab: "fused",
      };

      const prevHist = chatHistoryRef.current;
      const curActive = activeHistoryIdRef.current;

      let mergedIntoSession = false;
      if (curActive) {
        const idx = prevHist.findIndex((h) => h.id === curActive);
        if (idx !== -1) {
          const cur = prevHist[idx];
          const baseTurns =
            cur.turns && cur.turns.length > 0
              ? cur.turns
              : [legacyTurnFromItem(cur)];
          const turns = [...baseTurns, completedTurn];
          const updated: ChatHistoryItem = {
            ...cur,
            turns,
            question: q,
            deepseekAnswer: deepseekText,
            kimiAnswer: kimiText,
            qwenAnswer: qwenText,
            fusedAnswer: fusedText,
          };
          setChatHistory(
            [updated, ...prevHist.filter((_, j) => j !== idx)].slice(
              0,
              MAX_HISTORY_ITEMS,
            ),
          );
          setActiveHistoryId(curActive);
          mergedIntoSession = true;
        }
      }

      if (!mergedIntoSession) {
        let historyTitle = clampHistoryTitle(q, 10);
        try {
          const titleRes = await fetch("/api/summarize-title", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: q }),
          });
          if (titleRes.ok) {
            const titleData = (await titleRes.json()) as { title?: string };
            if (typeof titleData.title === "string") {
              historyTitle = clampHistoryTitle(titleData.title, 10);
            }
          }
        } catch {
          /* 使用上述截取标题 */
        }

        const historyId =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `h-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

        const newItem: ChatHistoryItem = {
          id: historyId,
          title: historyTitle,
          question: q,
          deepseekAnswer: deepseekText,
          kimiAnswer: kimiText,
          qwenAnswer: qwenText,
          fusedAnswer: fusedText,
          createdAt: Date.now(),
          turns: [completedTurn],
        };

        setChatHistory(
          [newItem, ...prevHist].slice(0, MAX_HISTORY_ITEMS),
        );
        setActiveHistoryId(historyId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "请求失败，请稍后再试";
      patchTurn(turnId, {
        status: "error",
        error: message,
        loadingStep: 0,
      });
    }
  };

  const canSend = question.trim().length > 0 && !turnInFlight;
  const isDark = theme === "dark";

  const tabInactive = isDark
    ? "shadow-[0_10px_28px_-8px_rgba(0,0,0,0.6)] ring-1 ring-white/[0.08] hover:ring-white/[0.14] hover:brightness-105"
    : "shadow-[0_8px_22px_-6px_rgba(15,23,42,0.1)] ring-1 ring-zinc-900/12 hover:ring-zinc-900/20";
  const tabActive = isDark
    ? "z-10 shadow-[0_0_14px_rgba(232,234,242,0.26),0_0_32px_rgba(232,234,242,0.09),0_12px_32px_-12px_rgba(0,0,0,0.58)] brightness-[1.04] drop-shadow-[0_0_10px_rgba(232,234,242,0.22)]"
    : "z-10 shadow-[0_0_22px_rgba(109,40,217,0.2),0_0_40px_rgba(99,102,241,0.1),0_12px_28px_-8px_rgba(15,23,42,0.12)] brightness-[1.02] drop-shadow-[0_0_12px_rgba(91,33,182,0.22)]";
  const tabFocus =
    "focus-visible:ring-2 focus-visible:ring-violet-400/45 focus-visible:ring-offset-2";

  return (
    <div
      className={`relative min-h-dvh w-full min-w-0 ${
        isDark
          ? "bg-zinc-950 text-zinc-100"
          : "bg-gradient-to-b from-violet-50/90 via-zinc-50 to-blue-50/90 text-zinc-900"
      }`}
    >
      <aside
        className={`flex min-h-0 flex-col overflow-hidden border-r py-2.5 text-[11px] leading-snug sm:py-3 sm:text-xs ${
          !mobileImmersiveShell ? "pointer-events-none" : ""
        } ${
          mobileImmersiveShell
            ? `fixed inset-y-0 left-0 z-[60] h-dvh w-[min(18rem,100vw)] shadow-2xl will-change-transform transition-transform ${MOBILE_DRAWER_EASE} ${
                sidebarCollapsed
                  ? "-translate-x-full pointer-events-none"
                  : "translate-x-0"
              } ${sidebarCollapsed ? "pl-3 pr-2" : "px-5 sm:px-6"}`
            : `fixed top-0 left-0 z-10 h-dvh shrink-0 overflow-x-hidden transition-[width,min-width,max-width] ${MOBILE_DRAWER_EASE} ${
                sidebarCollapsed
                  ? "pl-3 pr-2 sm:pl-4 sm:pr-2.5"
                  : "px-5 sm:px-6"
              } ${
                sidebarCollapsed
                  ? "w-14 sm:w-16"
                  : "min-w-[12rem] w-[14.285714%] max-w-[16rem]"
              }`
        } ${
          isDark
            ? "border-zinc-800 bg-zinc-900/98 text-zinc-100/92"
            : "border-zinc-200/90 bg-white/95 text-zinc-700"
        }`}
        aria-label="历史对话"
      >
        {/* 品牌 + 缩小边栏 */}
        <div
          className={`flex shrink-0 items-center gap-2 py-2.5 sm:py-3 ${sidebarInteractPointer} ${
            sidebarCollapsed ? "justify-center" : "justify-between"
          }`}
        >
          {!sidebarCollapsed ? (
            <span
              className={`min-w-0 truncate font-semibold tracking-tight ${
                isDark ? "text-zinc-100" : "text-zinc-900"
              } sm:text-[13px]`}
            >
              bTd包打听
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setSidebarCollapsed((c) => {
                const next = !c;
                persistSidebarCollapsed(next);
                return next;
              });
            }}
            title={sidebarCollapsed ? "展开边栏" : "缩小边栏"}
            aria-label={sidebarCollapsed ? "展开边栏" : "缩小边栏"}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-zinc-400/40 focus-visible:ring-offset-1 ${
              isDark
                ? "text-zinc-200/90 ring-offset-zinc-900 hover:bg-zinc-800/80 hover:text-zinc-50"
                : "text-zinc-700 ring-offset-white hover:bg-zinc-200/70 hover:text-zinc-900"
            }`}
          >
            {sidebarCollapsed ? (
              <IconChevronRight className="h-4 w-4" />
            ) : (
              <IconChevronLeft className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* 新对话 + 查询 */}
        {!sidebarCollapsed ? (
        <div
          className={`mb-4 shrink-0 flex flex-col gap-2 sm:mb-5 sm:gap-2.5 ${sidebarInteractPointer}`}
        >
            <button
              type="button"
              onClick={startNewChat}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-zinc-400/40 focus-visible:ring-offset-1 ${
                isDark
                  ? "bg-transparent text-zinc-100/95 ring-offset-zinc-900 hover:bg-zinc-800/35"
                  : "bg-transparent text-zinc-800 ring-offset-white hover:bg-zinc-200/50"
              }`}
            >
              <IconPlus className="h-3.5 w-3.5 shrink-0 opacity-95" />
              新对话
            </button>
            <div className="relative">
              <IconSearch
                className={`pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 ${
                  isDark ? "text-zinc-400" : "text-zinc-500"
                }`}
              />
              <input
                type="search"
                value={historyQuery}
                onChange={(e) => setHistoryQuery(e.target.value)}
                placeholder="查询对话…"
                aria-label="查询对话"
                className={`w-full rounded-lg py-2 pl-7 pr-2 text-[11px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-zinc-400/35 sm:text-xs ${
                  isDark
                    ? "bg-transparent text-zinc-100/92 placeholder:text-zinc-500"
                    : "bg-transparent text-zinc-800 placeholder:text-zinc-400"
                }`}
              />
            </div>
        </div>
        ) : (
          <div
            className={`flex flex-col items-center gap-1.5 pb-2 ${sidebarInteractPointer}`}
          >
            <button
              type="button"
              onClick={startNewChat}
              title="新对话"
              aria-label="新对话"
              className={`flex h-9 w-9 items-center justify-center rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-zinc-400/40 focus-visible:ring-offset-1 ${
                isDark
                  ? "bg-transparent text-zinc-100/95 ring-offset-zinc-900 hover:bg-zinc-800/35"
                  : "bg-transparent text-zinc-800 ring-offset-white hover:bg-zinc-200/50"
              }`}
            >
              <IconPlus className="h-4 w-4 shrink-0 opacity-95" />
            </button>
          </div>
        )}

        {/* 历史记录 */}
        {!sidebarCollapsed ? (
        <div
          className={`mb-2 flex min-h-0 flex-1 flex-col overflow-hidden sm:mb-3 ${sidebarInteractPointer}`}
        >
          <div
            className={`shrink-0 pb-2 pt-3 text-[10px] font-medium uppercase tracking-wider sm:text-[11px] ${
              isDark ? "text-zinc-200/88" : "text-zinc-600"
            }`}
          >
            历史记录
          </div>
          <nav className="min-h-0 flex-1 overflow-y-auto px-0 pb-3">
            <ul className="space-y-0.5">
              {filteredHistory.length === 0 ? (
                <li
                  className={`px-2 py-5 text-center text-[11px] sm:text-xs ${
                    isDark ? "text-zinc-400" : "text-zinc-600"
                  }`}
                >
                  {chatHistory.length === 0
                    ? "暂无记录，发起新对话吧"
                    : "没有匹配的对话"}
                </li>
              ) : (
                filteredHistory.map((item) => {
                  const active = item.id === activeHistoryId;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => applyHistoryItem(item)}
                        title={item.question}
                        className={`w-full rounded-lg px-2 py-2 text-left text-[11px] leading-snug outline-none transition-colors focus-visible:ring-2 focus-visible:ring-zinc-400/30 sm:text-xs ${
                          active
                            ? isDark
                              ? "bg-zinc-800 text-zinc-100"
                              : "bg-zinc-300 text-zinc-900"
                            : isDark
                              ? "bg-transparent text-zinc-200/90 hover:bg-zinc-800/50"
                              : "bg-transparent text-zinc-700 hover:bg-zinc-200/70"
                        }`}
                      >
                        <span className="line-clamp-2 break-all">{item.title}</span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </nav>
        </div>
        ) : null}
      </aside>
      {isMobileLayout ? (
        <button
          type="button"
          aria-label="关闭侧栏"
          aria-hidden={!mobileDrawerOpen}
          tabIndex={mobileDrawerOpen ? 0 : -1}
          className={`fixed inset-0 z-[55] bg-black/45 sm:hidden transition-[opacity] ${MOBILE_DRAWER_EASE} ${
            mobileDrawerOpen
              ? "pointer-events-auto opacity-100"
              : "pointer-events-none opacity-0"
          }`}
          onClick={() => {
            setSidebarCollapsed(true);
            persistSidebarCollapsed(true);
          }}
        />
      ) : null}
      <main
        className={`relative z-20 flex min-w-0 flex-col ${mainHeightAndScroll} ${mainSidebarLayout} ${
          mobileDrawerOpen ? "hidden" : ""
        } ${isMobileLayout ? "overflow-x-hidden" : ""} ${
          !isMobileLayout
            ? `transition-[margin-left,width] ${MOBILE_DRAWER_EASE}`
            : ""
        }`}
      >
      {isMobileLayout && !mobileDrawerOpen ? (
        <header className="sticky top-0 z-[95] relative isolate flex w-full shrink-0 items-center justify-between gap-2 pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))] pt-[max(1rem,env(safe-area-inset-top,0px))] pb-2 sm:hidden">
          <div
            aria-hidden
            className={`pointer-events-none absolute inset-0 -z-10 ${
              isDark ? "bg-zinc-950" : "bg-gradient-to-b from-violet-50/95 via-zinc-50 to-zinc-50"
            }`}
          />
          <div
            aria-hidden
            className={`pointer-events-none absolute inset-0 -z-10 ${
              isDark
                ? "bg-[radial-gradient(ellipse_125%_85%_at_50%_-20%,rgba(99,102,241,0.06)_0%,rgba(59,130,246,0.032)_32%,rgba(37,99,235,0.015)_52%,transparent_72%)]"
                : "bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(99,102,241,0.09)_0%,rgba(59,130,246,0.05)_38%,rgba(96,165,250,0.028)_55%,transparent_76%)]"
            }`}
          />
          <div className="relative z-10 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setFabPlusPop(true);
                window.setTimeout(() => setFabPlusPop(false), 420);
                startNewChat();
              }}
              title="新对话"
              aria-label="新对话"
              className={`flex h-10 w-10 shrink-0 origin-center items-center justify-center rounded-xl border shadow-md outline-none transition-[background-color,box-shadow,transform] duration-[420ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] focus-visible:ring-2 focus-visible:ring-violet-500/50 focus-visible:ring-offset-2 touch-manipulation motion-reduce:duration-200 motion-reduce:ease-out ${
                fabPlusPop
                  ? "scale-[1.14] shadow-lg sm:scale-100 sm:shadow-md"
                  : "scale-100 active:scale-95"
              } ${
                isDark
                  ? "border-zinc-700 bg-zinc-900/92 text-zinc-100 shadow-black/30 backdrop-blur-xl hover:bg-zinc-800"
                  : "border-zinc-300/80 bg-white/92 text-zinc-800 shadow-zinc-900/8 backdrop-blur-xl hover:bg-white"
              } ${
                isDark
                  ? "focus-visible:ring-offset-zinc-950"
                  : "focus-visible:ring-offset-violet-50"
              }`}
            >
              <IconPlus
                className={`h-5 w-5 transition-transform duration-[420ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:transition-none ${
                  fabPlusPop ? "scale-110 sm:scale-100" : ""
                }`}
              />
            </button>
            <button
              type="button"
              onClick={() => {
                setFabMenuArm(true);
                window.setTimeout(() => setFabMenuArm(false), 280);
                setSidebarCollapsed(false);
              }}
              title="历史对话"
              aria-label="打开历史对话"
              className={`flex h-10 w-10 shrink-0 origin-center items-center justify-center rounded-xl border shadow-md outline-none transition-[background-color,box-shadow,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:ring-2 focus-visible:ring-violet-500/50 focus-visible:ring-offset-2 touch-manipulation motion-reduce:transition-none ${
                fabMenuArm
                  ? "translate-x-0.5 scale-[0.92] sm:translate-x-0 sm:scale-100"
                  : "active:scale-95"
              } ${
                isDark
                  ? "border-zinc-700 bg-zinc-900/92 text-zinc-100 shadow-black/30 backdrop-blur-xl hover:bg-zinc-800"
                  : "border-zinc-300/80 bg-white/92 text-zinc-800 shadow-zinc-900/8 backdrop-blur-xl hover:bg-white"
              } ${
                isDark
                  ? "focus-visible:ring-offset-zinc-950"
                  : "focus-visible:ring-offset-violet-50"
              }`}
            >
              <IconMenu
                className={`h-5 w-5 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
                  fabMenuArm ? "translate-x-px sm:translate-x-0" : ""
                }`}
              />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setTheme(isDark ? "light" : "dark")}
            className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border outline-none transition-[background-color,box-shadow,color] focus-visible:ring-2 focus-visible:ring-violet-500/50 focus-visible:ring-offset-2 active:scale-95 touch-manipulation ${
              isDark
                ? "border-zinc-700 bg-zinc-900/95 text-amber-200 shadow-md shadow-black/30 hover:bg-zinc-800 hover:text-amber-100"
                : "border-zinc-300/80 bg-white/95 text-zinc-700 shadow-md shadow-violet-900/10 hover:bg-zinc-50"
            } ${
              isDark
                ? "focus-visible:ring-offset-zinc-950"
                : "focus-visible:ring-offset-violet-50"
            }`}
            aria-label={isDark ? "切换为浅色主题" : "切换为深色主题"}
            title={isDark ? "浅色模式" : "深色模式"}
          >
            {isDark ? (
              <IconSun className="h-5 w-5" />
            ) : (
              <IconMoon className="h-5 w-5" />
            )}
          </button>
        </header>
      ) : null}
      <div
        className={
          isDark
            ? "pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_125%_85%_at_50%_-20%,rgba(99,102,241,0.06)_0%,rgba(59,130,246,0.032)_32%,rgba(37,99,235,0.015)_52%,transparent_72%)]"
            : "pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(99,102,241,0.09)_0%,rgba(59,130,246,0.05)_38%,rgba(96,165,250,0.028)_55%,transparent_76%)]"
        }
        aria-hidden
      />
      <div
        className={
          isDark
            ? "pointer-events-none absolute bottom-0 left-1/2 h-[min(48vh,30rem)] w-[min(160%,90rem)] max-w-none -translate-x-1/2 bg-[radial-gradient(ellipse_80%_50%_at_50%_110%,rgba(109,40,217,0.22),transparent)]"
            : "pointer-events-none absolute bottom-0 left-1/2 h-[min(44vh,28rem)] w-[min(150%,80rem)] max-w-none -translate-x-1/2 bg-[radial-gradient(ellipse_80%_50%_at_50%_108%,rgba(109,40,217,0.12),transparent)]"
        }
        aria-hidden
      />

      {!chatSessionActive ? (
      <div
        className={`relative z-10 mx-auto flex w-full min-w-0 max-w-3xl flex-col max-sm:max-w-none max-sm:flex-1 max-sm:min-h-0 max-sm:items-stretch max-sm:justify-center max-sm:text-left sm:items-stretch sm:text-left ${SHELL_PAD_X} max-sm:pt-0 max-sm:pb-6 pb-8 sm:min-h-0 sm:flex-1 sm:justify-center sm:pt-20 sm:pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))]`}
      >
        <header className="mb-7 w-full max-w-3xl space-y-3 sm:mb-10 sm:space-y-4 sm:max-w-none">
          {welcomeHeading ? (
            <h1
              className={`flex flex-wrap items-baseline justify-start gap-x-1.5 gap-y-1 text-2xl font-semibold tracking-tight sm:text-3xl ${
                isDark ? "text-zinc-50" : "text-zinc-900"
              }`}
            >
              <span>{welcomeHeading.text}</span>
              <span
                className="inline-block text-[1.125em] font-normal leading-none sm:text-[1.1em]"
                style={{ fontFamily: WELCOME_EMOJI_FONT }}
                aria-hidden
              >
                {welcomeHeading.emoji}
              </span>
            </h1>
          ) : null}
          <div
            className={`w-full space-y-3 text-[0.9375rem] leading-[1.85] sm:text-left sm:text-[15.5px] sm:leading-[1.9] break-keep ${
              isDark ? "text-zinc-100/92" : "text-zinc-700"
            }`}
          >
            <p>
              {
                "AI 助手 bTd（包打听）会整合国内多家主流 AI 平台，为你生成更全面、更个性化、经过智能筛选的最优答案。"
              }
            </p>
            <p className={isDark ? "text-zinc-200/88" : "text-zinc-600"}>
              请输入你的问题，开始体验吧。
            </p>
          </div>
        </header>

        {error ? (
          <p
            className={`mb-4 w-full max-w-3xl text-sm leading-[1.85] sm:mb-5 sm:max-w-none ${
              isDark ? "text-red-300" : "text-red-700"
            }`}
            role="alert"
          >
            {error}
          </p>
        ) : null}

        {/* 输入区 · 与主栏同宽，小屏避免横向撑破视口 */}
        <div
          className={`w-full max-w-3xl sm:max-w-none ${
            isDark
              ? "rounded-2xl border border-zinc-800/90 bg-zinc-900/90 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.65)] backdrop-blur-xl"
              : "rounded-2xl border border-zinc-300/80 bg-white/90 shadow-[0_24px_64px_-20px_rgba(91,33,182,0.15),0_8px_28px_-8px_rgba(37,99,235,0.08)] backdrop-blur-xl"
          }`}
        >
          <label htmlFor="question" className="sr-only">
            输入问题
          </label>
          <textarea
            id="question"
            ref={questionTextareaRef}
            rows={2}
            className={`max-h-[min(40vh,16rem)] min-h-0 w-full resize-y bg-transparent px-4 pb-2 pt-4 text-left text-[0.9375rem] leading-[1.8] outline-none sm:px-5 sm:pt-5 sm:leading-[1.8] ${
              isDark
                ? "text-zinc-100 placeholder:text-zinc-500"
                : "text-zinc-900 placeholder:text-zinc-400"
            }`}
            placeholder="开始新对话…（Enter 发送，Shift+Enter 换行）"
            value={question}
            onChange={(e) => {
              setQuestion(e.target.value);
              if (error) setError("");
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.shiftKey) return;
              e.preventDefault();
              if (!turnInFlight) void handleSubmit();
            }}
            disabled={turnInFlight}
            aria-busy={turnInFlight}
            autoComplete="off"
          />
          <div
            className={`flex items-center justify-between gap-1.5 border-t px-2.5 py-1.5 sm:gap-2 sm:px-3 ${
              isDark ? "border-zinc-800/80" : "border-zinc-200/90"
            }`}
          >
            <button
              type="button"
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md outline-none transition-[color,background-color,transform] duration-150 focus-visible:ring-2 focus-visible:ring-zinc-400/50 active:scale-95 disabled:pointer-events-none ${
                isDark
                  ? "text-white hover:bg-zinc-800 disabled:text-zinc-500 disabled:hover:bg-transparent disabled:hover:text-zinc-500"
                  : "text-zinc-900 hover:bg-zinc-200/90 disabled:text-zinc-400 disabled:hover:bg-transparent disabled:hover:text-zinc-400"
              }`}
              aria-label="更多（即将支持）"
              title="更多"
              disabled={turnInFlight}
            >
              <IconPlus className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-0.5 sm:gap-1">
              <button
                type="button"
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md outline-none transition-[color,background-color,transform] duration-150 focus-visible:ring-2 focus-visible:ring-zinc-400/50 active:scale-95 disabled:pointer-events-none ${
                  isDark
                    ? "text-white hover:bg-zinc-800 disabled:text-zinc-500 disabled:hover:bg-transparent disabled:hover:text-zinc-500"
                    : "text-zinc-900 hover:bg-zinc-200/90 disabled:text-zinc-400 disabled:hover:bg-transparent disabled:hover:text-zinc-400"
                }`}
                aria-label="语音输入（即将支持）"
                title="语音输入"
                disabled={turnInFlight}
              >
                <IconMic className="h-5 w-5" />
              </button>
              <button
                type="button"
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md outline-none transition-[color,background-color,transform] duration-150 focus-visible:ring-2 focus-visible:ring-zinc-400/50 active:scale-95 disabled:pointer-events-none ${
                  isDark
                    ? "text-white hover:bg-zinc-800 disabled:text-zinc-500 disabled:hover:bg-transparent disabled:hover:text-zinc-500"
                    : "text-zinc-900 hover:bg-zinc-200/90 disabled:text-zinc-400 disabled:hover:bg-transparent disabled:hover:text-zinc-400"
                }`}
                aria-label="发送"
                title="发送"
                disabled={!canSend}
                onClick={() => void handleSubmit()}
              >
                <IconSend className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        {/* 参与融合的模型 · 小屏整组居中，杜绝 min-w-max 横向溢出 */}
        <section
          className="mt-8 w-full max-w-3xl sm:mt-10 sm:max-w-none"
          aria-labelledby="fused-models-heading"
        >
          <div className="mb-3 flex justify-start sm:mb-4">
            <h2
              id="fused-models-heading"
              className={`text-xs font-medium leading-[1.8] ${
                isDark ? "text-zinc-300" : "text-zinc-700"
              }`}
            >
              参与智能融合的模型
            </h2>
          </div>
          <div className="w-full overflow-x-hidden">
            <div className="flex flex-wrap content-center justify-start gap-3 px-0 pb-4 pt-2.5 sm:flex-nowrap sm:justify-start sm:overflow-x-auto sm:overscroll-x-contain sm:px-1 sm:pb-6 sm:pt-3 [scrollbar-width:thin]">
              <div className="flex flex-wrap justify-start gap-3 sm:min-w-max sm:flex-nowrap sm:justify-start">
                {FUSED_MODELS.map((m) => (
                  <div
                    key={m.id}
                    className="flex w-[4.25rem] shrink-0 flex-col items-center sm:w-[4.75rem]"
                  >
                    <div
                      className={`relative h-14 w-14 rounded-2xl shadow-md sm:h-[3.75rem] sm:w-[3.75rem] ${m.iconBg} ${
                        isDark ? "ring-1 ring-zinc-700/80" : "ring-1 ring-zinc-300/90"
                      }`}
                    >
                      <span className="absolute inset-0 overflow-hidden rounded-2xl">
                        <Image
                          src={m.icon}
                          alt=""
                          fill
                          sizes="60px"
                          unoptimized={m.unoptimized}
                          className={m.iconClass}
                        />
                      </span>
                    </div>
                    <span
                      className={`mt-2 w-full text-center text-[11px] font-medium leading-snug sm:mt-2.5 sm:text-[11px] sm:leading-tight ${
                        isDark ? "text-zinc-300" : "text-zinc-700"
                      }`}
                    >
                      {m.label}
                    </span>
                    <span
                      className={`mt-0.5 hidden w-full text-center text-[9px] leading-tight sm:mt-1.5 sm:block sm:text-[10px] ${
                        isDark ? "text-zinc-400" : "text-zinc-600"
                      }`}
                    >
                      {m.sub}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

      </div>
      ) : (
      <div
        className={`relative z-10 mx-auto flex min-w-0 w-full max-w-3xl flex-col ${SHELL_PAD_X} max-sm:pt-0 pb-0 sm:pb-6 sm:pt-11 ${
          desktopChatLayout ? "sm:min-h-0 sm:flex-1" : ""
        }`}
      >
        <div
          className={`flex w-full min-w-0 flex-col px-0 pt-3 max-sm:pb-[calc(9rem+max(1rem,env(safe-area-inset-bottom,0px)))] ${
            desktopChatLayout
              ? "sm:min-h-0 sm:flex-1 sm:overflow-hidden sm:pb-0"
              : "sm:py-12 sm:pb-12"
          }`}
        >
          <div
            id="chat-thread-scroll"
            className={`min-w-0 w-full ${
              desktopChatLayout
                ? "sm:min-h-0 sm:flex-1 sm:overflow-y-auto sm:overscroll-y-contain sm:py-12 sm:pb-6"
                : ""
            }`}
          >
            <div className="w-full space-y-8 sm:space-y-14">
          {chatTurns.map((turn) => (
            <div
              key={turn.id}
              id={`thread-user-anchor-${turn.id}`}
              className="flex min-w-0 max-sm:scroll-mt-[calc(3.25rem+max(0.75rem,env(safe-area-inset-top,0px)))] flex-col gap-4 sm:gap-5"
            >
              <div className="flex justify-end">
                <p
                  className={`max-w-[min(100%,26rem)] whitespace-pre-wrap break-words rounded-2xl rounded-br-md px-3.5 py-2.5 text-left text-sm leading-[1.8] ${
                    isDark
                      ? "bg-violet-950/55 text-zinc-100 ring-1 ring-violet-500/20"
                      : "bg-violet-100/95 text-zinc-900 ring-1 ring-violet-200/80"
                  }`}
                >
                  {turn.userMessage}
                </p>
              </div>

              {turn.status === "loading" ? (
                <div className="flex flex-col items-stretch py-1 sm:py-2">
                  <div
                    className={`w-full rounded-2xl border px-4 py-4 shadow-inner sm:px-5 sm:py-5 ${
                      isDark
                        ? "border-zinc-800/80 bg-zinc-900/60"
                        : "border-violet-200/60 bg-white/85"
                    }`}
                    role="status"
                    aria-live="polite"
                    aria-busy="true"
                  >
                    <p
                      className={`mb-3.5 text-[11px] font-medium uppercase tracking-wide leading-[1.85] sm:mb-3 sm:leading-[1.8] ${
                        isDark ? "text-violet-400/90" : "text-violet-600"
                      }`}
                    >
                      处理进度
                    </p>
                    <ul
                      className={`space-y-3.5 text-sm leading-[1.8] sm:space-y-3 ${
                        isDark ? "text-zinc-300" : "text-zinc-600"
                      }`}
                    >
                      {STEP_LABELS.map((label, index) => {
                        const stepNum = (index + 1) as 1 | 2 | 3 | 4;
                        const ls = turn.loadingStep;
                        const done = ls > stepNum;
                        const active = ls === stepNum;
                        const pending = ls < stepNum;

                        return (
                          <li
                            key={label}
                            className={`flex items-start gap-3 leading-[1.8] ${
                              active
                                ? isDark
                                  ? "font-medium text-violet-200"
                                  : "font-medium text-violet-700"
                                : ""
                            } ${pending ? (isDark ? "text-zinc-500" : "text-zinc-400") : ""} ${
                              done ? (isDark ? "text-zinc-400" : "text-zinc-500") : ""
                            }`}
                          >
                            <span
                              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center"
                              aria-hidden
                            >
                              {done ? (
                                <span
                                  className={`text-base ${
                                    isDark ? "text-emerald-400" : "text-emerald-600"
                                  }`}
                                  title="已完成"
                                >
                                  ✓
                                </span>
                              ) : active ? (
                                <span
                                  className={`inline-flex h-4 w-4 animate-spin rounded-full border-2 ${
                                    isDark
                                      ? "border-violet-900 border-t-violet-400"
                                      : "border-violet-200 border-t-violet-600"
                                  }`}
                                />
                              ) : (
                                <span
                                  className={`h-2 w-2 rounded-full ${
                                    isDark ? "bg-zinc-600" : "bg-zinc-300"
                                  }`}
                                />
                              )}
                            </span>
                            <span className={active ? "animate-pulse" : ""}>
                              {label}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              ) : null}

              {turn.status === "error" ? (
                <div
                  className={`rounded-2xl border p-4 text-sm leading-[1.8] sm:p-5 ${
                    isDark
                      ? "border-red-900/60 bg-red-950/40 text-red-200/95"
                      : "border-red-200 bg-red-50/95 text-red-800"
                  }`}
                  role="alert"
                >
                  {turn.error}
                </div>
              ) : null}

              {turn.status === "done" ? (
                <div className="relative z-0 mt-2 min-w-0 overflow-visible sm:mt-2">
                  <div className="pointer-events-none absolute inset-x-0 top-0 z-10 overflow-visible px-4 sm:px-6">
                    <div className="pointer-events-auto mx-auto w-full max-w-full -translate-y-1/2 overflow-visible">
                      <div className="h-[3.25rem] overflow-visible">
                        <div className="-mx-2 overflow-x-auto overflow-y-visible overscroll-x-contain px-2 py-3 [scrollbar-width:thin] sm:-mx-3 sm:px-3">
                          <div
                            role="tablist"
                            aria-label="切换答案来源"
                            className="flex h-[3.25rem] min-w-max flex-nowrap items-center justify-start gap-2 sm:gap-2.5"
                          >
                        <button
                          type="button"
                          role="tab"
                          aria-selected={turn.activeTab === "fused"}
                          id={`tab-fused-${turn.id}`}
                          aria-controls={`answer-panel-${turn.id}`}
                          onClick={() =>
                            patchTurn(turn.id, { activeTab: "fused" })
                          }
                          title="融合后的最佳答案"
                          className={`flex shrink-0 items-center justify-center rounded-full border border-violet-500/20 bg-gradient-to-br from-violet-600/25 to-blue-600/25 text-amber-100 backdrop-blur-sm outline-none transition-[width,height,box-shadow,filter] duration-300 ease-out hover:brightness-110 active:scale-[0.97] touch-manipulation ${tabFocus} ${
                            turn.activeTab === "fused"
                              ? "h-[3.25rem] w-[3.25rem] min-h-[3.25rem] min-w-[3.25rem] text-2xl"
                              : "h-11 w-11 min-h-11 min-w-11 text-lg"
                          } ${
                            isDark
                              ? "focus-visible:ring-offset-zinc-950"
                              : "focus-visible:ring-offset-white"
                          } ${
                            turn.activeTab === "fused" ? tabActive : tabInactive
                          }`}
                        >
                          ✨
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={turn.activeTab === "deepseek"}
                          id={`tab-deepseek-${turn.id}`}
                          aria-controls={`answer-panel-${turn.id}`}
                          onClick={() =>
                            patchTurn(turn.id, { activeTab: "deepseek" })
                          }
                          title="DeepSeek 原始回答"
                          className={`relative shrink-0 rounded-full bg-white outline-none transition-[width,height,box-shadow,filter] duration-300 ease-out hover:brightness-110 active:scale-[0.97] touch-manipulation ${tabFocus} ${
                            turn.activeTab === "deepseek"
                              ? "h-[3.25rem] w-[3.25rem] min-h-[3.25rem] min-w-[3.25rem]"
                              : "h-11 w-11 min-h-11 min-w-11"
                          } ${
                            isDark
                              ? "focus-visible:ring-offset-zinc-950"
                              : "focus-visible:ring-offset-white"
                          } ${
                            turn.activeTab === "deepseek"
                              ? tabActive
                              : tabInactive
                          }`}
                        >
                          <span className="absolute inset-0 overflow-hidden rounded-full bg-white">
                            <Image
                              src={DEEPSEEK_ICON_SRC}
                              alt="DeepSeek"
                              fill
                              sizes={
                                turn.activeTab === "deepseek" ? "52px" : "44px"
                              }
                              unoptimized
                              className="bg-white object-contain p-1.5"
                            />
                          </span>
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={turn.activeTab === "kimi"}
                          id={`tab-kimi-${turn.id}`}
                          aria-controls={`answer-panel-${turn.id}`}
                          onClick={() =>
                            patchTurn(turn.id, { activeTab: "kimi" })
                          }
                          title="Kimi 原始回答"
                          className={`relative shrink-0 rounded-full bg-black outline-none transition-[width,height,box-shadow,filter] duration-300 ease-out hover:brightness-110 active:scale-[0.97] touch-manipulation ${tabFocus} ${
                            turn.activeTab === "kimi"
                              ? "h-[3.25rem] w-[3.25rem] min-h-[3.25rem] min-w-[3.25rem]"
                              : "h-11 w-11 min-h-11 min-w-11"
                          } ${
                            isDark
                              ? "focus-visible:ring-offset-zinc-950"
                              : "focus-visible:ring-offset-white"
                          } ${turn.activeTab === "kimi" ? tabActive : tabInactive}`}
                        >
                          <span className="absolute inset-0 overflow-hidden rounded-full bg-black">
                            <Image
                              src="/brands/kimi.png"
                              alt="Kimi"
                              fill
                              sizes={
                                turn.activeTab === "kimi" ? "52px" : "44px"
                              }
                              className="object-contain p-2"
                            />
                          </span>
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={turn.activeTab === "qwen"}
                          id={`tab-qwen-${turn.id}`}
                          aria-controls={`answer-panel-${turn.id}`}
                          onClick={() =>
                            patchTurn(turn.id, { activeTab: "qwen" })
                          }
                          title="Qwen 原始回答"
                          className={`relative shrink-0 rounded-full bg-white outline-none transition-[width,height,box-shadow,filter] duration-300 ease-out hover:brightness-110 active:scale-[0.97] touch-manipulation ${tabFocus} ${
                            turn.activeTab === "qwen"
                              ? "h-[3.25rem] w-[3.25rem] min-h-[3.25rem] min-w-[3.25rem]"
                              : "h-11 w-11 min-h-11 min-w-11"
                          } ${
                            isDark
                              ? "focus-visible:ring-offset-zinc-950"
                              : "focus-visible:ring-offset-white"
                          } ${turn.activeTab === "qwen" ? tabActive : tabInactive}`}
                        >
                          <span className="absolute inset-0 overflow-hidden rounded-full bg-white">
                            <Image
                              src="/brands/qwen.png"
                              alt="Qwen"
                              fill
                              sizes={
                                turn.activeTab === "qwen" ? "52px" : "44px"
                              }
                              className="object-contain p-2"
                            />
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                </div>

                <div
                  id={`answer-panel-${turn.id}`}
                  role="tabpanel"
                  aria-labelledby={
                    turn.activeTab === "fused"
                      ? `tab-fused-${turn.id}`
                      : turn.activeTab === "deepseek"
                        ? `tab-deepseek-${turn.id}`
                        : turn.activeTab === "kimi"
                          ? `tab-kimi-${turn.id}`
                          : `tab-qwen-${turn.id}`
                  }
                  className={`rounded-2xl border px-4 pb-6 pt-[calc(2.125rem+15pt)] backdrop-blur sm:px-6 sm:pb-6 sm:pt-[calc(2.125rem+17pt)] ${
                    isDark
                      ? "border-zinc-800 bg-zinc-900/70 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.5)]"
                      : "border-zinc-200/90 bg-white/85 shadow-[0_24px_50px_-20px_rgba(91,33,182,0.12),0_8px_30px_-12px_rgba(0,0,0,0.08)]"
                  }`}
                >
                  {(() => {
                    const { title: answerTitle, body: answerBody } =
                      answerPanelForTab(turn.activeTab, turn);
                    const revealKey = `${turn.id}-${turn.activeTab}`;
                    const revealSeen =
                      answerRevealSeenRef.current.has(revealKey);
                    return (
                      <AnswerPanelTabSwitch activeTab={turn.activeTab}>
                        <h3
                          className={`mb-3.5 text-center text-sm font-semibold uppercase tracking-wide leading-[1.8] sm:mb-3 ${
                            isDark
                              ? "text-violet-300/95"
                              : "text-violet-700"
                          }`}
                        >
                          {answerTitle}
                        </h3>
                        {revealSeen ? (
                          <p
                            className={`whitespace-pre-wrap break-words text-sm font-normal leading-[1.8] ${
                              isDark ? "text-zinc-200" : "text-zinc-800"
                            }`}
                          >
                            {answerBody}
                          </p>
                        ) : (
                          <div
                            className={`answer-gemini-reveal ${isDark ? "answer-gemini-reveal-dark" : "answer-gemini-reveal-light"}`}
                          >
                            <AnswerBodyStream
                              text={answerBody}
                              revealKey={revealKey}
                              isDark={isDark}
                              onRevealConsumed={markAnswerRevealConsumed}
                            />
                          </div>
                        )}
                      </AnswerPanelTabSwitch>
                    );
                  })()}
                </div>
                </div>
              ) : null}
            </div>
          ))}
            </div>
          </div>
        <div
          id="chat-dock"
          className={`z-30 mt-auto w-full min-w-0 shrink-0 border-transparent bg-transparent pt-4 transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none sm:mt-6 sm:shrink-0 sm:border-t sm:pt-5 max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-[88] max-sm:mt-0 max-sm:w-full max-sm:border-t max-sm:pt-3 max-sm:pb-[max(1rem,env(safe-area-inset-bottom,0px))] max-sm:pl-[max(1rem,env(safe-area-inset-left,0px))] max-sm:pr-[max(1rem,env(safe-area-inset-right,0px))] max-sm:transition-none ${
            isDark
              ? "max-sm:border-zinc-800/50 max-sm:bg-zinc-950/92 max-sm:backdrop-blur-xl sm:border-zinc-800/60 sm:bg-transparent"
              : "max-sm:border-zinc-200/70 max-sm:bg-white/95 max-sm:backdrop-blur-xl sm:border-zinc-200/85 sm:bg-white/92 sm:supports-[backdrop-filter]:backdrop-blur-xl"
          } ${
            chatDockEntered
              ? "translate-y-0 opacity-100"
              : "translate-y-6 opacity-0 max-sm:translate-y-0 max-sm:opacity-100"
          }`}
        >
          {error ? (
            <p
              className={`mx-auto mb-2 w-full max-w-3xl text-sm leading-[1.85] sm:px-0 ${
                isDark ? "text-red-300" : "text-red-700"
              }`}
              role="alert"
            >
              {error}
            </p>
          ) : null}
          <div className="mx-auto w-full min-w-0 max-w-3xl max-sm:pb-0 sm:pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
            <div
              className={
                isDark
                  ? "rounded-2xl border border-zinc-800/90 bg-zinc-900/90 shadow-lg shadow-black/30 backdrop-blur-xl"
                  : "rounded-2xl border border-zinc-300/85 bg-white/95 shadow-md backdrop-blur-xl"
              }
            >
              <label htmlFor="question" className="sr-only">
                继续提问
              </label>
              <textarea
                id="question"
                ref={questionTextareaRef}
                rows={1}
                className={`max-h-[min(32vh,12rem)] min-h-[44px] w-full resize-y bg-transparent px-3 py-3 text-sm leading-[1.8] outline-none sm:px-4 ${
                  isDark
                    ? "text-zinc-100 placeholder:text-zinc-500"
                    : "text-zinc-900 placeholder:text-zinc-400"
                }`}
                placeholder="继续提问…（Enter 发送，Shift+Enter 换行）"
                value={question}
                onChange={(e) => {
                  setQuestion(e.target.value);
                  if (error) setError("");
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.shiftKey) return;
                  e.preventDefault();
                  if (!turnInFlight) void handleSubmit();
                }}
                disabled={turnInFlight}
                aria-busy={turnInFlight}
                autoComplete="off"
              />
              <div
                className={`flex items-center justify-between gap-1.5 border-t px-2 py-1 sm:gap-2 sm:px-3 ${
                  isDark ? "border-zinc-800/80" : "border-zinc-200/90"
                }`}
              >
                <button
                  type="button"
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md outline-none transition-[color,background-color,transform] duration-150 focus-visible:ring-2 focus-visible:ring-zinc-400/50 active:scale-95 disabled:pointer-events-none ${
                    isDark
                      ? "text-white hover:bg-zinc-800 disabled:text-zinc-500 disabled:hover:bg-transparent disabled:hover:text-zinc-500"
                      : "text-zinc-900 hover:bg-zinc-200/90 disabled:text-zinc-400 disabled:hover:bg-transparent disabled:hover:text-zinc-400"
                  }`}
                  aria-label="更多（即将支持）"
                  title="更多"
                  disabled={turnInFlight}
                >
                  <IconPlus className="h-5 w-5" />
                </button>
                <div className="flex items-center gap-0.5 sm:gap-1">
                  <button
                    type="button"
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md outline-none transition-[color,background-color,transform] duration-150 focus-visible:ring-2 focus-visible:ring-zinc-400/50 active:scale-95 disabled:pointer-events-none ${
                      isDark
                        ? "text-white hover:bg-zinc-800 disabled:text-zinc-500 disabled:hover:bg-transparent disabled:hover:text-zinc-500"
                        : "text-zinc-900 hover:bg-zinc-200/90 disabled:text-zinc-400 disabled:hover:bg-transparent disabled:hover:text-zinc-400"
                    }`}
                    aria-label="语音输入（即将支持）"
                    title="语音输入"
                    disabled={turnInFlight}
                  >
                    <IconMic className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md outline-none transition-[color,background-color,transform] duration-150 focus-visible:ring-2 focus-visible:ring-zinc-400/50 active:scale-95 disabled:pointer-events-none ${
                      isDark
                        ? "text-white hover:bg-zinc-800 disabled:text-zinc-500 disabled:hover:bg-transparent disabled:hover:text-zinc-500"
                        : "text-zinc-900 hover:bg-zinc-200/90 disabled:text-zinc-400 disabled:hover:bg-transparent disabled:hover:text-zinc-400"
                    }`}
                    aria-label="发送"
                    title="发送"
                    disabled={!canSend}
                    onClick={() => void handleSubmit()}
                  >
                    <IconSend className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        </div>
      </div>
      )}
    </main>
      <button
        type="button"
        onClick={() => setTheme(isDark ? "light" : "dark")}
        className={`fixed z-[100] hidden h-10 w-10 items-center justify-center rounded-xl border outline-none transition-[background-color,box-shadow,color] focus-visible:ring-2 focus-visible:ring-violet-500/50 focus-visible:ring-offset-2 active:scale-95 touch-manipulation sm:flex right-[max(1rem,env(safe-area-inset-right,0px))] top-[max(1rem,env(safe-area-inset-top,0px))] sm:right-6 sm:top-5 ${
          isDark
            ? "border-zinc-700 bg-zinc-900/95 text-amber-200 shadow-lg shadow-black/40 hover:bg-zinc-800 hover:text-amber-100"
            : "border-zinc-300/80 bg-white/95 text-zinc-700 shadow-md shadow-violet-900/10 hover:bg-zinc-50"
        } ${
          isDark ? "focus-visible:ring-offset-zinc-950" : "focus-visible:ring-offset-violet-50"
        }`}
        aria-label={isDark ? "切换为浅色主题" : "切换为深色主题"}
        title={isDark ? "浅色模式" : "深色模式"}
      >
        {isDark ? (
          <IconSun className="h-5 w-5" />
        ) : (
          <IconMoon className="h-5 w-5" />
        )}
      </button>
    </div>
  );
}
