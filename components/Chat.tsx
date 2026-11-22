"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { AskResult, SourceRef } from "@/lib/types";
import { ArrowRight, ArrowUpRight } from "./icons";
import { SourcesButton } from "./SourcesSheet";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
  sources?: SourceRef[];
  confident?: boolean;
  agency?: { name: string; url: string } | null;
  action?: { label: string; url: string } | null;
  followUps?: string[];
  mode?: "ai" | "curated";
  error?: string;
};

const STARTERS = [
  { label: "Identity", question: "How do I get a NIN for the first time?" },
  { label: "Travel", question: "What do I need to renew my passport?" },
  { label: "Business", question: "How do I register a company with the CAC?" },
  { label: "Money", question: "Can I apply for a student loan?" },
];

let counter = 0;
const nextId = () => `m${++counter}`;

/** Renders **bold** and [text](https://...) inside a line. Links only to https URLs. */
function Inline({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1]) {
      parts.push(
        <strong key={key++} className="font-semibold text-paper">
          {match[1]}
        </strong>,
      );
    } else {
      parts.push(
        <a
          key={key++}
          href={match[3]}
          target="_blank"
          rel="noopener noreferrer"
          className="whitespace-nowrap text-[#7fb8ff] underline decoration-dotted decoration-[#7fb8ff]/60 underline-offset-[5px] hover:decoration-solid"
        >
          {match[2]}
          <svg viewBox="0 0 24 24" className="ml-0.5 inline h-[0.95em] w-[0.95em] -translate-y-px" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M7 17 17 7M9 7h8v8" />
          </svg>
        </a>,
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function AnswerText({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (!para.length) return;
    blocks.push(
      <p key={blocks.length}>
        <Inline text={para.join(" ")} />
      </p>,
    );
    para = [];
  };
  const flushList = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={blocks.length} className="space-y-2.5 pl-1">
        {list.map((item, i) => (
          <li key={i} className="flex gap-3.5">
            <span className="mt-[10px] h-[5px] w-[5px] flex-none bg-paper/70" aria-hidden="true" />
            <span>
              <Inline text={item} />
            </span>
          </li>
        ))}
      </ul>,
    );
    list = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushList();
    } else if (/^#{1,3}\s+/.test(line)) {
      flushPara();
      flushList();
      blocks.push(
        <h3 key={blocks.length} className="pt-2 text-[16px] font-semibold tracking-[-0.01em] text-paper">
          {line.replace(/^#{1,3}\s+/, "").replace(/\*\*/g, "")}
        </h3>,
      );
    } else if (/^[-*•]\s+/.test(line)) {
      flushPara();
      list.push(line.replace(/^[-*•]\s+/, ""));
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();

  return (
    <div className="space-y-3.5 text-[15.5px] leading-relaxed text-paper/85 [&>h3:first-child]:pt-0">
      {blocks}
    </div>
  );
}

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  className: "h-[17px] w-[17px]",
};

function MessageActions({ text, sources = [] }: { text: string; sources?: SourceRef[] }) {
  const [copied, setCopied] = useState(false);
  const [rating, setRating] = useState<"up" | "down" | null>(null);

  async function copy() {
    try {
      // Copy readable text: drop heading marks and bold, keep link text with its URL.
      const plain = text
        .replace(/^#{1,3}\s+/gm, "")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, "$1 ($2)");
      await navigator.clipboard.writeText(plain);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  const base =
    "grid h-8 w-8 place-items-center rounded-full text-paper/45 transition-colors hover:bg-paper/[0.08] hover:text-paper";

  return (
    <div className="mt-2 flex items-center gap-1">
      {sources.length > 0 && (
        <span className="mr-1">
          <SourcesButton sources={sources} />
        </span>
      )}
      <button type="button" onClick={copy} className={base} aria-label={copied ? "Copied" : "Copy"}>
        {copied ? (
          <svg {...iconProps}>
            <path d="m5 12.5 4.5 4.5L19 7" />
          </svg>
        ) : (
          <svg {...iconProps}>
            <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
            <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
          </svg>
        )}
      </button>
      <button
        type="button"
        onClick={() => setRating((value) => (value === "up" ? null : "up"))}
        className={`${base} ${rating === "up" ? "text-paper" : ""}`}
        aria-label="Good answer"
        aria-pressed={rating === "up"}
      >
        <svg {...iconProps} fill={rating === "up" ? "currentColor" : "none"}>
          <path d="M7 10.5v9H4.5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1H7Zm0 0 4-7a2.2 2.2 0 0 1 2.2 2.6l-.6 3.4h5.6a2 2 0 0 1 2 2.4l-1.3 6.4a2 2 0 0 1-2 1.7H7" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => setRating((value) => (value === "down" ? null : "down"))}
        className={`${base} ${rating === "down" ? "text-paper" : ""}`}
        aria-label="Bad answer"
        aria-pressed={rating === "down"}
      >
        <svg {...iconProps} fill={rating === "down" ? "currentColor" : "none"}>
          <path d="M17 13.5v-9h2.5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H17Zm0 0-4 7a2.2 2.2 0 0 1-2.2-2.6l.6-3.4H5.8a2 2 0 0 1-2-2.4l1.3-6.4a2 2 0 0 1 2-1.7H17" />
        </svg>
      </button>
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </div>
  );
}

export function Chat() {
  const params = useSearchParams();
  const router = useRouter();
  const initial = params.get("q")?.trim() ?? "";

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [started, setStarted] = useState(false);
  const [atBottom, setAtBottom] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Pin the chat to the visible area. iOS shifts the visual viewport when the
  // keyboard opens; following its offset and height keeps the header in place
  // and the composer sitting directly on the keyboard.
  useEffect(() => {
    const viewport = window.visualViewport;
    const root = rootRef.current;
    if (!viewport || !root) return;

    const sync = () => {
      root.style.top = `${viewport.offsetTop}px`;
      root.style.height = `${viewport.height}px`;
    };

    sync();
    viewport.addEventListener("resize", sync);
    viewport.addEventListener("scroll", sync);
    return () => {
      viewport.removeEventListener("resize", sync);
      viewport.removeEventListener("scroll", sync);
    };
  }, []);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const autoSent = useRef(false);

  const scrollToEnd = useCallback((smooth = true) => {
    // Scroll only the conversation panel; scrollIntoView can also move the page on iOS.
    const panel = scrollRef.current;
    if (!panel) return;
    panel.scrollTo({ top: panel.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (started) scrollToEnd();
  }, [messages, started, scrollToEnd]);

  const ask = useCallback(
    async (raw: string, history: Message[]) => {
      const question = raw.trim();
      if (!question || busy) return;

      setError("");
      setStarted(true);
      setBusy(true);
      setInput("");

      const userMessage: Message = { id: nextId(), role: "user", text: question };
      const replyId = nextId();
      const reply: Message = { id: replyId, role: "assistant", text: "", streaming: true };

      setMessages((current) => [...current, userMessage, reply]);

      const controller = new AbortController();
      abortRef.current = controller;

      const patch = (changes: Partial<Message>) =>
        setMessages((current) =>
          current.map((message) =>
            message.id === replyId ? { ...message, ...changes } : message,
          ),
        );

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question,
            history: history
              .filter((message) => message.text && !message.error)
              .slice(-8)
              .map((message) => ({ role: message.role, content: message.text })),
          }),
          signal: controller.signal,
        });

        const contentType = response.headers.get("content-type") ?? "";

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data?.error || "That request did not go through.");
        }

        // No API key configured: the route answers with a single JSON result.
        if (contentType.includes("application/json")) {
          const data = (await response.json()) as AskResult;
          patch({
            text: data.answer,
            streaming: false,
            sources: data.sources,
            confident: data.confident,
            agency: data.agency,
            action: data.action,
            followUps: data.followUps,
            mode: data.mode,
          });
          return;
        }

        if (!response.body) throw new Error("The answer stream was empty.");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let receivedFinal = false;

        const handleEvent = (rawEvent: string) => {
          if (receivedFinal) return;
          const lines = rawEvent.split("\n");
          const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
          const data = lines
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("");
          if (!data) return;

          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            return;
          }

          if (typeof parsed !== "object" || parsed === null) return;
          if (event === "delta") {
            const text = (parsed as { text?: string }).text;
            if (typeof text === "string") patch({ text });
          } else if (event === "done" || event === "fallback") {
            const result = parsed as AskResult;
            if (typeof result.answer !== "string" || (result.mode !== "ai" && result.mode !== "curated")) return;
            receivedFinal = true;
            patch({
              text: result.answer,
              streaming: false,
              sources: result.sources,
              confident: result.confident,
              agency: result.agency,
              action: result.action,
              followUps: result.followUps,
              mode: result.mode,
            });
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";
          for (const event of events) handleEvent(event);
        }
        if (!receivedFinal) throw new Error("The answer stream ended before the final response.");
      } catch (err) {
        if (controller.signal.aborted) {
          patch({ streaming: false, text: "Stopped." });
        } else {
          const message = err instanceof Error ? err.message : "That request did not go through.";
          setError(message);
          setMessages((current) => current.filter((item) => item.id !== replyId));
        }
      } finally {
        abortRef.current = null;
        setBusy(false);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    },
    [busy],
  );

  useEffect(() => {
    if (autoSent.current || !initial) return;
    autoSent.current = true;
    void ask(initial, []);
  }, [ask, initial]);

  function submit() {
    if (!input.trim() || busy) return;
    void ask(input, messages);
  }

  function stop() {
    abortRef.current?.abort();
  }

  function newChat() {
    abortRef.current?.abort();
    setMessages([]);
    setError("");
    setStarted(false);
    setInput("");
    // Drop ?q= so a reload does not resend the first question.
    if (initial) router.replace("/chat");
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function back() {
    if (window.history.length > 1) router.back();
    else router.push("/");
  }

  return (
    <div
      ref={rootRef}
      className="fixed inset-x-0 top-0 flex h-dvh min-h-0 flex-col overflow-hidden bg-black"
    >
      <div className="shrink-0">
        <div className="shell flex h-16 items-center justify-between">
          <button
            type="button"
            onClick={back}
            className="-ml-2 inline-flex min-h-11 items-center gap-0.5 px-2 text-[15px] font-normal text-paper transition-opacity hover:opacity-70"
          >
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 5-7 7 7 7" />
            </svg>
            Back
          </button>
          <button
            type="button"
            onClick={newChat}
            aria-label="New chat"
            className="-mr-2 grid h-11 w-11 place-items-center text-paper transition-opacity hover:opacity-70"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        onScroll={(event) => {
          const panel = event.currentTarget;
          setAtBottom(panel.scrollHeight - panel.scrollTop - panel.clientHeight < 80);
        }}
      >
        <div className="shell w-full max-w-3xl py-8 md:py-12">
          {!started && (
            <div className="animate-rise">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-paper/45">
                Ask about any government service
              </p>
              <h1 className="display-sm mt-4 text-paper">
                What would you like to sort out?
              </h1>
              <p className="mt-4 max-w-xl text-[15.5px] leading-relaxed text-paper/65">
                Ask in your own words. Answers come from official Nigerian government
                pages, and every one of them is linked so you can check it yourself.
              </p>

              <div className="mt-8 grid gap-2 sm:grid-cols-2">
                {STARTERS.map((starter) => (
                  <button
                    key={starter.question}
                    type="button"
                    onClick={() => void ask(starter.question, [])}
                    className="group flex items-start justify-between gap-3 rounded-xl bg-paper/[0.06] p-4 text-left transition-colors hover:bg-paper/[0.1]"
                  >
                    <span>
                      <span className="block text-[10.5px] font-semibold uppercase tracking-[0.14em] text-paper/45">
                        {starter.label}
                      </span>
                      <span className="mt-1 block text-sm text-paper">{starter.question}</span>
                    </span>
                    <ArrowRight className="mt-1 h-4 w-4 flex-none text-paper/40 transition-transform group-hover:translate-x-0.5" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-8">
            {messages.map((message) =>
              message.role === "user" ? (
                <div key={message.id} className="flex justify-end">
                  <p className="max-w-[75%] rounded-[20px] bg-paper/[0.12] px-3.5 py-2 text-[15px] leading-snug text-paper">
                    {message.text}
                  </p>
                </div>
              ) : (
                <article key={message.id} className="max-w-full">
                  <div>
                    {message.streaming && message.text && (
                      <p className="mb-1 text-xs text-paper/60">Preview · checking evidence</p>
                    )}
                    {message.text && message.mode ? (
                      <AnswerText text={message.text} />
                    ) : message.text ? (
                      <p className="whitespace-pre-wrap text-[15.5px] leading-relaxed text-paper/85">
                        {message.text}
                      </p>
                    ) : (
                      <p className="thinking text-[15.5px]">Thinking…</p>
                    )}
                    {message.streaming && message.text && (
                      <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-paper/70 align-middle" />
                    )}
                  </div>

                  {!message.streaming && message.action && (
                    <a
                      href={message.action.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-full bg-paper px-4 text-sm font-semibold text-black transition-colors hover:bg-white"
                    >
                      {message.action.label}
                      <ArrowUpRight className="h-4 w-4" />
                    </a>
                  )}

                  {!message.streaming && !message.action && message.confident === false && message.agency && (
                    <a
                      href={message.agency.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-full bg-paper/[0.08] px-4 text-sm font-medium text-paper transition-colors hover:bg-paper/[0.14]"
                    >
                      Check with {message.agency.name}
                      <ArrowUpRight className="h-4 w-4" />
                    </a>
                  )}

                  {message.mode && message.text && (
                    <MessageActions text={message.text} sources={message.sources} />
                  )}
                </article>
              ),
            )}
          </div>

          <div ref={bottomRef} className="h-2" />
        </div>
      </div>

      <div className="relative shrink-0 bg-black pb-[env(safe-area-inset-bottom)]">
        {!atBottom && (
          <button
            type="button"
            onClick={() => scrollToEnd()}
            aria-label="Scroll to latest"
            className="absolute bottom-full left-1/2 mb-3 grid h-10 w-10 -translate-x-1/2 place-items-center rounded-full bg-[#2a2a2c] text-paper shadow-[0_8px_24px_-8px_rgb(0_0_0/0.8)] transition-colors hover:bg-[#3a3a3c]"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 5v14M6 13l6 6 6-6" />
            </svg>
          </button>
        )}
        <div className="shell w-full max-w-3xl py-3 md:py-4">
          {error && (
            <p
              role="alert"
              className="mb-2.5 rounded-xl bg-paper/[0.08] px-3.5 py-2.5 text-sm text-paper"
            >
              {error}
            </p>
          )}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <label htmlFor="chat-input" className="sr-only">
              Ask about a Nigerian government service
            </label>
            <div className="hero-pill hero-pill-dark">
              <textarea
                id="chat-input"
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submit();
                  }
                }}
                placeholder={
                  started ? "Ask a follow-up question" : "Ask about any government service"
                }
                className="hero-pill-input resize-none py-[9px] leading-[20px]"
                maxLength={600}
                disabled={busy}
              />
              {busy ? (
                <button type="button" onClick={stop} className="hero-send" aria-label="Stop">
                  <span className="h-3 w-3 rounded-[3px] bg-black" aria-hidden="true" />
                </button>
              ) : (
                <button
                  type="submit"
                  className="hero-send disabled:opacity-40"
                  disabled={!input.trim()}
                  aria-label="Ask"
                >
                  <ArrowRight className="h-5 w-5" />
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
