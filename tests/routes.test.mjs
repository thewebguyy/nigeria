import assert from "node:assert/strict";
import { mkdtempSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, mock, test } from "node:test";
import { ANSWER_MAP } from "../lib/answers.ts";
import { SOURCE_MAP } from "../lib/sources.ts";
import { knownDefect } from "./support/known-defect.mjs";

const QUESTION = "How do I renew my passport?";
const PASSPORT_SOURCES = ["nis-passports", "nis-knowledge"];
const MODEL_ANSWER = ANSWER_MAP.get("passport-renew").answer;
const PORTAL_SOURCES = ["egov-home", "egov-services", "nigeria-gov"];
const GATEWAY = "https://api.cencori.com/v1/chat/completions";
const FIXTURE_KEY = "synthetic-test-value";
let requestCount = 0;
let upstream;
let calls = [];
let originalDirectory;
let fixtureDirectory;
let askRoute;
let chatRoute;
const ask = (input) => askRoute.POST(input);
const chat = (input) => chatRoute.POST(input);

before(async () => {
  delete process.env.CENCORI_API_KEY;
  delete process.env.CENCORI_MODEL;
  mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    assert.ok(upstream, "Unexpected outbound fetch attempt");
    return upstream();
  });
  originalDirectory = process.cwd();
  fixtureDirectory = mkdtempSync(join(tmpdir(), "nigeriaai-routes-"));
  process.chdir(fixtureDirectory);
  // The search module resolves its index path when it is first imported.
  [askRoute, chatRoute] = await Promise.all([
    import("../app/api/ask/route.ts"),
    import("../app/api/chat/route.ts"),
  ]);
  assert.equal(calls.length, 0, "Route imports must not attempt network access");
});

after(() => {
  mock.restoreAll();
  if (!fixtureDirectory) return;
  process.chdir(originalDirectory);
  rmdirSync(fixtureDirectory);
});

beforeEach(() => {
  delete process.env.CENCORI_API_KEY;
  delete process.env.CENCORI_MODEL;
  upstream = undefined;
  calls = [];
});

function request(endpoint, question = QUESTION, malformed = false, history) {
  return new Request(`https://nigeriaai.example.invalid/api/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": `192.0.2.${++requestCount}`,
    },
    body: malformed ? "{" : JSON.stringify({ question, history }),
  });
}

function useGateway(response) {
  process.env.CENCORI_API_KEY = FIXTURE_KEY;
  upstream = response;
}

function assertGatewayRequest(stream, question = QUESTION) {
  assert.equal(calls.length, 1);
  const { url, options } = calls[0];
  assert.equal(url, GATEWAY);
  assert.equal(options.method, "POST");
  assert.equal(options.headers.Authorization, `Bearer ${FIXTURE_KEY}`);
  const body = JSON.parse(options.body);
  assert.equal(Boolean(body.stream), stream);
  assert.ok(body.messages.at(-1).content.endsWith(`QUESTION: ${question}`));
  return body.messages;
}

function modelPayload(sourceIds, answer = MODEL_ANSWER, options) {
  return JSON.stringify({ answer, sourceIds, confident: true, agencyUrl: null, ...options });
}

function modelDelta(content) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

function chatStream(content, complete = true) {
  return new Response(modelDelta(content) + (complete ? "data: [DONE]\n\n" : ""));
}

async function readJson(response) {
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type"), /^application\/json\b/);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  return response.json();
}

async function readEvents(response) {
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type"), /^text\/event-stream\b/);
  const text = (await response.text()).replaceAll("\r\n", "\n");
  assert.ok(text.endsWith("\n\n"), "SSE response must end with a complete frame");
  const frames = text.slice(0, -2).split("\n\n");
  return frames.map((frame) => {
    const match = /^event: ([a-z]+)\ndata: (.+)$/.exec(frame);
    assert.ok(match, `Unexpected SSE frame: ${frame}`);
    return { event: match[1], data: JSON.parse(match[2]) };
  });
}

function summary(result) {
  return {
    mode: result.mode,
    confident: result.confident,
    sourceIds: result.sources.map(({ id }) => id),
  };
}

function assertCuratedPassport(result) {
  assert.equal(result.answer, ANSWER_MAP.get("passport-renew").answer);
  assert.deepEqual(summary(result), {
    mode: "curated", confident: true, sourceIds: PASSPORT_SOURCES,
  });
}

for (const [endpoint, handler] of [["chat", chat], ["ask", ask]]) {
  test(`${endpoint} rejects malformed JSON, blank and oversized questions`, async () => {
    for (const input of [request(endpoint, QUESTION, true), request(endpoint, "  "),
      request(endpoint, "x".repeat(601))]) {
      const response = await handler(input);
      assert.equal(response.status, 400);
      assert.equal(typeof (await response.json()).error, "string");
    }
    const boundary = await handler(request(endpoint, "x".repeat(600)));
    assert.equal(boundary.status, 200);
    await boundary.json();
    assert.equal(calls.length, 0);
  });

  test(`${endpoint} returns curated JSON without an API key`, async () => {
    const result = await readJson(await handler(request(endpoint)));
    assertCuratedPassport(result);
    assert.equal(calls.length, 0);
  });

  test(`${endpoint} handles greetings locally even with a model key`, async () => {
    useGateway(() => Response.json({ choices: [{ message: { content: modelPayload([], "Hello.") } }] }));
    const result = await readJson(await handler(request(endpoint, "Hello")));
    assert.match(result.answer, /^Hello\./);
    assert.deepEqual(summary(result), { mode: "curated", confident: true, sourceIds: [] });
    assert.equal(calls.length, 0);
  });

  test(`${endpoint} falls back on provider HTTP 503`, async (context) => {
    context.mock.method(console, "error", () => {});
    useGateway(() => new Response(null, { status: 503 }));
    const response = await handler(request(endpoint));
    let result;
    if (endpoint === "chat") {
      const events = await readEvents(response);
      assert.deepEqual(events.map(({ event }) => event), ["fallback"]);
      result = events[0].data;
    } else {
      result = await readJson(response);
    }
    assertCuratedPassport(result);
    assertGatewayRequest(endpoint === "chat");
  });
}

test("chat rejects a non-string question", async () => {
  const response = await chat(request("chat", {}));
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test("chat answers a follow-up using the last identified user topic", async () => {
  const history = [
    { role: "user", content: "How do I register for NYSC?" },
    { role: "user", content: QUESTION },
    { role: "assistant", content: "I can also help you get a NIN." },
    { role: "user", content: "Can I renew it?" },
  ];
  const result = await readJson(await chat(request("chat", "How much is it?", false, history)));
  assert.equal(result.answer, ANSWER_MAP.get("passport-fee").answer);
  assert.deepEqual(summary(result), {
    mode: "curated", confident: true, sourceIds: ["nis-passports", "nis-knowledge", "nis-contact"],
  });
  assert.equal(calls.length, 0);
});

test("ask abstains when a renewal question names an unsupported service", async () => {
  const result = await readJson(await ask(request("ask", "How do I renew my streaming subscription?")));
  assert.deepEqual(summary(result), {
    mode: "curated", confident: false, sourceIds: ["egov-home", "egov-services", "nigeria-gov"],
  });
  assert.equal(calls.length, 0);
});

knownDefect("ASK-01", "ask rejects a non-string question", 400, 200, async () => {
  const response = await ask(request("ask", {}));
  await response.json();
  assert.equal(calls.length, 0);
  return response.status;
});

test("chat sends a delta and a cited done event through split UTF-8 frames", async () => {
  const answer = MODEL_ANSWER.replace(" ", "\u00a0");
  const content = modelPayload([...PASSPORT_SOURCES, "unknown-fixture-id"], answer);
  const bytes = Buffer.from(modelDelta(content) + "data: [DONE]\n\n");
  const split = bytes.indexOf(Buffer.from("\u00a0")) + 1;
  assert.ok(split > 1, "fixture must split inside a UTF-8 character");
  useGateway(() => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, split));
      controller.enqueue(bytes.subarray(split));
      controller.close();
    },
  })));
  const events = await readEvents(await chat(request("chat")));
  assert.deepEqual(events.map(({ event }) => event), ["delta", "done"]);
  assert.deepEqual(events[0].data, { text: answer });
  assert.equal(events[1].data.answer, answer);
  assert.deepEqual(summary(events[1].data), {
    mode: "ai", confident: true, sourceIds: PASSPORT_SOURCES,
  });
  assertGatewayRequest(true);
});

test("ask returns a cited AI answer and filters an unknown source ID", async () => {
  useGateway(() => Response.json({
    choices: [{ message: { content: modelPayload([...PASSPORT_SOURCES, "unknown-fixture-id"]) } }],
  }));
  const result = await readJson(await ask(request("ask")));
  assert.equal(result.answer, MODEL_ANSWER);
  assert.deepEqual(summary(result), {
    mode: "ai", confident: true, sourceIds: PASSPORT_SOURCES,
  });
  assertGatewayRequest(false);
});

test("chat sends fallback after a preview when provider JSON is incomplete", async (context) => {
  context.mock.method(console, "error", () => {});
  useGateway(() => chatStream('{"answer":"Synthetic preview'));
  const events = await readEvents(await chat(request("chat")));
  assert.deepEqual(events.map(({ event }) => event), ["delta", "fallback"]);
  assert.deepEqual(events[0].data, { text: "Synthetic preview" });
  assertCuratedPassport(events[1].data);
  assertGatewayRequest(true);
});

test("ask returns curated JSON for incomplete model JSON", async () => {
  useGateway(() => Response.json({ choices: [{ message: { content: '{"answer":' } }] }));
  const result = await readJson(await ask(request("ask")));
  assertCuratedPassport(result);
  assertGatewayRequest(false);
});

for (const [label, sourceIds, answer, options] of [
  ["missing citations", undefined],
  ["unknown citations only", ["unknown-fixture-id"]],
  ["an unrelated catalogue ID", ["jamb-portal"]],
  ["an incomplete source set", ["nis-passports"]],
  ["a valid citation set with an invented fee", PASSPORT_SOURCES, "Renewal costs exactly ₦123."],
  ["a valid citation set with altered instructions", PASSPORT_SOURCES,
    MODEL_ANSWER.replace("not at the office", "at the office")],
  ["a model-declared low-confidence answer", PASSPORT_SOURCES, MODEL_ANSWER, { confident: false }],
]) {
  for (const endpoint of ["chat", "ask"]) {
    test(`${endpoint} withholds model text with ${label}`, async () => {
      const content = modelPayload(sourceIds, answer, options);
      const { result, events } = await runModel(endpoint, content);
      if (endpoint === "chat") assert.deepEqual(events.map(({ event }) => event), ["delta", "fallback"]);
      assert.deepEqual(summary(result), {
        mode: "curated", confident: false, sourceIds: PORTAL_SOURCES,
      });
      assert.notEqual(result.answer, answer ?? MODEL_ANSWER);
    });
  }
}

async function runModel(endpoint, content, question = QUESTION) {
  if (endpoint === "chat") {
    useGateway(() => chatStream(content));
    const events = await readEvents(await chat(request(endpoint, question)));
    const messages = assertGatewayRequest(true, question);
    return { result: events.at(-1).data, events, messages };
  }
  useGateway(() => Response.json({ choices: [{ message: { content } }] }));
  const result = await readJson(await ask(request(endpoint, question)));
  return { result, messages: assertGatewayRequest(false, question) };
}

test("chat deduplicates the cited evidence and excludes unrelated catalogue entries from the prompt", async () => {
  const { result, events, messages } = await runModel("chat",
    modelPayload([...PASSPORT_SOURCES, "nis-passports", "jamb-portal"], MODEL_ANSWER,
      { agencyUrl: SOURCE_MAP.get("jamb-portal").url }));
  assert.deepEqual(events.map(({ event }) => event), ["delta", "done"]);
  assert.deepEqual(summary(result), {
    mode: "ai", confident: true, sourceIds: PASSPORT_SOURCES,
  });
  assert.equal(result.agency.url, SOURCE_MAP.get("nis-passports").url);
  assert.ok(messages.at(-1).content.includes(MODEL_ANSWER));
  assert.ok(messages.every(({ content }) => !content.includes("jamb-portal")));
});

test("ask cannot reuse citations from an earlier request", async () => {
  const content = modelPayload(PASSPORT_SOURCES);
  const { result } = await runModel("ask", content, "How do I apply for a visa?");
  assert.deepEqual(summary(result), {
    mode: "curated", confident: false, sourceIds: PORTAL_SOURCES,
  });
});

test("chat emits plain preview text and permits only cited links in the final answer", async () => {
  const approved = SOURCE_MAP.get("nis-passports").url;
  const unapproved = SOURCE_MAP.get("jamb-portal").url;
  const answer = MODEL_ANSWER.replace("NIS passport portal", `[NIS passport portal](${approved})`)
    .replace("NIS portal and select", `[NIS portal](${unapproved}) and select`);
  const { events, result } = await runModel("chat", modelPayload(PASSPORT_SOURCES, answer));
  assert.deepEqual(events.map(({ event }) => event), ["delta", "done"]);
  assert.equal(events[0].data.text, MODEL_ANSWER);
  assert.ok(result.answer.includes(`[NIS passport portal](${approved})`));
  assert.ok(!result.answer.includes(unapproved));
});

test("chat strips a link destination even if it arrives before the closing parenthesis", async () => {
  const unapproved = "https://unlisted.example.invalid/reference";
  const answer = MODEL_ANSWER.replace("NIS passport portal", `[NIS passport portal](${unapproved})`);
  const payload = modelPayload(PASSPORT_SOURCES, answer);
  const split = payload.indexOf(unapproved) + unapproved.length;
  useGateway(() => new Response(new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(modelDelta(payload.slice(0, split))));
      controller.enqueue(encoder.encode(modelDelta(payload.slice(split)) + "data: [DONE]\n\n"));
      controller.close();
    },
  })));
  const events = await readEvents(await chat(request("chat")));
  assert.deepEqual(events.map(({ event }) => event), ["delta", "delta", "done"]);
  assert.ok(events.every(({ data }) => !(data.text ?? data.answer).includes(unapproved)));
  assert.equal(events.at(-1).data.answer, MODEL_ANSWER);
});

knownDefect("CHAT-06", "chat rejects provider EOF before the completion marker",
  ["delta", "fallback"], ["delta", "done"], async () => {
    useGateway(() => chatStream(modelPayload(PASSPORT_SOURCES), false));
    const events = await readEvents(await chat(request("chat")));
    assertGatewayRequest(true);
    return events.map(({ event }) => event);
  });
