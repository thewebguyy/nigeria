import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

test("chat accepts current indexed evidence and excludes prior-topic hits after a switch", (context) => {
  const cwd = mkdtempSync(join(tmpdir(), "nigeriaai-grounded-pages-"));
  context.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, "index"));
  const passage = "Passport renewal starts online for fixture passports.";
  const source = "https://public.example.invalid/Passport";
  const db = new DatabaseSync(join(cwd, "index", "pages.db"));
  try {
    db.exec(`
      CREATE TABLE pages (id INTEGER PRIMARY KEY, url TEXT, host TEXT, title TEXT, body TEXT);
      CREATE VIRTUAL TABLE pages_fts USING fts5(title, body, host, content='pages',
        content_rowid='id', tokenize='porter unicode61');
    `);
    db.prepare("INSERT INTO pages VALUES (1, ?, ?, ?, ?)").run(
      source, "public.example.invalid", "Passport renewal", passage,
    );
    db.exec("INSERT INTO pages_fts(pages_fts) VALUES ('rebuild')");
  } finally {
    db.close();
  }

  const route = new URL("../app/api/chat/route.ts", import.meta.url);
  const register = new URL("./support/register.mjs", import.meta.url);
  // Exit the child before cleaning up the production read-only SQLite handle.
  const probe = `
    import { POST } from ${JSON.stringify(route.href)};
    process.env.CENCORI_API_KEY = "synthetic-test-value";
    const passage = ${JSON.stringify(passage)};
    const passport = "How do I renew my passport?";
    const outputs = [];
    let prompt;
    globalThis.fetch = async (_url, options) => {
      prompt = JSON.parse(options.body).messages.at(-1).content;
      const answer = JSON.stringify({ answer: passage, sourceIds: ["p1"], confident: true });
      return new Response("data: " + JSON.stringify({ choices: [{ delta: { content: answer } }] }) +
        "\\n\\ndata: [DONE]\\n\\n");
    };
    for (const [question, history] of [[passport, []], ["How do I apply for a visa?", [
      { role: "user", content: passport },
    ]]]) {
      const response = await POST(new Request("https://app.example.invalid/api/chat", {
        method: "POST", body: JSON.stringify({ question, history }),
      }));
      outputs.push({ prompt, stream: await response.text() });
    }
    console.log(JSON.stringify(outputs));
  `;
  const child = spawnSync(process.execPath, [
    "--import", register.href, "--input-type=module", "--eval", probe,
  ], { cwd, encoding: "utf8", timeout: 10_000 });
  if (child.error) throw child.error;
  assert.equal(child.status, 0, child.stderr);
  const [current, switched] = JSON.parse(child.stdout);
  assert.match(current.prompt, /^Sources: p1 \(/m);
  assert.match(current.stream, /^event: done$/m);
  assert.match(current.stream, /"id":"p1"/);
  assert.doesNotMatch(switched.prompt, /^Sources: p1 \(/m);
  assert.match(switched.stream, /^event: fallback$/m);
  assert.match(switched.stream, /"confident":false/);
  assert.doesNotMatch(switched.stream, /"id":"p1"/);
});
