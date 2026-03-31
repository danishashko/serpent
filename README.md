# 🐸 GhostFrog

**AI-native SEO spider for technical audits — free, open-source, desktop.**

GhostFrog is an Electron-based SEO crawling tool that brings enterprise-grade site auditing to your desktop with built-in AI analysis. Think Screaming Frog, but open-source and powered by your choice of LLM.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-35-blue.svg)](https://www.electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)

---

## Features

### Crawling
- **Local crawling** via axios with configurable concurrency, depth, and URL limits
- **Bright Data integration** for bypassing bot protection on difficult sites
- **JavaScript rendering** via Electron's built-in Chromium (no headless browser needed)
- **robots.txt** parsing and enforcement
- **Subdomain restriction** and crawl scoping (domain, subdomain, or URL list mode)
- **Pause / Resume / Stop** with persistent crawl state and cost continuity
- **Crawl comparison** — diff any two crawls to see new, removed, and changed pages

### SEO Extraction
- Title tags (with pixel-width estimation)
- Meta descriptions (with pixel-width estimation)
- H1/H2 headings
- Canonical URLs and canonicalization detection
- Indexability analysis (noindex, canonical, status codes)
- Internal and external link mapping with anchor text and rel attributes
- Image inventory with alt text, dimensions, format, and lazy-load detection
- Word count, page size, and text-to-HTML ratio
- **Redirect chain detection** — captures every hop with status codes
- **Duplicate content detection** — SHA-256 content hashing to surface identical pages
- **Hreflang validation** — extracts and validates hreflang/x-default tags across pages
- **Custom extraction** — apply your own CSS selectors to pull any data from pages
- **Structured data / JSON-LD** — extracts Schema.org types, validates JSON-LD, and reports errors
- **Open Graph & Twitter Cards** — extracts og:title, og:description, og:image, twitter:card, and more
- **Security headers** — checks HSTS, CSP, X-Frame-Options, and X-Content-Type-Options

### AI Analysis
- **Multi-LLM support** — bring your own key for any provider:
  - OpenAI (GPT-4o, GPT-4, GPT-3.5)
  - Anthropic (Claude 3.5 Sonnet, Claude 3 Opus/Haiku)
  - Google Gemini (Gemini Pro, Gemini Flash)
  - Ollama (local models — Llama 3, Mistral, etc.)
- Per-page SEO analysis with actionable recommendations
- **AI issue recommendations** — grouped analysis of issues with plain-English explanations and fix suggestions
- **Auto-generated fixes** — AI-generated optimized titles and meta descriptions for pages with issues
- Usage tracking with cost estimation

### Issue Intelligence
- **Severity scoring** — every issue classified as Critical / Warning / Info / Opportunity
- **Prioritized issue list** — sorted by impact, color-coded by severity
- **Image optimization analysis** — detects missing dimensions, unoptimized formats, and missing lazy-load
- **Internal link equity score** — PageRank-style algorithm to identify your most important pages

### Google Search Console Integration
- **OAuth 2.0 authentication** — connect your GSC account directly
- **Search analytics** — import clicks, impressions, CTR, and average position per page
- **Orphan page detection** — find pages in GSC that your crawl didn't discover

### SERP Analysis
- Google SERP scraping via Bright Data
- Competitor comparison for target keywords

### Visualization & Reporting
- **Site treemap** — visual map of your site sized by link equity, color-coded by issue severity
- **Crawl comparison** — side-by-side diff showing new, removed, and changed pages between crawls
- **Cost monitor** — real-time Bright Data spend tracking with daily history chart and hard-stop limits
- SQLite local storage (zero cloud dependency)
- CSV and JSON export
- Sortable, filterable data tables with 9 dedicated tabs

---

## Installation

### Prerequisites
- Node.js 18+ and npm
- Git

### Setup

```bash
git clone https://github.com/danishashko/ghostfrog.git
cd ghostfrog
npm install
```

### Development

```bash
npm run dev
```

### Build

```bash
# Build for your platform
npm run dist

# Output in dist/ folder
# Windows: NSIS installer (.exe)
# macOS: DMG
# Linux: AppImage
```

---

## Configuration

### AI Providers (BYOK — Bring Your Own Key)

Open **Settings** in the app and enter your API key for any provider:

| Provider | What you need | Local? |
|----------|--------------|--------|
| OpenAI | API key from [platform.openai.com](https://platform.openai.com) | No |
| Anthropic | API key from [console.anthropic.com](https://console.anthropic.com) | No |
| Google Gemini | API key from [ai.google.dev](https://ai.google.dev) | No |
| Ollama | Install [Ollama](https://ollama.ai), pull a model | Yes |

Keys are stored securely via your OS keychain (keytar).

### Bright Data (Optional)

For crawling bot-protected sites:
1. Create a [Bright Data](https://brightdata.com) account
2. Set up a Web Unlocker zone
3. Enter your API key and zone name in Settings

---

## How It Works

```
URL Input → Crawl Engine → Data Extraction → SQLite Storage → AI Analysis → Export
              ↓                    ↓                  ↓               ↓
         Local (axios)      Redirect chains      Link Equity    Issue Recs
              or             Hreflang tags        PageRank       Auto-Fixes
         Bright Data        Content hashes        GSC Merge      Severity
                            Schema/JSON-LD        Comparison
                            OG/Twitter Cards      Treemap
                            Security Headers
                            Custom selectors
                            Links & images
```

1. **Configure** your crawl (URL, depth, concurrency, extraction options)
2. **Crawl** using local engine or Bright Data (pause/resume supported)
3. **Review** extracted data across 9 tabs (Pages, Links, Images, Issues, Redirects, Hreflang, Duplicates, Extractions, SERP)
4. **Analyze** pages with your AI provider — get severity-scored issues with fix suggestions
5. **Visualize** your site as a treemap, compare crawls, connect GSC for orphan page detection
6. **Export** results as CSV or JSON

---

## GhostFrog vs Screaming Frog

| Feature | GhostFrog | Screaming Frog |
|---------|-----------|----------------|
| Price | **Free / Open Source** | £199/yr |
| AI Analysis | ✅ Multi-LLM (4 providers) | ❌ |
| AI Issue Recommendations | ✅ Auto-generated fixes | ❌ |
| Issue Severity Scoring | ✅ Critical/Warning/Info/Opportunity | ✅ |
| Structured Data / JSON-LD | ✅ Extraction + validation | ✅ |
| Open Graph / Twitter Cards | ✅ Full extraction | ✅ |
| Security Headers | ✅ HSTS, CSP, X-Frame, X-Content-Type | ❌ |
| Google Search Console | ✅ OAuth + orphan page detection | ✅ (paid) |
| Site Visualization | ✅ Treemap with issue heat map | ❌ |
| Crawl Comparison | ✅ Side-by-side diff | ✅ |
| Link Equity / PageRank | ✅ Built-in scoring | ❌ |
| Redirect Chains | ✅ | ✅ |
| Hreflang Validation | ✅ | ✅ |
| Custom Extraction | ✅ CSS selectors | ✅ CSS/XPath/Regex |
| Duplicate Detection | ✅ Content hashing | ✅ Near-duplicate |
| JS Rendering | ✅ Chromium built-in | ✅ (Chrome required) |
| Bot Protection Bypass | ✅ Bright Data | ❌ |
| SERP Analysis | ✅ Bright Data | ❌ |
| Cost Monitoring | ✅ Real-time spend tracking | N/A |
| URL Limit (free) | **Unlimited** | 500 |
| Open Source | ✅ MIT | ❌ |
| Cross-Platform | ✅ Win/Mac/Linux | ✅ Win/Mac/Linux |
| Local Data Storage | ✅ SQLite | ✅ |

---

## Tech Stack

- **Electron 35** — cross-platform desktop runtime
- **React 19** — UI framework
- **TypeScript 5.8** — type safety across main + renderer
- **Vite 6** — fast builds and HMR
- **better-sqlite3** — embedded database
- **cheerio** — HTML parsing and extraction
- **p-queue** — concurrency control
- **keytar** — secure credential storage
- **axios** — HTTP client
- **Vitest** — unit testing

---

## Project Structure

```
ghostfrog/
├── src/
│   ├── main/                        # Electron main process
│   │   ├── index.ts                 # Window creation, IPC handlers
│   │   ├── database.ts              # SQLite schema, queries, link scoring, crawl comparison
│   │   ├── crawler-local.ts         # Local HTTP crawler + JS rendering
│   │   ├── crawler-brightdata.ts    # Bright Data crawler
│   │   ├── crawler-orchestrator.ts  # Crawl queue management
│   │   ├── ai-analyzer.ts           # Multi-LLM analysis + issue recommendations
│   │   ├── gsc-client.ts            # Google Search Console OAuth + analytics
│   │   ├── serp-client.ts           # SERP ranking via Bright Data
│   │   └── cost-tracker.ts          # Bright Data spend monitoring
│   ├── preload/
│   │   └── index.ts                 # IPC bridge (contextBridge)
│   ├── renderer/
│   │   ├── App.tsx                  # Main React app
│   │   └── components/
│   │       ├── CrawlConfig.tsx      # Crawl settings sidebar
│   │       ├── ResultsTabs.tsx      # 9-tab data display
│   │       ├── SiteMap.tsx          # Treemap visualization
│   │       ├── CrawlComparison.tsx  # Crawl diff viewer
│   │       ├── CostMonitor.tsx      # Spend tracking dashboard
│   │       ├── AIInsights.tsx       # AI analysis panel
│   │       └── Settings.tsx         # Provider configuration
│   ├── test/                        # Vitest test suites
│   └── types/
│       └── index.ts                 # Shared TypeScript types (44-column PageData)
├── package.json
├── vite.config.ts
├── vitest.config.ts
├── PRIVACY_POLICY.md
└── CODE_SIGNING.md
```

---

## Contributing

Contributions welcome! Please open an issue first to discuss what you'd like to change.

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request

---

## License

[MIT](LICENSE) © 2026 [Daniel Shashko](https://organikpi.com)

## Privacy

[Privacy Policy](PRIVACY_POLICY.md) — GhostFrog collects zero user data. All processing is local.

---

## Author

**Daniel Shashko** — GTM Strategy × AI Automations

- Website: [organikpi.com](https://organikpi.com)
- GitHub: [@danishashko](https://github.com/danishashko)
