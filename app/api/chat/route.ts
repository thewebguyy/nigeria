import { buildContext, centreAnswer, curatedAnswer, isSmallTalk, retrieve, unverifiedAnswer } from "@/lib/ask";
import { formatEvidence, groundAnswer, GROUNDING_INSTRUCTIONS, previewText, type Evidence, type ModelAnswer } from "@/lib/grounding";
import { pageRef, searchPages } from "@/lib/search";
import type { AskResult } from "@/lib/types";

const ENDPOINT = "https://api.cencori.com/v1/chat/completions";
const DEFAULT_MODEL = "maximo-atlas-1.5";
const MAX_TURNS = 8;

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const hits = new Map<string, number[]>();

function isRateLimited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((time) => now - time < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 2000) hits.clear();
  return false;
}

const SYSTEM_PROMPT = `You are Nigeria, an AI assistant for Nigerian government services. Speak in the first person as Nigeria: a calm, warm guide who helps citizens find and complete government services (NIN, passports, CAC, tax, JAMB, NYSC, student loans and more).

Identity:
- When asked who or what you are, say you are Nigeria, an AI assistant that helps people with Nigerian government services.
- If asked whether you are official or run by the government, say honestly that you are an independent assistant, not an official government service, and that official decisions, payments and applications happen on the agency's own website.
- Never claim to process applications, issue documents, take payments or access anyone's records.

Never ask for personal data such as a BVN, NIN, card number or password.
${GROUNDING_INSTRUCTIONS}`;

type Turn = { role: "user" | "assistant"; content: string };

function parsePayload(content: string) {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/** Pulls the answer out of a partially streamed JSON object. */
function readAnswerField(buffer: string) {
  const match = buffer.match(/"answer"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if (!match) return null;
  // Still inside the string: more tokens are coming.
  const end = (match.index ?? 0) + match[0].length;
  if (end >= buffer.length) {
    try {
      return JSON.parse(`"${match[1]}"`) as string;
    } catch {
      return match[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
    }
  }
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return match[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }
}

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local";

  if (isRateLimited(ip)) {
    return Response.json(
      { error: "That is a lot of questions at once. Please wait a minute and try again." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send the conversation as JSON." }, { status: 400 });
  }

  const payload = (body ?? {}) as { question?: unknown; history?: unknown };
  const question = typeof payload.question === "string" ? payload.question.trim() : "";

  if (!question) {
    return Response.json({ error: "Type a question first." }, { status: 400 });
  }
  if (question.length > 600) {
    return Response.json(
      { error: "That question is too long. Keep it under 600 characters." },
      { status: 400 },
    );
  }

  const history: Turn[] = Array.isArray(payload.history)
    ? payload.history
        .filter(
          (turn): turn is Turn =>
            typeof turn === "object" &&
            turn !== null &&
            (turn as Turn).role !== undefined &&
            ((turn as Turn).role === "user" || (turn as Turn).role === "assistant") &&
            typeof (turn as Turn).content === "string",
        )
        .slice(-MAX_TURNS)
        .map((turn) => ({ role: turn.role, content: turn.content.slice(0, 1200) }))
    : [];

  const key = process.env.CENCORI_API_KEY;
  // Recent user turns give follow-ups ("where can I get it done?") their topic.
  const recent = history
    .filter((turn) => turn.role === "user")
    .slice(-3)
    .map((turn) => turn.content);

  // Greetings and thanks get a short, instant reply without a model call.
  if (!key || isSmallTalk(question)) {
    const result = curatedAnswer(question, recent);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  }

  const centre = centreAnswer(question, recent);
  // Search this turn alone. Earlier topics must not re-enter as crawled evidence.
  const hits = searchPages(question, 6);
  const evidence = centre
    ? [{ title: "NIMC enrolment centres", text: centre.answer, sources: centre.sources }]
    : buildContext(question, recent);
  evidence.push(...hits.map<Evidence>((hit) => ({
    title: hit.title,
    text: hit.excerpt,
    sources: [pageRef(hit)],
    incomplete: hit.excerpt.includes("…") ? true : undefined,
  })));
  const notes = formatEvidence(evidence);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      // The reader may leave mid-reply; writing after that would throw.
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sse(event, data)));
        } catch {
          closed = true;
        }
      };

      try {
        const upstream = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model: process.env.CENCORI_MODEL || DEFAULT_MODEL,
            temperature: 0.2,
            max_tokens: 600,
            stream: true,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              ...history,
              {
                role: "user",
                content: `EVIDENCE:\n${notes || "No request-specific evidence."}\n\nQUESTION: ${question}`,
              },
            ],
          }),
          signal: AbortSignal.timeout(45000),
        });

        if (!upstream.ok || !upstream.body) {
          throw new Error(`Cencori returned ${upstream.status}`);
        }

        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let raw = "";
        let sseBuffer = "";
        let sentText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          sseBuffer += decoder.decode(value, { stream: true });

          const lines = sseBuffer.split("\n");
          sseBuffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (!data || data === "[DONE]") continue;

            try {
              const chunk = JSON.parse(data);
              const delta = chunk?.choices?.[0]?.delta?.content;
              if (typeof delta === "string") raw += delta;
            } catch {
              // A malformed chunk is skipped; the final payload is validated below.
            }
          }

          const partial = readAnswerField(raw);
          if (partial && partial.length > sentText.length) {
            sentText = partial;
            send("delta", { text: previewText(partial) });
          }
        }

        const parsed = parsePayload(raw) as ModelAnswer | null;

        if (!parsed || typeof parsed.answer !== "string" || !parsed.answer.trim()) {
          throw new Error("The model did not return a usable answer.");
        }

        const grounded = groundAnswer(parsed, evidence);
        if (!grounded) {
          send("fallback", unverifiedAnswer());
          return;
        }
        const fallback = retrieve(question, 1, recent)[0]?.entry;

        const final: AskResult = {
          ...grounded,
          followUps: fallback?.followUps ?? [
            "How do I get a NIN?",
            "How do I register a business?",
            "How do I apply for a student loan?",
          ],
          action: centre?.action ?? null,
        };

        send("done", final);
      } catch (error) {
        console.error(
          "Chat stream failed, sending curated answer:",
          error instanceof Error ? error.message : error,
        );
        send("fallback", curatedAnswer(question, recent));
      } finally {
        if (!closed) {
          try {
            controller.close();
          } catch {}
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
