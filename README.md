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
- **Pause / Resume / Stop** with persistent crawl state

### SEO Extraction
- Title tags (with pixel-width estimation)
- Meta descriptions (with pixel-width estimation)
- H1/H2 headings
- Canonical URLs and canonicalization detection
- Indexability analysis (noindex, canonical, status codes)
- Internal and external link mapping with anchor text and rel attributes
- Image inventory with alt text auditing
- Word count and page size
- **Redirect chain detection** — captures every hop with status codes
- **Duplicate content detection** — SHA-256 content hashing to surface identical pages
- **Hreflang validation** — extracts and validates hreflang/x-default tags across pages
- **Custom extraction** — apply your own CSS selectors to pull any data from pages

### AI Analysis
- **Multi-LLM support** — bring your own key for any provider:
  - OpenAI (GPT-4o, GPT-4, GPT-3.5)
  - Anthropic (Claude 3.5 Sonnet, Claude 3 Opus/Haiku)
  - Google Gemini (Gemini Pro, Gemini Flash)
  - Ollama (local models — Llama 3, Mistral, etc.)
- Per-page SEO analysis with actionable recommendations
- Usage tracking with cost estimation

### SERP Analysis
- Google SERP scraping via Bright Data
- Competitor comparison for target keywords

### Data & Export
- SQLite local storage (zero cloud dependency)
- CSV and JSON export
- Sortable, filterable data tables
- Issue detection with severity filtering

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
              ↓                    ↓
         Local (axios)      Redirect chains
              or             Hreflang tags
         Bright Data        Content hashes
                            Custom selectors
                            Links & images
```

1. **Configure** your crawl (URL, depth, concurrency, extraction options)
2. **Crawl** using local engine or Bright Data
3. **Review** extracted data across multiple tabs (Pages, Links, Images, Redirects, Hreflang, Issues)
4. **Analyze** pages with your AI provider of choice
5. **Export** results as CSV or JSON

---

## GhostFrog vs Screaming Frog

| Feature | GhostFrog | Screaming Frog |
|---------|-----------|----------------|
| Price | **Free / Open Source** | £199/yr |
| AI Analysis | ✅ Multi-LLM (4 providers) | ❌ |
| Redirect Chains | ✅ | ✅ |
| Hreflang Validation | ✅ | ✅ |
| Custom Extraction | ✅ CSS selectors | ✅ CSS/XPath/Regex |
| Duplicate Detection | ✅ Content hashing | ✅ Near-duplicate |
| JS Rendering | ✅ Chromium built-in | ✅ (Chrome required) |
| Bot Protection Bypass | ✅ Bright Data | ❌ |
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
│   ├── main/              # Electron main process
│   │   ├── index.ts       # Window creation, IPC handlers
│   │   ├── database.ts    # SQLite schema and queries
│   │   ├── crawler-local.ts       # Local HTTP crawler
│   │   ├── crawler-brightdata.ts  # Bright Data crawler
│   │   └── crawler-orchestrator.ts # Crawl queue management
│   ├── preload/
│   │   └── index.ts       # IPC bridge (contextBridge)
│   ├── renderer/
│   │   ├── App.tsx         # Main React app
│   │   └── components/
│   │       ├── CrawlConfig.tsx   # Crawl settings sidebar
│   │       └── ResultsTabs.tsx   # Data display tabs
│   └── types/
│       └── index.ts        # Shared TypeScript types
├── package.json
├── vite.config.ts
├── vitest.config.ts
└── electron-builder.yml
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

---

## Author

**Daniel Shashko** — GTM Strategy × AI Automations

- Website: [organikpi.com](https://organikpi.com)
- GitHub: [@danishashko](https://github.com/danishashko)
