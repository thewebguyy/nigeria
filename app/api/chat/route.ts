import { buildContext, centreAnswer, curatedAnswer, isSmallTalk, retrieve, unverifiedAnswer } from "@/lib/ask";
import { readAnswerRequest } from "@/lib/answer-request";
import { formatEvidence, groundAnswer, GROUNDING_INSTRUCTIONS, previewText, type Evidence, type ModelAnswer } from "@/lib/grounding";
import { ProviderStreamError, readProviderStream } from "@/lib/provider-stream";
import { pageRef, searchPages } from "@/lib/search";
import type { AskResult } from "@/lib/types";

const ENDPOINT = "https://api.cencori.com/v1/chat/completions";
const DEFAULT_MODEL = "maximo-atlas-1.5";
const MAX_TURNS = 8;
const MAX_QUEUED_PREVIEWS = 2;

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

function parsePayload(content: string): ModelAnswer {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: ModelAnswer | null;
  try {
    parsed = JSON.parse(cleaned) as ModelAnswer | null;
  } catch {
    throw new ProviderStreamError("invalid-model-json");
  }
  if (!parsed || typeof parsed.answer !== "string" || !parsed.answer.trim()) {
    throw new ProviderStreamError("invalid-model-json");
  }
  return parsed;
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

  const input = await readAnswerRequest(request);
  if (input instanceof Response) return input;
  const question = input.question;

  const history: Turn[] = Array.isArray(input.history)
    ? input.history
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
  const downstream = new AbortController();
  const timeout = AbortSignal.timeout(45000);
  const signal = AbortSignal.any([request.signal, downstream.signal, timeout]);
  const disconnected = () => request.signal.aborted || downstream.signal.aborted;

  async function relay(controller: ReadableStreamDefaultController<Uint8Array>) {
    const send = (event: string, data: unknown) => {
      if (!disconnected()) controller.enqueue(encoder.encode(sse(event, data)));
    };

    try {
      signal.throwIfAborted();
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
        signal,
      });

      if (!upstream.ok) {
        void upstream.body?.cancel().catch(() => console.error("Chat provider error body cleanup failed"));
        throw new ProviderStreamError("http-error");
      }
      if (!upstream.body) throw new ProviderStreamError("empty-stream");

      let raw = "";
      let sentText = "";
      await readProviderStream(upstream.body, signal, (content) => {
        raw += content;
        // Each preview is a snapshot. A slow client can skip snapshots and still receive the final answer.
        if ((controller.desiredSize ?? 0) <= 0) return;
        const partial = readAnswerField(raw);
        if (partial && partial.length > sentText.length) {
          sentText = partial;
          send("delta", { text: previewText(partial) });
        }
      });
      signal.throwIfAborted();

      const grounded = groundAnswer(parsePayload(raw), evidence);
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
      if (!disconnected()) {
        const reason = timeout.aborted ? "timeout" :
          error instanceof ProviderStreamError ? error.message : "transport-error";
        console.error("Chat provider stream failed", reason);
        send("fallback", curatedAnswer(question, recent));
      }
    } finally {
      if (!downstream.signal.aborted) controller.close();
    }
  }

  let settled: Promise<void>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      settled = relay(controller);
      return settled;
    },
    cancel() {
      downstream.abort();
      return settled;
    },
  }, { highWaterMark: MAX_QUEUED_PREVIEWS });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
