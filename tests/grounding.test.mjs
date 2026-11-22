import assert from "node:assert/strict";
import { test } from "node:test";
import { groundAnswer } from "../lib/grounding.ts";

const source = { id: "p1", title: "Fixture", agency: "Fixture agency", url: "https://agency.example.invalid/Permits" };
const block = { title: source.title, text: "Only eligible applicants may renew.", sources: [source] };
const payload = { answer: block.text, sourceIds: ["p1"], confident: true };

test("a retrieved source cannot support prose from a different evidence block", () => {
  const other = { ...block, text: "Applications reopen next month.", sources: [{ ...source, id: "p2" }] };
  assert.equal(groundAnswer({ ...payload, answer: other.text }, [block, other]), null);
  assert.equal(groundAnswer({ ...payload, sourceIds: ["p1", "p2"] }, [block, other]), null);
});

test("copying a clipped excerpt or dropping a qualification cannot be confident", () => {
  assert.equal(groundAnswer(payload, [{ ...block, incomplete: true }]), null);
  assert.equal(groundAnswer({ ...payload, answer: "Applicants may renew." }, [block]), null);
});

test("an approved link must match the exact cited HTTPS URL", () => {
  const answer = "[Only eligible applicants](https://agency.example.invalid/permits) may renew.";
  assert.equal(groundAnswer({ ...payload, answer }, [block]).answer, block.text);
  for (const url of ["http://agency.example.invalid/Permits", "https://name@agency.example.invalid/Permits"]) {
    assert.equal(groundAnswer(payload, [{ ...block, sources: [{ ...source, url }] }]), null);
  }
});
