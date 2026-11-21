import { buildContext, centreAnswer, curatedAnswer, isSmallTalk, retrieve, sourceCatalogue } from "@/lib/ask";
import { SOURCES } from "@/lib/sources";
import { pageRef, searchPages, type PageHit } from "@/lib/search";
import type { AskResult, SourceRef } from "@/lib/types";

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

Answer only from the SOURCES and NOTES provided. Never invent fees, dates, requirements, office addresses or URLs.

Rules:
- Greetings, thanks and small talk ("hello", "thank you", "good morning") get one or two short, warm sentences and an offer to help. No introduction speech, no disclaimers, and sourceIds must be an empty array.
- Do not say you are independent or unofficial unless the person asks who you are or whether you are official. Never add it as a closing line.
- If the sources do not support a reliable answer, say plainly that you do not know and point the person to the closest official agency in the sources.
- Write in plain standard English, warm and human, as a knowledgeable friend would explain it. Short sentences. No jargon, no exclamation marks, no emoji.
- Format answers for scanning. For anything beyond a one-line reply:
  - Group the answer under 1 to 3 short section headings, each on its own line starting with "## " (for example "## What to bring").
  - Use **bold** for the few facts people must not miss: fees, deadlines, where to go, what is free.
  - Put lists on their own lines starting with "- ".
  - Link key words inline to the official page they come from, as [link text](url). Use only URLs that appear in the SOURCES list or the notes; never make up a URL. Link 1 to 4 places, on short phrases like [the NIS passport portal](https://immigration.gov.ng/passports/), not whole sentences.
  - Keep the whole answer under 200 words.
- Greetings and very short replies stay as one or two plain sentences with no headings.
- You may use the earlier conversation to understand follow-up questions, but every fact must still come from the sources.
- Also list every id you relied on in sourceIds, from the SOURCES list or the "Government web pages" notes (ids like p123). Prefer a specific web page over a general homepage when it answers the question.
- Fees and processing times change. Where they matter, say they should be confirmed on the official site.
- Never ask for personal data such as a BVN, NIN, card number or password.

You must reply with one JSON object and nothing else:
{"answer": "string", "sourceIds": ["id"], "confident": true, "agencyUrl": "https://..." or null}

SOURCES:
${sourceCatalogue()}`;

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

function sourceRefs(ids: string[], hits: PageHit[] = []): SourceRef[] {
  return ids
    .map((id) => {
      const hit = hits.find((page) => page.id === id);
      if (hit) return pageRef(hit);
      const source = SOURCES.find((item) => item.id === id);
      return source ? { id: source.id, agency: source.agency, title: source.title, url: source.url } : null;
    })
    .filter((ref): ref is SourceRef => Boolean(ref));
}

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Keeps [text](url) links only for URLs the model was actually given; others become plain text. */
function keepKnownLinks(answer: string, allowed: Set<string>) {
  const strip = (url: string) => url.trim().replace(/\/+$/, "").toLowerCase();
  const ok = new Set([...allowed].map(strip));
  return answer.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, text: string, url: string) =>
    /^https:\/\//.test(url) && ok.has(strip(url)) ? match : text,
  );
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
  // Search the crawled government pages; only the best matches go to the model.
  const hits = searchPages([question, ...recent].join(" "), 6);
  const notes = [
    centre
      ? `### Enrolment centres\nNIMC publishes the official enrolment-centre finder: ${centre.action?.url}. You do not have individual centre names or addresses, so never invent any. Tell the person the finder is linked below, filtered for their area if known, and to call ahead.`
      : "",
    buildContext(question, recent),
    hits.length
      ? `### Government web pages (cite these by id, e.g. ${hits[0].id})\n${hits
          .map((hit) => `- ${hit.id} | ${hit.host} | ${hit.title} | ${hit.url}\n  ${hit.excerpt}`)
          .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
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
                content: `NOTES:\n${notes || "No close match in the curated notes."}\n\nQUESTION: ${question}`,
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
            send("delta", { text: partial });
          }
        }

        const parsed = parsePayload(raw) as {
          answer?: unknown;
          sourceIds?: unknown;
          confident?: unknown;
          agencyUrl?: unknown;
        } | null;

        if (!parsed || typeof parsed.answer !== "string" || !parsed.answer.trim()) {
          throw new Error("The model did not return a usable answer.");
        }

        const known = new Set([...SOURCES.map((source) => source.id), ...hits.map((hit) => hit.id)]);
        const requested = Array.isArray(parsed.sourceIds) ? parsed.sourceIds : [];
        const ids = requested.filter(
          (id): id is string => typeof id === "string" && known.has(id),
        );

        const fallback = retrieve(question, 1, recent)[0]?.entry;
        const confident = parsed.confident === true;
        // Cite only what the model actually relied on; small talk cites nothing.
        const chosen = ids;

        const agencyUrl =
          typeof parsed.agencyUrl === "string" &&
          SOURCES.some((source) => source.url === parsed.agencyUrl)
            ? parsed.agencyUrl
            : fallback?.agency.url ?? "https://services.gov.ng/";

        const final: AskResult = {
          answer: keepKnownLinks(
            parsed.answer.trim(),
            new Set([
              ...SOURCES.map((source) => source.url),
              ...hits.map((hit) => hit.url),
              ...(centre?.action ? [centre.action.url] : []),
            ]),
          ),
          sources: sourceRefs(chosen, hits),
          mode: "ai",
          confident,
          agency: {
            name:
              SOURCES.find((source) => source.url === agencyUrl)?.agency ??
              fallback?.agency.name ??
              "the official agency",
            url: agencyUrl,
          },
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
