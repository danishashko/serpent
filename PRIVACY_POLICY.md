# Privacy Policy

**Serpent** — Last updated: March 31, 2026

## Summary

Serpent does **not** collect, store, transmit, or sell any user data. All crawl data and settings are stored locally on your computer.

## Data Storage

- **Crawl data** is stored in a local SQLite database in your system's app data folder
- **API keys** (if provided) are stored in your OS credential manager via [keytar](https://github.com/nicholasrice/keytar) (Windows Credential Vault / macOS Keychain / Linux Secret Service)
- **Settings** are stored locally in the SQLite database
- No data is sent to Serpent developers or any third party analytics service

## Network Requests

Serpent makes network requests **only** when you explicitly initiate an action:

| Action | Destination | What is sent |
|--------|------------|--------------|
| **Local crawl** | Websites you choose to crawl | Standard HTTP requests (same as a browser) |
| **Bright Data crawl** (optional) | `api.brightdata.com` → target websites | Your Bright Data API key + target URLs |
| **AI analysis** (optional) | OpenAI, Anthropic, Google, or OpenRouter (`openrouter.ai`) APIs | Your API key + page content for analysis |
| **Ollama analysis** (optional) | Your local Ollama instance | Page content (never leaves your machine) |
| **Google Search Console** (optional) | `googleapis.com` | OAuth2 tokens for your GSC account |
| **Auto-update check** | `github.com` (GitHub Releases) | App version number only |

## Third-Party Services

Serpent uses a **Bring Your Own Key (BYOK)** model. If you connect third-party services, your data is subject to their respective privacy policies:

- [OpenAI Privacy Policy](https://openai.com/privacy)
- [Anthropic Privacy Policy](https://www.anthropic.com/privacy)
- [Google Privacy Policy](https://policies.google.com/privacy)
- [OpenRouter Privacy Policy](https://openrouter.ai/privacy)
- [Bright Data Privacy Policy](https://brightdata.com/privacy)

## Telemetry

Serpent contains **zero telemetry, analytics, or tracking**. No usage data, crash reports, or diagnostics are collected.

## Children's Privacy

Serpent does not knowingly collect any information from children under 13.

## Changes

If this policy changes, the updated version will be included in the app release and posted to the [GitHub repository](https://github.com/danishashko/serpent).

## Contact

Daniel Shashko — [daniel@organikpi.com](mailto:daniel@organikpi.com)
