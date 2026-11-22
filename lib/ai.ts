import { buildContext, curatedAnswer, isSmallTalk, retrieve, unverifiedAnswer } from "./ask";
import { formatEvidence, groundAnswer, GROUNDING_INSTRUCTIONS, type ModelAnswer } from "./grounding";
import type { AskResult } from "./types";

const ENDPOINT = "https://api.cencori.com/v1/chat/completions";
const DEFAULT_MODEL = "maximo-atlas-1.5";

const SYSTEM_PROMPT = `You are Nigeria, an AI assistant for Nigerian government services. Speak in the first person as Nigeria: a calm, warm guide who helps citizens find and complete government services.

Identity:
- When asked who or what you are, say you are Nigeria, an AI assistant that helps people with Nigerian government services.
- If asked whether you are official or run by the government, say honestly that you are an independent assistant, not an official government service, and that official decisions, payments and applications happen on the agency's own website.
- Never claim to process applications, issue documents, take payments or access anyone's records.

Never ask for personal data such as a BVN, NIN, card number or password.
${GROUNDING_INSTRUCTIONS}`;

function parsePayload(content: string): ModelAnswer | null {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  try {
    return JSON.parse(cleaned) as ModelAnswer;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as ModelAnswer;
    } catch {
      return null;
    }
  }
}

async function askCencori(question: string): Promise<AskResult | null> {
  const key = process.env.CENCORI_API_KEY;
  if (!key) return null;

  const evidence = buildContext(question);
  const notes = formatEvidence(evidence);
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: process.env.CENCORI_MODEL || DEFAULT_MODEL,
      temperature: 0.2,
      max_tokens: 500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `EVIDENCE:\n${notes || "No request-specific evidence."}\n\nQUESTION: ${question}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(18000),
  });

  if (!response.ok) {
    throw new Error(`Cencori returned ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) return null;

  const payload = parsePayload(content);
  if (!payload || typeof payload.answer !== "string" || !payload.answer.trim()) {
    return null;
  }

  const grounded = groundAnswer(payload, evidence);
  if (!grounded) return unverifiedAnswer();
  const fallback = retrieve(question, 1)[0]?.entry;

  return {
    ...grounded,
    followUps:
      fallback?.followUps ??
      ["How do I get a NIN?", "How do I register a business?", "How do I apply for a student loan?"],
  };
}

export async function answerQuestion(question: string): Promise<AskResult> {
  if (!process.env.CENCORI_API_KEY || isSmallTalk(question)) {
    return curatedAnswer(question);
  }

  try {
    const result = await askCencori(question);
    if (result) return result;
  } catch {
    console.error("Ask provider request failed; using curated answer");
  }

  return curatedAnswer(question);
}
