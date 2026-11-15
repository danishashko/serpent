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
| `npm test` | Vitest unit suites, 31 files under `src/test/*.test.ts`. Needs Node ABI 127. Green baseline: 466 tests. |
| `npm run typecheck` | `tsc` over both projects (`tsconfig.main.json` + `tsconfig.json`). Both must be clean. |
| `npm run dev` | Vite + `tsc --watch` + electronmon. Needs Electron ABI 133. |
| `npm run build` | Renderer then main. |
| `npm run dist` | Build + electron-builder package. |
| `npm run test:e2e` | Playwright driving the real Electron app. Needs Electron ABI 133. |

Tests run serially on purpose (`pool: 'forks'`, `maxWorkers: 1`, `isolate: false`): in-memory `better-sqlite3` handles are not thread-safe. Electron is stubbed by `src/test/__mocks__/electron.ts` through a Vitest alias, so main-process modules import cleanly under Node — add a stub there when main-process code reaches a new Electron API.

## Architecture worth knowing before editing

- **`src/renderer/lib/issues-detector.ts` is the single source of truth for SEO issue definitions.** `computeIssues()` is called by `IssuesTab.tsx` (the Issues tab) and `SiteMap.tsx` (node health colouring). Add a rule there and both surfaces get it. Its file header comment claims the main process calls it over `IPC.ISSUES_GET`; that channel does not exist and no main-process module imports this file. Ignore the comment, not the file.
- **`src/main/mcp-server.ts` `get_issues` re-implements the issue logic independently.** It does not call `computeIssues()` — the main process cannot, since the detector lives in the renderer tree. That duplication is deliberate: the tool's output shape is a published MCP contract. It is also why **a detection bug has to be fixed twice**. Check both whenever you touch issue logic.
- **Link health is a post-crawl pass, not part of the page parse.** `src/main/link-health.ts` `runPostCrawlChecks()` runs when the orchestrator emits `complete`: internal links (database only), then external link targets, image files and the XML sitemap (network). It writes per-page counters (`brokenOutlinks`, `redirectOutlinks`, `brokenExternalOutlinks`, `brokenImages`) and `inSitemap` onto the `pages` rows via `recomputeLinkHealth()` / `setPagesInSitemap()` in `database.ts`. The detectors only read those fields, so they report nothing, never something false, on a crawl the pass has not reached. `issueTargets()` in the detector file names the offending URLs for the Issues tab and must stay in step with `recomputeLinkHealth()`: the first decides whether a page is affected, the second what to show under it.
- **Plugin tabs run third-party code, and the whole design exists to keep that code away from the app.** `src/main/plugins.ts` lists `<userData>/plugins/*.js` and serves each one from `serpent-plugin://plugin/<id>/index.html` (protocol handler in `index.ts`). `PluginsPanel.tsx` shows that page in `<iframe sandbox="allow-scripts">`, posts it a copy of the crawl (`serpent:data`) and accepts one request back, `serpent:export`, which goes through the normal save dialog. The in-frame runtime (`PLUGIN_RUNTIME_JS`) is a string served to the frame, not compiled into the app. Guide for plugin authors: `docs/PLUGINS.md`; examples: `resources/plugins/`.
- **`src/renderer/lib/ngrams.ts` is the Phrases tab's whole engine** (`computePhrases`, `phraseTexts`): pure, capped by a token budget, and it counts distinct pages by relying on each page's texts arriving together.
- **`src/main/xlsx-writer.ts` writes XLSX with no dependency** (ZIP container + five XML parts via `zlib`). Every export path takes `ExportFormat` (`csv` | `json` | `xlsx`); a bulk XLSX export is one workbook with a sheet per category.
- **`src/types/index.ts` is shared by main and renderer** and already carries runtime exports (`IPC`, `UNCRAWLABLE_REASON_LABELS`, `isHtmlPage`). It is the right home for a helper both processes need. There is no `src/shared/`.
- **Two crawl engines with near-identical extraction blocks:** `src/main/crawler-local.ts` (axios + cheerio, manual redirect following, optional Electron headless render) and `src/main/crawler-brightdata.ts`. **A fix in one is owed to the other.** Only the pure cost helper is tested — `src/test/brightdata-cost.test.ts` covers `calculateBrightDataCost()`. The fetch and extraction path (`crawlPageBrightData`, `crawlPageBrightDataBrowser`, `buildResultFromHtml`) needs a live API token or CDP session and is covered by inspection and typecheck only.
- **The engines already diverge on the content-type check.** `crawler-local.ts` gates its extraction block on `html && isHTML`; `buildResultFromHtml()` in `crawler-brightdata.ts` gates on `if (html)` alone. `isHtmlPage()` still protects issue detection downstream, so the blast radius is small, but don't assume the two blocks are identical when you port a fix.

## Invariants that have already cost time

- **A status-code gate is not a content gate.** Every issue check used to gate on `statusCode === 200` alone, so a PDF or a JPEG that returned 200 was run through the on-page checks and reported "Missing Title" as a critical. Use `isHtmlPage()`. The gate is applied per issue **category**, not per detector, so new detectors inherit it. `response_codes`, `urls` and `security` stay universal — a 4xx, a long URL and a missing HSTS header are real findings on a PDF.
- **A null `contentType` on a 200 is treated as HTML and still audited.** Null only arises on redirects and network errors, which the status gate already excludes. Skipping would silently drop a real page from every check, and a silent miss is worse than a visible false positive.
- **The `content-type` header carries a charset** (`text/html; charset=UTF-8`). Match with `.includes('text/html')` on a lowercased value, never `===`.
- **Image extraction that reads `src` alone is blind to most of WordPress.** Lazy-load plugins put an inert `data:image/svg+xml` placeholder in `src` and the real URL in a data attribute. Try `data-lazy-src` / `data-src` / `data-original` / `src` in order and skip any candidate that resolves to a `data:` URI, rather than committing to the first attribute present.
- **Redirects have no body.** `crawler-local.ts` nulls `html` and `contentType` when a redirect chain exists and queues the destination for its own crawl. Content checks on a 3xx are always false positives.
- **`getCategories()` is the allow-list for the whole Issues tab, not just its ordering.** `IssuesTab.tsx` seeds its map from `getCategories()` and then pushes only into buckets that already exist, so an issue whose category is missing from that list is discarded with no error and no empty section. That is exactly how every accessibility finding stayed invisible for three real detectors while `'accessibility'` was a valid `IssueCategory` with a `categoryLabel()` case. **A new `IssueCategory` is not wired up until it is in `getCategories()`.**
- **A too-aggressive gate fails silently and a too-loose one fails loudly, so review a tightening harder than a loosening.** Gating the `links` category as HTML-only once silenced `low_link_score` for every non-HTML asset, and a real finding — an under-linked PDF — disappeared with no signal. `linkScore` comes from the internal link graph (`calculateLinkScores()` in `database.ts`), not from the page body.

- **`alt=""` is not a missing alt.** It marks a decorative image and is valid HTML. The crawlers store an absent attribute as `null` and an empty one as `''`; every "missing alt" count goes through `isMissingAlt()` in `src/types/index.ts`. A truthiness check (`!altText`) lumps the two together and reported 119 false positives out of 142 on one real crawl.
- **A status from a host we only probed is weaker evidence than one from a page we crawled.** For external links and images only 404, 410 and an unreachable host count as broken (`isGoneStatus()`); 401/403/429 and third-party 5xx mean a server refused a bot. Internal targets were fetched by the crawl itself, so any 4xx/5xx there is a finding. Loosening `isGoneStatus()` floods the Issues tab with links that work fine in a browser.
- **The post-crawl prober never follows a public page into a private network.** `probeUrlStatuses()` skips loopback, RFC-1918, link-local and metadata hosts unless the crawled site itself is on a private host. Keep that default when adding a new probe stage.
- **Never widen the plugin sandbox.** Four things together keep a plugin from reading keys or sending the crawl out, and each covers a hole the others leave: the iframe has `sandbox="allow-scripts"` and nothing else (adding `allow-same-origin` hands the plugin the app's origin); `PLUGIN_CSP` is `default-src 'none'` with scripts only from the plugin scheme (no `connect-src`, no inline script); the window's own CSP has `frame-src serpent-plugin:` and a `will-frame-navigate` guard, which stop a plugin navigating its frame to `https://evil.test/?<data>`; and the host accepts messages only from the frame's own `contentWindow`. Do not give plugins a way to call `window.api`, and do not add a message type that returns settings, keys or other crawls. A probe plugin trying 20 escape routes is the test: nothing may reach a logging server.
- **XLSX text cells are inline strings, never formulas.** `cell()` in `xlsx-writer.ts` types every non-number as `t="inlineStr"`, so `=HYPERLINK(...)` in a crawled title is shown as text. That is why XLSX has no equivalent of the CSV formula-injection guard; writing a `<f>` element would need one.
- **The unit suite shares one module cache (`isolate: false`).** A test that `vi.mock`s `../main/database` and then imports a module depending on it caches that module bound to the mock for every later file. `mcp-server.test.ts` mocks `../main/link-health` for exactly this reason; do the same for any new main-process module the MCP server imports.

## Known gaps — don't spend time rediscovering these

- **The MCP `get_issues` tool has no accessibility checks.** It buckets by severity only, has no category concept, and never reads `a11yCritical` / `a11ySerious` / `a11yScore`, so an agent sees a different issue set from the Issues tab. It does carry the link-health and sitemap findings, and reports `post_crawl_checks` so a caller knows whether those have finished. Adding them changes a published tool's output and belongs in its own task.
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
