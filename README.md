# NigeriaAI

NigeriaAI is an independent guide to Nigerian government services. This repository includes an offline quality suite for curated answers, SQLite retrieval, and the chat and ask API handlers.

## Contributor setup

Use Node.js **26.12.1**, pinned in `.node-version` and used by the pull request workflow. The pin is the verified test runtime. The suite uses `node:sqlite` with FTS5, native TypeScript stripping, and the Node test runner's expected-failure support. The baseline was verified with npm **11.20.0**.

From the repository root, run `npm test` for the offline checks. This command uses Node built-ins and works before installing dependencies.

The pull request workflow runs the offline suite before installing dependencies. For development and build verification, run these commands in order.

```sh
npm ci
npm run build
npm exec -- tsc --noEmit --incremental false
```

`npm run dev` starts the local app. With `CENCORI_API_KEY` unset, the API handlers return curated answers. The quality suite uses synthetic model responses in both API paths.

## Offline fixtures

- [Curated questions](tests/fixtures/questions.mjs) label 24 positive questions, 23 standalone abstention cases, ten conversation cases, and three NIMC centre lookups. The suite checks ranked and selected answer IDs, citation IDs, and catalogue integrity.
- [SQLite fixtures](tests/search.test.mjs) create two synthetic documents in a temporary database with the crawler's FTS5 tokenizer and insert trigger. Search runs in a child process so SQLite closes its read-only handle before fixture cleanup. Additional cases use missing, malformed, and unopenable indexes.
- [API fixtures](tests/routes.test.mjs) call the actual handlers with Web `Request` objects and stub every provider fetch. They cover input validation, curated fallback, citation filtering, split UTF-8 chunks, and stream completion. The handlers load from an isolated working directory so any local index stays outside the test.

The suite uses synthetic text and reserved example domains. It requires no API key, production index, crawler run, or outbound HTTP call.

## Baseline results

On the current 60-case fixture set, retrieval ranks the expected answer first on **24 of 24** standalone positives, and **0 of 23** standalone negatives receive a confident answer. All ten conversation cases and three NIMC centre lookups match their expected outcomes. The earlier 38-case comparison measured **12 of 15** positives and **11 of 14** confidently answered standalone negatives on the Phase 1 commit.

The suite has **77 ordinary passing checks** and **11 expected failures**. The three Phase 1 curated false matches are now ordinary regression tests. Node includes matched expected failures in its pass count and labels each case `EXPECTED FAILURE`. Each case has a stable ID and only matches the comparison assertion raised by the harness for its documented baseline result. A different result or error fails the run. Once the desired assertion passes, the runner reports an unexpected pass. Convert that case to a normal regression test in the fix PR.

| Expected failures | Recorded behaviour |
| --- | --- |
| `INDEX-01`, `INDEX-02` | A loan page matches a passport query through the word “renewal”. An unopenable database throws instead of returning no hits. |
| `ASK-01` | `/api/ask` accepts a question object and returns HTTP 200. |
| `ASK-02`, `ASK-03`, `CHAT-01` to `CHAT-04` | Missing and unknown-only citation IDs leave chat confident with no sources, and ask substitutes curated links. Chat also accepts duplicate IDs and an unrelated catalogue ID. |
| `CHAT-05`, `CHAT-06` | An unlisted link appears in a chat delta. Provider EOF before the completion marker can yield a successful terminal event. |

The handler tests exercise server framing and emitted data. Browser rendering, downstream browser disconnects, live provider compatibility, production corpus relevance, and factual accuracy of agency guidance require separate validation.
