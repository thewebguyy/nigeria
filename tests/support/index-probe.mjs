import { lstatSync } from "node:fs";
import { indexStats, searchPages } from "../../lib/search.ts";

const { questions, readStats } = JSON.parse(process.argv[2]);
const directoryIndex = !readStats && lstatSync("index/pages.db", { throwIfNoEntry: false })?.isDirectory();
try {
  const hits = questions.map((question) => searchPages(question));
  const stats = readStats ? indexStats() : null;
  console.log(JSON.stringify({ hits, stats }));
} catch (error) {
  if (!(error instanceof Error) || error.code !== "ERR_SQLITE_ERROR" || !Number.isInteger(error.errcode)) {
    throw error;
  }
  // Extended SQLite error codes differ across operating systems.
  console.log(JSON.stringify({
    sqliteError: error.errcode & 0xff,
    ...(directoryIndex ? { failure: "sqlite-open-directory" } : {}),
  }));
}
