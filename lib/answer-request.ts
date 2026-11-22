const MAX_BODY_BYTES = 64 * 1024;
const MAX_QUESTION_LENGTH = 600;

export async function readAnswerRequest(request: Request): Promise<Response | {
  question: string;
  history: unknown;
}> {
  const mediaType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  // Fetch string bodies historically used text/plain. The body must still be UTF-8 JSON.
  if (mediaType && mediaType !== "text/plain" &&
      !/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)$/.test(mediaType)) {
    return Response.json({ error: "Send a JSON request body." }, { status: 415 });
  }

  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "Send a valid JSON request body." }, { status: 400 });

  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  let payload: unknown;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        return Response.json({ error: "The request body exceeds 64 KiB." }, { status: 413 });
      }
      text += decoder.decode(value, { stream: true });
    }
    payload = JSON.parse(text + decoder.decode());
  } catch {
    return Response.json({ error: "Send a valid JSON request body." }, { status: 400 });
  } finally {
    // Do not wait on the upload producer to acknowledge cancellation.
    void reader.cancel().catch(() => console.error("Answer request body cleanup failed"));
    reader.releaseLock();
  }

  const body = payload as { question?: unknown; history?: unknown } | null;
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question) {
    return Response.json({ error: "Type a question first." }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return Response.json(
      { error: "That question is too long. Keep it at 600 characters or fewer." },
      { status: 400 },
    );
  }
  return { question, history: body?.history };
}
