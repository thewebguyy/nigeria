const MAX_STREAM_BYTES = 256 * 1024;

export class ProviderStreamError extends Error {
  constructor(reason: "http-error" | "empty-stream" | "oversized-stream" |
    "premature-eof" | "invalid-event" | "provider-error" | "incomplete-model" | "invalid-model-json") {
    super(reason);
  }
}

function readChunk(data: string) {
  let chunk: { error?: unknown; choices?: unknown } | null;
  try {
    chunk = JSON.parse(data);
  } catch {
    throw new ProviderStreamError("invalid-event");
  }
  if (chunk?.error != null) throw new ProviderStreamError("provider-error");
  if (!Array.isArray(chunk?.choices) || chunk.choices.length > 1) {
    throw new ProviderStreamError("invalid-event");
  }
  if (chunk.choices.length === 0) return { content: "", stopped: false }; // Usage-only chunk.
  const choice = chunk.choices[0] as {
    index?: unknown;
    delta?: { content?: unknown } | null;
    finish_reason?: unknown;
  } | null;
  if (!choice || typeof choice !== "object" || Array.isArray(choice) ||
      (choice.index !== undefined && choice.index !== 0) ||
      (choice.delta != null && (typeof choice.delta !== "object" || Array.isArray(choice.delta)))) {
    throw new ProviderStreamError("invalid-event");
  }
  if (choice.finish_reason != null && choice.finish_reason !== "stop") {
    throw new ProviderStreamError("incomplete-model");
  }
  const content = choice.delta?.content;
  if (content != null && typeof content !== "string") throw new ProviderStreamError("invalid-event");
  return { content: content ?? "", stopped: choice.finish_reason === "stop" };
}

/** Read OpenAI-compatible Chat Completions SSE through the first dispatched [DONE]. */
export async function readProviderStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onContent: (content: string) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let cancelling = false;
  const cancelReader = () => {
    if (cancelling) return;
    cancelling = true;
    void reader.cancel().catch(() => console.error("Chat provider stream cleanup failed"));
  };
  signal.addEventListener("abort", cancelReader, { once: true });

  let bytes = 0;
  let line = "";
  let skipLF = false;
  let data: string[] = [];
  let event = "";
  let stopped = false;
  try {
    signal.throwIfAborted();
    while (true) {
      const result = await reader.read();
      signal.throwIfAborted();
      if (result.done) throw new ProviderStreamError("premature-eof");
      const input = result.value;
      const characters = decoder.decode(input.subarray(0, MAX_STREAM_BYTES - bytes), { stream: true });
      bytes += input.byteLength;
      for (const char of characters) {
        if (skipLF) {
          skipLF = false;
          if (char === "\n") continue;
        }
        if (char !== "\r" && char !== "\n") {
          line += char;
          continue;
        }
        skipLF = char === "\r";
        if (line === "") {
          if (data.length > 0 && event === "error") throw new ProviderStreamError("provider-error");
          if (data.length > 0 && (event === "" || event === "message")) {
            const payload = data.join("\n");
            if (payload === "[DONE]") return;
            const chunk = readChunk(payload);
            if (stopped && chunk.content) throw new ProviderStreamError("invalid-event");
            stopped ||= chunk.stopped;
            if (chunk.content) onContent(chunk.content);
          }
          data = [];
          event = "";
        } else {
          const colon = line.indexOf(":");
          const field = colon === -1 ? line : line.slice(0, colon);
          const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
          if (field === "data") data.push(value);
          if (field === "event") event = value;
        }
        line = "";
      }
      if (bytes > MAX_STREAM_BYTES) throw new ProviderStreamError("oversized-stream");
    }
  } finally {
    signal.removeEventListener("abort", cancelReader);
    cancelReader();
    reader.releaseLock();
  }
}
