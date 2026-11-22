import assert from "node:assert/strict";
import { after, test } from "node:test";
import { ANSWERS, ANSWER_MAP } from "../lib/answers.ts";
import { buildContext, curatedAnswer, retrieve } from "../lib/ask.ts";
import { formatEvidence } from "../lib/grounding.ts";
import { SOURCES } from "../lib/sources.ts";
import { centreCases, contextualCases, negatives, positives } from "./fixtures/questions.mjs";

for (const { question, answerId, sourceIds } of positives) {
  test(`curated answers ${question}`, () => {
    assert.equal(retrieve(question)[0]?.entry.id, answerId);
    assertCuratedAnswer(question, "", answerId, sourceIds);
  });
}

const PORTAL_SOURCES = ["egov-home", "egov-services", "nigeria-gov"];

function assertCuratedAnswer(question, context, answerId, sourceIds) {
  const result = curatedAnswer(question, context);
  assert.equal(result.mode, "curated");
  assert.equal(result.confident, true);
  assert.equal(result.answer, ANSWER_MAP.get(answerId).answer);
  assert.deepEqual(result.sources.map(({ id }) => id), sourceIds);
}

function assertAbstains(question, context = "") {
  const result = curatedAnswer(question, context);
  assert.equal(result.mode, "curated");
  assert.equal(result.confident, false, result.answer);
  assert.deepEqual(result.sources.map(({ id }) => id), PORTAL_SOURCES);
  assert.deepEqual(retrieve(question, 1, context), []);
  assert.deepEqual(buildContext(question, context), []);
}

for (const { question } of negatives) {
  test(`curated abstains on ${question}`, () => assertAbstains(question));
}

for (const { question, context, answerId, sourceIds } of contextualCases) {
  test(`curated handles ${question} after ${JSON.stringify(context)}`, () => {
    if (answerId === null) {
      assertAbstains(question, context);
      return;
    }
    assertCuratedAnswer(question, context, answerId, sourceIds);
    assert.equal(retrieve(question, 1, context)[0]?.entry.id, answerId);
    assert.ok(formatEvidence(buildContext(question, context)).startsWith(`### ${ANSWER_MAP.get(answerId).title}\n`));
  });
}

for (const { question, context, answerId } of centreCases) {
  test(`curated points to the official NIMC finder for ${question}`, () => {
    const result = curatedAnswer(question, context);
    assert.equal(result.mode, "curated");
    assert.equal(result.confident, true);
    assert.match(result.answer, /Ikeja/);
    assert.deepEqual(result.sources.map(({ id }) => id), [answerId, "nimc-enrol"]);
    assert.ok(result.action?.url.startsWith("https://nimc.gov.ng/"));
    assert.equal(result.agency?.url, result.action.url);
  });
}

after((context) => {
  const correct = positives.filter(({ question, answerId }) =>
    retrieve(question)[0]?.entry.id === answerId).length;
  const falseConfidence = negatives.filter(({ question }) => curatedAnswer(question).confident).length;
  const total = positives.length + negatives.length + contextualCases.length + centreCases.length;
  context.diagnostic(`Curated top-1: ${correct}/${positives.length}. False confidence: ${falseConfidence}/${negatives.length}. Total cases: ${total}.`);
});

test("curated source IDs are unique and every curated reference resolves", () => {
  const ids = new Set(SOURCES.map(({ id }) => id));
  assert.equal(ids.size, SOURCES.length);
  for (const answer of ANSWERS) {
    assert.equal(new Set(answer.sourceIds).size, answer.sourceIds.length, answer.id);
    for (const id of answer.sourceIds) assert.ok(ids.has(id), `${answer.id} cites unknown ID ${id}`);
  }
});
