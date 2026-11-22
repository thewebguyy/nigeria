import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { knownDefect } from "./support/known-defect.mjs";

const QUERY = "passport renewal";
const PASSPORT_URL = "https://passport.example.invalid/renewal";
const LOAN_URL = "https://loan.example.invalid/renewal";
const probes = new URL("./support/index-probe.mjs", import.meta.url);
const register = new URL("./support/register.mjs", import.meta.url);

function createIndex(filename) {
  const db = new DatabaseSync(filename);
  try {
    // Match the crawler's pages columns, FTS tokenizer, row IDs, and insert trigger.
    db.exec(`
      CREATE TABLE pages (id INTEGER PRIMARY KEY, url TEXT UNIQUE, host TEXT,
        title TEXT, body TEXT, fetched_at TEXT);
      CREATE VIRTUAL TABLE pages_fts USING fts5(title, body, host, content='pages',
        content_rowid='id', tokenize='porter unicode61');
      CREATE TRIGGER pages_ai AFTER INSERT ON pages BEGIN
        INSERT INTO pages_fts(rowid, title, body, host)
        VALUES (new.id, new.title, new.body, new.host);
      END;
    `);
    const insert = db.prepare(
      "INSERT INTO pages (url, host, title, body, fetched_at) VALUES (?, ?, ?, ?, ?)",
    );
    insert.run(PASSPORT_URL, "passport.example.invalid", "Passport renewal",
      "Passport renewal checklist for the fixture.", "2026-01-01T00:00:00Z");
    insert.run(LOAN_URL, "loan.example.invalid", "Loan renewal",
      "Loan renewal checklist for the fixture.", "2026-01-01T00:00:00Z");
  } finally {
    db.close();
  }
}

function runSearch(context, prepare, questions, readStats = false) {
  const cwd = mkdtempSync(join(tmpdir(), "nigeriaai-search-"));
  context.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, "index"));
  if (prepare) prepare(join(cwd, "index", "pages.db"));

  // Let the child exit before cleanup so the production SQLite handle closes on Windows.
  const child = spawnSync(process.execPath, [
    "--import", register.href,
    fileURLToPath(probes), JSON.stringify({ questions, readStats }),
  ], { cwd, encoding: "utf8", timeout: 10_000 });
  if (child.error) throw child.error;
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

test("initialises the FTS index and ranks the relevant document first on repeat queries", (context) => {
  const { stats, hits } = runSearch(context, createIndex, [QUERY, QUERY, "photosynthesis"], true);
  assert.deepEqual(stats, { pages: 2, sites: 2 });
  assert.deepEqual(hits[0][0], {
    id: "p1",
    host: "passport.example.invalid",
    title: "Passport renewal",
    url: PASSPORT_URL,
    excerpt: "Passport renewal checklist for the fixture.",
  });
  assert.deepEqual(hits[1], hits[0]);
  assert.deepEqual(hits[2], []);
});

knownDefect("INDEX-01", "FTS excludes the unrelated loan page from passport renewal results",
  ["p1"], ["p1", "p2"], (context) => {
    const { hits } = runSearch(context, createIndex, [QUERY]);
    return hits[0].map(({ id }) => id);
  });

test("missing index returns zero counts and no hits", (context) => {
  assert.deepEqual(runSearch(context, null, [QUERY], true), {
    hits: [[]],
    stats: { pages: 0, sites: 0 },
  });
});

test("invalid SQLite bytes produce no hits", (context) => {
  const corrupt = (filename) => writeFileSync(filename, "Synthetic non-SQLite content");
  assert.deepEqual(runSearch(context, corrupt, [QUERY]), { hits: [[]], stats: null });
});

// Opening a directory surfaced SQLITE_CANTOPEN on Windows and SQLITE_IOERR on Ubuntu CI.
const directoryOpenPrimaryErrors = new Map([["win32", 14], ["linux", 10]]);
knownDefect("INDEX-02", "an index that cannot be opened degrades to no hits",
  { hits: [[]], stats: null },
  { failure: "sqlite-open-directory", sqliteError: directoryOpenPrimaryErrors.get(process.platform) },
  (context) => runSearch(context, mkdirSync, [QUERY]));
