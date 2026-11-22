import { answerQuestion } from "@/lib/ai";
import { readAnswerRequest } from "@/lib/answer-request";

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

  try {
    const result = await answerQuestion(input.question);
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    console.error("Ask route failed");
    return Response.json(
      { error: "Something went wrong while looking that up. Please try again." },
      { status: 500 },
    );
  }
}
