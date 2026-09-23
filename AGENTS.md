# AGENTS.md

Guidance for AI coding agents working in this repository. Humans should start with [README.md](README.md).

**Serpent** is a desktop technical-SEO crawler: Electron 35 main process, React 19 renderer, TypeScript throughout, an embedded SQLite database via `better-sqlite3`, and a built-in MCP server on `127.0.0.1:7777`. MIT licensed, public.

## Setup

```bash
npm install
```

Node 22.14.0, Electron 35.7.5. There is no ESLint or Prettier config in this repo — match the style of the file you are editing.

## Read this before you run the test suite

`better-sqlite3` is a native module and ships one binary at a time. It has to be rebuilt between two ABIs, and only one works at a time:

| Target | ABI | Used by |
|---|---|---|
| Node 22.14.0 | 127 | `npm test` / `npx vitest run` |
| Electron 35.7.5 | 133 | the app, `npm run dev`, e2e, `npm run dist` |

Run these from **inside `node_modules/better-sqlite3`** — a `--prefix` from the repo root fails:

```bash
cd node_modules/better-sqlite3
npx prebuild-install -r node -t 22.14.0 --force       # before unit tests
npx prebuild-install -r electron -t 35.7.5 --force    # before running or packaging the app
```

- **`--force` is mandatory.** Without it the command exits silently having done nothing, which reads as success.
- **Do not verify with `node -e "require('better-sqlite3')"`.** It loads fine under Node even when the binary is the Electron build, so the probe reports the wrong ABI. Verify by md5 of `node_modules/better-sqlite3/build/Release/better_sqlite3.node`:
  - `983aa9656102d55b45c1659b6d747962` = Node ABI 127, 1,721,344 bytes
  - `cd0318eeeff8fea4e4c3dcf362004488` = Electron ABI 133, 1,720,320 bytes
  - The two differ by exactly 1 KB and carry tar-preserved mtimes four minutes apart on the same day, so size and date are too close to judge by eye. Use the md5.
- **A running Serpent holds the file open and the swap fails with `EBUSY`.** Close the app first. Kill by PID, never by image name; the MCP server's PID is the one listening on 7777. Crawl data lives in SQLite and survives the restart.

**A red suite on this repo is almost always the native module, not your change.**

## Commands

| Command | What it does |
|---|---|
| `npm test` | Vitest unit suites, 27 files under `src/test/*.test.ts`. Needs Node ABI 127. Green baseline: 398 tests. |
| `npm run typecheck` | `tsc` over both projects (`tsconfig.main.json` + `tsconfig.json`). Both must be clean. |
| `npm run dev` | Vite + `tsc --watch` + electronmon. Needs Electron ABI 133. |
| `npm run build` | Renderer then main. |
| `npm run dist` | Build + electron-builder package. |
| `npm run test:e2e` | Playwright driving the real Electron app. Needs Electron ABI 133. |

Tests run serially on purpose (`pool: 'forks'`, `maxWorkers: 1`, `isolate: false`): in-memory `better-sqlite3` handles are not thread-safe. Electron is stubbed by `src/test/__mocks__/electron.ts` through a Vitest alias, so main-process modules import cleanly under Node — add a stub there when main-process code reaches a new Electron API.

## Architecture worth knowing before editing

- **`src/renderer/lib/issues-detector.ts` is the single source of truth for SEO issue definitions.** `computeIssues()` is called by `IssuesTab.tsx` (the Issues tab) and `SiteMap.tsx` (node health colouring). Add a rule there and both surfaces get it. Its file header comment claims the main process calls it over `IPC.ISSUES_GET`; that channel does not exist and no main-process module imports this file. Ignore the comment, not the file.
- **`src/main/mcp-server.ts` `get_issues` re-implements the issue logic independently.** It does not call `computeIssues()` — the main process cannot, since the detector lives in the renderer tree. That duplication is deliberate: the tool's output shape is a published MCP contract. It is also why **a detection bug has to be fixed twice**. Check both whenever you touch issue logic.
- **`src/types/index.ts` is shared by main and renderer** and already carries runtime exports (`IPC`, `UNCRAWLABLE_REASON_LABELS`, `isHtmlPage`). It is the right home for a helper both processes need. There is no `src/shared/`.
- **Two crawl engines with near-identical extraction blocks:** `src/main/crawler-local.ts` (axios + cheerio, manual redirect following, optional Electron headless render) and `src/main/crawler-brightdata.ts`. **A fix in one is owed to the other.** Only the pure cost helper is tested — `src/test/brightdata-cost.test.ts` covers `calculateBrightDataCost()`. The fetch and extraction path (`crawlPageBrightData`, `crawlPageBrightDataBrowser`, `buildResultFromHtml`) needs a live API token or CDP session and is covered by inspection and typecheck only.
- **The engines already diverge on the content-type check.** `crawler-local.ts` gates its extraction block on `html && isHTML`; `buildResultFromHtml()` in `crawler-brightdata.ts` gates on `if (html)` alone. `isHtmlPage()` still protects issue detection downstream, so the blast radius is small, but don't assume the two blocks are identical when you port a fix.

## Invariants that have already cost time

- **A status-code gate is not a content gate.** Every issue check used to gate on `statusCode === 200` alone, so a PDF or a JPEG that returned 200 was run through the on-page checks and reported "Missing Title" as a critical. Use `isHtmlPage()`. The gate is applied per issue **category**, not per detector, so new detectors inherit it. `response_codes`, `urls` and `security` stay universal — a 4xx, a long URL and a missing HSTS header are real findings on a PDF.
- **A null `contentType` on a 200 is treated as HTML and still audited.** Null only arises on redirects and network errors, which the status gate already excludes. Skipping would silently drop a real page from every check, and a silent miss is worse than a visible false positive.
- **The `content-type` header carries a charset** (`text/html; charset=UTF-8`). Match with `.includes('text/html')` on a lowercased value, never `===`.
- **Image extraction that reads `src` alone is blind to most of WordPress.** Lazy-load plugins put an inert `data:image/svg+xml` placeholder in `src` and the real URL in a data attribute. Try `data-lazy-src` / `data-src` / `data-original` / `src` in order and skip any candidate that resolves to a `data:` URI, rather than committing to the first attribute present.
- **Redirects have no body.** `crawler-local.ts` nulls `html` and `contentType` when a redirect chain exists and queues the destination for its own crawl. Content checks on a 3xx are always false positives.
- **A too-aggressive gate fails silently and a too-loose one fails loudly, so review a tightening harder than a loosening.** Gating the `links` category as HTML-only once silenced `low_link_score` for every non-HTML asset, and a real finding — an under-linked PDF — disappeared with no signal. `linkScore` comes from the internal link graph (`calculateLinkScores()` in `database.ts`), not from the page body.

## Known gaps — don't spend time rediscovering these

- **Accessibility issues are computed but never shown.** `getCategories()` in `issues-detector.ts` returns 13 categories and omits `'accessibility'`, even though `a11y_critical`, `a11y_serious` and `a11y_low_score` are real detectors, `'accessibility'` is a valid `IssueCategory`, and `categoryLabel()` has a case for it. `IssuesTab.tsx` seeds its map from `getCategories()` and drops any issue whose category is not in that map, so every accessibility finding is discarded before it reaches the UI. Adding `'accessibility'` to `getCategories()` is the fix; it has not been made yet.
- **`isLazy` only checks `loading="lazy"`.** An image lazy-loaded by JS (WP Rocket and friends) carries no `loading` attribute and still reports `isLazy: false`. Known, not fixed, and not the same bug as the `src` placeholder one above.

## Conventions

- **Smallest viable change.** Every changed line should trace to the task. Don't reformat, restyle, or improve adjacent code; surface refactors as follow-ups instead of bundling them.
- Conventional commits: `fix(crawler): …`, `feat(mcp): …`, `chore(release): v<x.y.z>`.
- **Never add a `Co-Authored-By` trailer or any AI attribution to a commit on this repo.**
- The version lives in `package.json` only.
- Versioning restarted at 1.0.0 for the public launch. Tags v1.0.3 to v1.0.7 from the private repo were dropped deliberately and **must not be resurrected**.
- Ad-hoc QA harnesses (`live-qa.js`, `ui-feature-qa.js`, `qa-shots/`) and planning docs are gitignored on purpose. Don't un-ignore them, and don't `git add .`.

## The built-in MCP server

- HTTP MCP at `http://127.0.0.1:7777/mcp`, only while the app is open, **localhost-only and never network-exposed.** Keep it that way.
- Eleven tools registered in `src/main/mcp-server.ts`: `start_crawl`, `stop_crawl`, `get_crawl_status`, `list_crawls`, `get_results`, `get_issues`, `export_csv`, `get_links`, `get_images`, `get_settings`, `set_settings`.
- Only `start_crawl`, `stop_crawl` and `set_settings` change state. Every other tool is read-only, `export_csv` included — it returns CSV as text and never writes a file.
- **Every tool carries a `title` and MCP `annotations`** (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`). Clients use these to decide what to auto-approve, so a new tool must declare them honestly: `readOnlyHint: true` only if the handler writes nothing at all, and `openWorldHint: true` only if it reaches the network (`start_crawl` is the only one that does).
- Tool input schemas are zod. If you add, rename or remove a tool, update the tools table in `README.md` in the same change.
- Exercise it with `npx @modelcontextprotocol/inspector http://127.0.0.1:7777/mcp`.

## Machine-readable index

[llms.txt](llms.txt) lists the documents an agent should read first, with absolute URLs.
