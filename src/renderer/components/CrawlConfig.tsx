import React, { useState, useEffect, useRef } from "react";
import {
  CrawlConfig as CrawlConfigType,
  CrawlProgress,
} from "../../types/index";
import { robotsTokenForUserAgent } from "../../main/robots-ua";

interface Props {
  progress: CrawlProgress | null;
  onCrawlStart: (crawlId: string) => void;
  showToast: (
    msg: string,
    type?: "success" | "error" | "warning" | "info",
  ) => void;
}

type InputMode = "spider" | "list" | "clipboard" | "sitemap";
type CrawlEngine = "local" | "brightdata" | "brightdata-browser";

const defaultConfig: CrawlConfigType = {
  startUrl: "",
  mode: "spider",
  engine: "local",
  storageMode: "database",
  maxUrls: 500,
  maxDepth: 5,
  concurrency: 5,
  respectRobots: true,
  followRedirects: true,
  restrictToSubdomain: false,
  timeout: 10000,
  extractTitles: true,
  extractMeta: true,
  extractHeadings: true,
  extractImages: true,
  extractLinks: true,
  extractCanonicals: true,
  maxCostUsd: 5.0,
  bdZone: "web_unlocker1",
};

export default function CrawlConfig({
  progress,
  onCrawlStart,
  showToast,
}: Props): React.ReactElement {
  const [config, setConfig] = useState<CrawlConfigType>(defaultConfig);
  const [listUrls, setListUrls] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>("spider");
  const [sitemapInputUrl, setSitemapInputUrl] = useState("");
  const [isFetchingSitemap, setIsFetchingSitemap] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (progress) {
      setIsRunning(progress.status === "running");
      setIsPaused(progress.status === "paused");
      if (progress.status === "completed" || progress.status === "error") {
        setIsRunning(false);
        setIsPaused(false);
      }
    }
  }, [progress]);

  const set = <K extends keyof CrawlConfigType>(
    key: K,
    value: CrawlConfigType[K],
  ) => setConfig((c) => ({ ...c, [key]: value }));

  const [isStarting, setIsStarting] = useState(false);

  const handleFileLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text
        .split(/[\r\n]+/)
        .map((l) => l.trim())
        .filter(Boolean);
      setListUrls(lines.join("\n"));
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.readAsText(file);
  };

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const lines = text
        .split(/[\r\n]+/)
        .map((l) => l.trim())
        .filter(Boolean);
      setListUrls(lines.join("\n"));
      showToast(
        `Pasted ${lines.length} URL${lines.length === 1 ? "" : "s"} from clipboard`,
        "success",
      );
    } catch {
      showToast("Could not read clipboard", "error");
    }
  };

  const handleFetchSitemap = async () => {
    if (!sitemapInputUrl.trim()) {
      showToast("Enter a sitemap URL", "error");
      return;
    }
    setIsFetchingSitemap(true);
    try {
      const result = await window.api.sitemapFetchUrls(sitemapInputUrl.trim());
      if (result.error) {
        showToast(result.error, "error");
        return;
      }
      setListUrls(result.urls.join("\n"));
      showToast(
        `Fetched ${result.urls.length} URL${result.urls.length === 1 ? "" : "s"} from sitemap`,
        "success",
      );
    } catch (e) {
      showToast(String(e), "error");
    } finally {
      setIsFetchingSitemap(false);
    }
  };

  const handleStart = async () => {
    if (isStarting) return;
    if (!config.startUrl && inputMode === "spider") {
      showToast("Please enter a seed URL", "error");
      return;
    }

    let finalConfig = { ...config };

    if (inputMode !== "spider") {
      const urls = listUrls
        .split("\n")
        .map((u) => u.trim())
        .filter(Boolean);
      if (!urls.length) {
        showToast("Please enter at least one URL", "error");
        return;
      }
      finalConfig = {
        ...finalConfig,
        mode: "list",
        startUrl: urls.join("\n"),
        urlList: urls,
      };
    }

    setIsStarting(true);
    try {
      const result = await window.api.crawlStart(finalConfig);
      if (result.success && result.crawlId) {
        onCrawlStart(result.crawlId);
        setIsRunning(true);
      } else {
        showToast(result.error ?? "Failed to start crawl", "error");
      }
    } catch (e) {
      showToast(String(e), "error");
    } finally {
      setIsStarting(false);
    }
  };

  const handlePauseResume = async () => {
    if (isPaused) {
      await window.api.crawlResume();
      setIsPaused(false);
      setIsRunning(true);
    } else {
      await window.api.crawlPause();
      setIsPaused(true);
      setIsRunning(false);
    }
  };

  const handleStop = async () => {
    await window.api.crawlStop();
    setIsRunning(false);
    setIsPaused(false);
  };

  const busy = isRunning || isPaused;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Only the form scrolls — the action bar below stays pinned. */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
      <div>
        <label
          style={{
            display: "block",
            marginBottom: 4,
            fontSize: 11,
            color: "var(--text-secondary)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          Mode
        </label>
        <div style={{ display: "flex", gap: 6 }}>
          {(
            [
              { id: "spider", label: "🕷 Spider" },
              { id: "list", label: "📋 Paste" },
              { id: "clipboard", label: "📎 Clipboard" },
              { id: "sitemap", label: "🗺 Sitemap" },
            ] as { id: InputMode; label: string }[]
          ).map(({ id, label }) => (
            <button
              key={id}
              className="btn-icon"
              style={{
                flex: 1,
                background:
                  inputMode === id
                    ? "var(--accent-blue)"
                    : "var(--bg-secondary)",
                color: inputMode === id ? "var(--on-accent-blue)" : "var(--text-secondary)",
                border:
                  "1px solid " +
                  (inputMode === id ? "var(--accent-blue)" : "var(--border)"),
                borderRadius: 6,
                padding: "5px 0",
                fontSize: 11,
                fontWeight: inputMode === id ? 600 : 400,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
              onClick={() => setInputMode(id)}
              disabled={busy}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {inputMode === "spider" ? (
        <div>
          <label className="label">Seed URL</label>
          <input
            className="input"
            type="url"
            placeholder="https://example.com"
            value={config.startUrl}
            onChange={(e) => set("startUrl", e.target.value)}
            disabled={busy}
          />
        </div>
      ) : inputMode === "list" ? (
        <div>
          <label className="label">URLs (one per line)</label>
          <textarea
            className="input"
            rows={6}
            placeholder="https://example.com/page1&#10;https://example.com/page2"
            value={listUrls}
            onChange={(e) => setListUrls(e.target.value)}
            disabled={busy}
            style={{
              resize: "vertical",
              minHeight: 80,
              fontFamily: "monospace",
              fontSize: 11,
            }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 4,
            }}
          >
            <button
              className="btn-ghost"
              style={{ fontSize: 11, padding: "3px 10px" }}
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              📁 Load from file
            </button>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
              {listUrls.split("\n").filter((l) => l.trim()).length} URLs
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.csv,.tsv"
              style={{ display: "none" }}
              onChange={handleFileLoad}
            />
          </div>
        </div>
      ) : inputMode === "clipboard" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label className="label">URLs from Clipboard</label>
          <button
            className="btn-ghost"
            style={{
              fontSize: 12,
              padding: "6px 0",
              alignSelf: "flex-start",
              paddingLeft: 12,
              paddingRight: 12,
            }}
            onClick={handlePasteClipboard}
            disabled={busy}
          >
            📎 Paste from Clipboard
          </button>
          {listUrls && (
            <textarea
              className="input"
              rows={5}
              value={listUrls}
              onChange={(e) => setListUrls(e.target.value)}
              disabled={busy}
              style={{
                resize: "vertical",
                minHeight: 60,
                fontFamily: "monospace",
                fontSize: 11,
              }}
            />
          )}
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
            {listUrls.split("\n").filter((l) => l.trim()).length} URLs loaded
          </span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label className="label">Sitemap URL</label>
          <div style={{ display: "flex", gap: 4 }}>
            <input
              className="input"
              type="url"
              placeholder="https://example.com/sitemap.xml"
              value={sitemapInputUrl}
              onChange={(e) => setSitemapInputUrl(e.target.value)}
              disabled={busy || isFetchingSitemap}
              style={{ flex: 1 }}
            />
            <button
              className="btn-ghost"
              style={{
                fontSize: 11,
                padding: "4px 10px",
                whiteSpace: "nowrap",
              }}
              onClick={handleFetchSitemap}
              disabled={busy || isFetchingSitemap}
            >
              {isFetchingSitemap ? "⏳" : "⬇ Fetch"}
            </button>
          </div>
          {listUrls && (
            <textarea
              className="input"
              rows={5}
              value={listUrls}
              readOnly
              style={{
                resize: "vertical",
                minHeight: 60,
                fontFamily: "monospace",
                fontSize: 11,
                opacity: 0.8,
              }}
            />
          )}
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
            {listUrls.split("\n").filter((l) => l.trim()).length} URLs fetched
          </span>
        </div>
      )}

      {/* Engine toggle */}
      <div>
        <label className="label" style={{ marginBottom: 6 }}>
          Crawl Engine
        </label>
        <div style={{ display: "flex", gap: 6 }}>
          {(["local", "brightdata", "brightdata-browser"] as CrawlEngine[]).map(
            (e) => {
              const accent =
                e === "local"
                  ? "var(--accent-green)"
                  : e === "brightdata-browser"
                    ? "var(--accent-blue)"
                    : "var(--accent-orange)";
              const bg =
                e === "local"
                  ? "var(--tint-green)"
                  : e === "brightdata-browser"
                    ? "var(--tint-blue)"
                    : "var(--tint-orange)";
              const label =
                e === "local"
                  ? "🔧 Local"
                  : e === "brightdata-browser"
                    ? "🌐 JS Browser"
                    : "☁️ Web Unlocker";
              return (
                <button
                  key={e}
                  style={{
                    flex: 1,
                    padding: "6px 0",
                    fontSize: 11,
                    fontWeight: 500,
                    border:
                      "1px solid " +
                      (config.engine === e ? accent : "var(--border)"),
                    borderRadius: 6,
                    background:
                      config.engine === e ? bg : "var(--bg-secondary)",
                    color:
                      config.engine === e ? accent : "var(--text-secondary)",
                    cursor: "pointer",
                  }}
                  onClick={() => set("engine", e)}
                  disabled={busy}
                >
                  {label}
                </button>
              );
            },
          )}
        </div>
        {config.engine === "brightdata" && (
          <p
            style={{
              fontSize: 10,
              color: "var(--accent-orange)",
              marginTop: 4,
            }}
          >
            ~$1.00/1,000 pages · Set API key in Settings
          </p>
        )}
        {config.engine === "brightdata-browser" && (
          <p style={{ fontSize: 10, color: "var(--accent-blue)", marginTop: 4 }}>
            Renders JS/SPAs · ~$8/GB · Set Browser API credentials in Settings
          </p>
        )}
        {config.engine === "local" && (
          <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
            Free · May fail on JS-heavy / bot-protected sites
          </p>
        )}
      </div>

      {/* Limits */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <label className="label">Max URLs</label>
          <input
            className="input"
            type="number"
            min={1}
            max={100000}
            value={config.maxUrls}
            onChange={(e) => set("maxUrls", Number(e.target.value))}
            disabled={busy}
          />
        </div>
        <div>
          <label className="label">Max Depth</label>
          <input
            className="input"
            type="number"
            min={1}
            max={20}
            value={config.maxDepth}
            onChange={(e) => set("maxDepth", Number(e.target.value))}
            disabled={busy}
          />
        </div>
      </div>

      {/* Rate limit */}
      <div>
        <label className="label">
          Rate Limit (req/s){" "}
          <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>
            — 0 = unlimited
          </span>
        </label>
        <input
          className="input"
          type="number"
          min={0}
          max={100}
          step={1}
          value={config.requestsPerSecond ?? 0}
          onChange={(e) => set("requestsPerSecond", Number(e.target.value))}
          disabled={busy}
          placeholder="0"
        />
        {(config.requestsPerSecond ?? 0) > 0 && (
          <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
            Crawling at max {config.requestsPerSecond} page
            {config.requestsPerSecond === 1 ? "" : "s"}/sec — good for sensitive
            sites
          </p>
        )}
      </div>

      {config.engine === "brightdata" && (
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
        >
          <div>
            <label className="label">Cost Limit ($)</label>
            <input
              className="input"
              type="number"
              min={0.01}
              step={0.5}
              value={config.maxCostUsd}
              onChange={(e) => set("maxCostUsd", Number(e.target.value))}
              disabled={busy}
            />
          </div>
          <div>
            <label className="label">BD Zone</label>
            <input
              className="input"
              type="text"
              value={config.bdZone ?? "web_unlocker1"}
              onChange={(e) => set("bdZone", e.target.value)}
              disabled={busy}
            />
          </div>
        </div>
      )}

      {config.engine === "brightdata-browser" && (
        <div>
          <label className="label">Cost Limit ($)</label>
          <input
            className="input"
            type="number"
            min={0.01}
            step={0.5}
            value={config.maxCostUsd}
            onChange={(e) => set("maxCostUsd", Number(e.target.value))}
            disabled={busy}
          />
        </div>
      )}

      {/* Extraction flags */}
      <div>
        <label className="label">Extract</label>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            marginTop: 4,
          }}
        >
          {[
            { key: "extractMeta", label: "Meta tags / Open Graph" },
            { key: "extractLinks", label: "Internal / External links" },
            { key: "extractImages", label: "Images" },
            { key: "extractHreflang", label: "Hreflang tags" },
            { key: "extractBodyText", label: "Store page text (for semantic analysis)" },
            { key: "respectRobots", label: "Respect robots.txt" },
          ].map(({ key, label }) => (
            <label key={key} className="check-row">
              <input
                type="checkbox"
                checked={!!config[key as keyof CrawlConfigType]}
                onChange={(e) =>
                  set(
                    key as keyof CrawlConfigType,
                    e.target.checked as CrawlConfigType[keyof CrawlConfigType],
                  )
                }
                disabled={busy}
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      {/* Custom robots.txt + tester */}
      {config.respectRobots && (
        <CustomRobotsSection
          customRobotsTxt={config.customRobotsTxt ?? ""}
          robotsUserAgent={
            config.robotsUserAgent ?? robotsTokenForUserAgent(config.userAgent)
          }
          startUrl={config.startUrl}
          busy={busy}
          onChangeBody={(v) =>
            set("customRobotsTxt", v as CrawlConfigType["customRobotsTxt"])
          }
          onChangeUserAgent={(v) =>
            set("robotsUserAgent", v as CrawlConfigType["robotsUserAgent"])
          }
        />
      )}

      {/* JS rendering toggle (local engine only) */}
      {config.engine === "local" && (
        <div
          style={{
            padding: "8px 10px",
            borderRadius: 6,
            border:
              "1px solid " +
              (config.jsRender ? "var(--accent-blue)" : "var(--border)"),
            background: config.jsRender
              ? "var(--tint-blue)"
              : "var(--bg-secondary)",
          }}
        >
          <label className="check-row">
            <input
              type="checkbox"
              checked={!!config.jsRender}
              onChange={(e) => set("jsRender", e.target.checked)}
              disabled={busy}
            />
            <span
              style={{
                fontWeight: 500,
                color: config.jsRender
                  ? "var(--accent-blue)"
                  : "var(--text-secondary)",
              }}
            >
              JS Rendering (Headless Chromium)
            </span>
          </label>
          <p
            style={{
              margin: "4px 0 0 24px",
              fontSize: 10,
              color: "var(--text-muted)",
              lineHeight: 1.4,
            }}
          >
            Uses Electron's built-in Chromium to render JS-heavy pages. Slower
            (~1–2 s/page) but captures React/Vue/Angular content.
          </p>
        </div>
      )}

      {/* Custom Extraction Rules */}
      <div>
        <label className="label">Custom Extraction Rules</label>
        <p
          style={{
            fontSize: 10,
            color: "var(--text-muted)",
            margin: "2px 0 6px",
          }}
        >
          Extract data from pages using CSS selectors
        </p>
        {(config.customExtractions ?? []).map((rule, i) => (
          <div key={i} style={{ display: "flex", gap: 4, marginBottom: 4 }}>
            <input
              className="input"
              style={{ flex: 1, padding: "3px 6px", fontSize: 11 }}
              placeholder="Name"
              value={rule.name}
              onChange={(e) => {
                const rules = [...(config.customExtractions ?? [])];
                rules[i] = { ...rules[i], name: e.target.value };
                set("customExtractions", rules);
              }}
              disabled={busy}
            />
            <input
              className="input"
              style={{
                flex: 2,
                padding: "3px 6px",
                fontSize: 11,
                fontFamily: "monospace",
              }}
              placeholder="CSS selector (e.g. h2.price)"
              value={rule.selector}
              onChange={(e) => {
                const rules = [...(config.customExtractions ?? [])];
                rules[i] = { ...rules[i], selector: e.target.value };
                set("customExtractions", rules);
              }}
              disabled={busy}
            />
            <button
              className="btn-ghost"
              style={{
                padding: "2px 6px",
                fontSize: 11,
                color: "var(--accent-red)",
              }}
              onClick={() => {
                const rules = (config.customExtractions ?? []).filter(
                  (_, j) => j !== i,
                );
                set("customExtractions", rules.length ? rules : undefined);
              }}
              disabled={busy}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          className="btn-ghost"
          style={{ fontSize: 11, padding: "3px 10px", marginTop: 2 }}
          onClick={() => {
            const rules = [
              ...(config.customExtractions ?? []),
              { name: "", selector: "" },
            ];
            set("customExtractions", rules);
          }}
          disabled={busy}
        >
          + Add Rule
        </button>
      </div>

      {/* Advanced crawl behavior */}
      <AdvancedSection config={config} set={set} busy={busy} />
      </div>

      {/* Action buttons — pinned, so Start (and Stop mid-crawl) never scroll away */}
      <div className="panel-footer">
        {!busy ? (
          <button
            className="btn-primary"
            style={{ flex: 1 }}
            onClick={handleStart}
            disabled={isStarting}
          >
            {isStarting ? "⏳ Starting…" : "▶ Start Crawl"}
          </button>
        ) : (
          <>
            <button
              className="btn-ghost"
              style={{ flex: 1 }}
              onClick={handlePauseResume}
            >
              {isPaused ? "▶ Resume" : "⏸ Pause"}
            </button>
            <button
              className="btn-danger"
              style={{ flex: 1 }}
              onClick={handleStop}
            >
              ■ Stop
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Advanced crawl behavior (UA, patterns, auth, headers, cookies) ───────────

const UA_PRESETS: { label: string; value: string }[] = [
  { label: "Serpent (default)", value: "" },
  {
    label: "Googlebot (Desktop)",
    value:
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/125.0.0.0 Safari/537.36",
  },
  {
    label: "Googlebot (Smartphone)",
    value:
      "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  },
  {
    label: "Bingbot",
    value:
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36",
  },
  {
    label: "Chrome (Windows)",
    value:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  },
  { label: "Custom…", value: "__custom__" },
];

interface AdvancedProps {
  config: CrawlConfigType;
  set: <K extends keyof CrawlConfigType>(
    key: K,
    value: CrawlConfigType[K],
  ) => void;
  busy: boolean;
}

function AdvancedSection({
  config,
  set,
  busy,
}: AdvancedProps): React.ReactElement {
  const presetMatch = UA_PRESETS.find(
    (p) => p.value === (config.userAgent ?? ""),
  );
  const [uaChoice, setUaChoice] = useState<string>(
    presetMatch ? presetMatch.value : "__custom__",
  );
  const isCustomUa = uaChoice === "__custom__";

  const listToText = (list?: string[]) => (list ?? []).join("\n");
  const textToList = (text: string): string[] | undefined => {
    const lines = text.split("\n");
    return lines.some((l) => l.trim()) ? lines : undefined;
  };

  return (
    <details
      data-testid="advanced-section"
      style={{
        border: "1px solid var(--border)",
        borderRadius: 6,
        background: "var(--bg-secondary)",
        padding: "8px 10px",
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          fontSize: 11,
          fontWeight: 600,
          color: "var(--text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        ⚙ Advanced
      </summary>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          marginTop: 10,
        }}
      >
        {/* User-Agent */}
        <div>
          <label className="label">HTTP User-Agent</label>
          <select
            className="input"
            data-testid="adv-ua-select"
            value={uaChoice}
            onChange={(e) => {
              const v = e.target.value;
              setUaChoice(v);
              // Clear any pinned robots token so it follows the new UA
              // (see robotsTokenForUserAgent).
              set("robotsUserAgent", undefined);
              if (v === "__custom__") {
                set("userAgent", config.userAgent || "MyCrawler/1.0");
              } else {
                set("userAgent", v || undefined);
              }
            }}
            disabled={busy}
          >
            {UA_PRESETS.map((p) => (
              <option key={p.label} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          {isCustomUa && (
            <input
              className="input"
              data-testid="adv-ua-custom"
              style={{ marginTop: 4, fontFamily: "monospace", fontSize: 11 }}
              placeholder="MyCrawler/1.0"
              value={config.userAgent ?? ""}
              onChange={(e) => set("userAgent", e.target.value || undefined)}
              disabled={busy}
            />
          )}
        </div>

        {/* Include / Exclude patterns */}
        <div>
          <label className="label">
            Include URL Patterns{" "}
            <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>
              — regex, one per line
            </span>
          </label>
          <textarea
            className="input"
            data-testid="adv-include"
            rows={2}
            placeholder={"/blog/.*\n/products/.*"}
            value={listToText(config.includePatterns)}
            onChange={(e) => set("includePatterns", textToList(e.target.value))}
            disabled={busy}
            style={{
              resize: "vertical",
              fontFamily: "monospace",
              fontSize: 11,
            }}
          />
          <p
            style={{
              fontSize: 10,
              color: "var(--text-muted)",
              margin: "2px 0 0",
            }}
          >
            Discovered URLs must match at least one pattern. Seed URL always
            crawls.
          </p>
        </div>
        <div>
          <label className="label">
            Exclude URL Patterns{" "}
            <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>
              — regex, one per line
            </span>
          </label>
          <textarea
            className="input"
            data-testid="adv-exclude"
            rows={2}
            placeholder={"\\?page=\n/tag/.*"}
            value={listToText(config.excludePatterns)}
            onChange={(e) => set("excludePatterns", textToList(e.target.value))}
            disabled={busy}
            style={{
              resize: "vertical",
              fontFamily: "monospace",
              fontSize: 11,
            }}
          />
        </div>

        {/* URL rewriting */}
        <div>
          <label className="label">
            Strip URL Parameters{" "}
            <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>
              — comma-separated, * wildcard
            </span>
          </label>
          <input
            className="input"
            data-testid="adv-strip-params"
            placeholder="utm_*, fbclid, gclid"
            value={(config.stripUrlParams ?? []).join(", ")}
            onChange={(e) => {
              const parts = e.target.value.split(",").map((s) => s.trim());
              set("stripUrlParams", parts.some(Boolean) ? parts : undefined);
            }}
            disabled={busy}
            style={{ fontFamily: "monospace", fontSize: 11 }}
          />
        </div>

        {/* Scope + cookies */}
        <label className="check-row">
          <input
            type="checkbox"
            data-testid="adv-subfolder"
            checked={!!config.restrictToStartPath}
            onChange={(e) =>
              set("restrictToStartPath", e.target.checked || undefined)
            }
            disabled={busy}
          />
          Crawl within start folder only
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            data-testid="adv-cookies"
            checked={!!config.enableCookies}
            onChange={(e) =>
              set("enableCookies", e.target.checked || undefined)
            }
            disabled={busy}
          />
          Session cookies (keep cookies between requests)
        </label>

        {/* Authentication */}
        <div>
          <label className="label">
            Site Authentication{" "}
            <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>
              — HTTP Basic
            </span>
          </label>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}
          >
            <input
              className="input"
              data-testid="adv-auth-user"
              placeholder="Username"
              autoComplete="off"
              value={config.authUser ?? ""}
              onChange={(e) => set("authUser", e.target.value || undefined)}
              disabled={busy}
            />
            <input
              className="input"
              data-testid="adv-auth-pass"
              type="password"
              placeholder="Password"
              autoComplete="new-password"
              value={config.authPass ?? ""}
              onChange={(e) => set("authPass", e.target.value || undefined)}
              disabled={busy}
            />
          </div>
        </div>

        {/* Custom headers */}
        <div>
          <label className="label">Custom HTTP Headers</label>
          {(config.customHeaders ?? []).map((h, i) => (
            <div key={i} style={{ display: "flex", gap: 4, marginBottom: 4 }}>
              <input
                className="input"
                data-testid={`adv-header-name-${i}`}
                style={{
                  flex: 1,
                  padding: "3px 6px",
                  fontSize: 11,
                  fontFamily: "monospace",
                }}
                placeholder="X-Header-Name"
                value={h.name}
                onChange={(e) => {
                  const headers = [...(config.customHeaders ?? [])];
                  headers[i] = { ...headers[i], name: e.target.value };
                  set("customHeaders", headers);
                }}
                disabled={busy}
              />
              <input
                className="input"
                data-testid={`adv-header-value-${i}`}
                style={{
                  flex: 2,
                  padding: "3px 6px",
                  fontSize: 11,
                  fontFamily: "monospace",
                }}
                placeholder="value"
                value={h.value}
                onChange={(e) => {
                  const headers = [...(config.customHeaders ?? [])];
                  headers[i] = { ...headers[i], value: e.target.value };
                  set("customHeaders", headers);
                }}
                disabled={busy}
              />
              <button
                className="btn-ghost"
                data-testid={`adv-header-remove-${i}`}
                style={{
                  padding: "2px 6px",
                  fontSize: 11,
                  color: "var(--accent-red)",
                }}
                onClick={() => {
                  const headers = (config.customHeaders ?? []).filter(
                    (_, j) => j !== i,
                  );
                  set("customHeaders", headers.length ? headers : undefined);
                }}
                disabled={busy}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            className="btn-ghost"
            data-testid="adv-header-add"
            style={{ fontSize: 11, padding: "3px 10px", marginTop: 2 }}
            onClick={() =>
              set("customHeaders", [
                ...(config.customHeaders ?? []),
                { name: "", value: "" },
              ])
            }
            disabled={busy}
          >
            + Add Header
          </button>
        </div>
      </div>
    </details>
  );
}

// ─── Custom robots.txt textarea + tester ──────────────────────────────────────

interface CustomRobotsProps {
  customRobotsTxt: string;
  robotsUserAgent: string;
  startUrl: string;
  busy: boolean;
  onChangeBody: (v: string) => void;
  onChangeUserAgent: (v: string) => void;
}

const COMMON_AGENTS = [
  "Serpent",
  "*",
  "Googlebot",
  "Googlebot-Mobile",
  "Bingbot",
  "GPTBot",
  "ClaudeBot",
  "PerplexityBot",
];

function CustomRobotsSection(props: CustomRobotsProps): React.ReactElement {
  const {
    customRobotsTxt,
    robotsUserAgent,
    startUrl,
    busy,
    onChangeBody,
    onChangeUserAgent,
  } = props;
  const [testUrl, setTestUrl] = useState<string>("");
  const [testUa, setTestUa] = useState<string>("Googlebot");
  const [result, setResult] = useState<{
    allowed: boolean;
    matchedRule: string | null;
    appliedAgent: string;
  } | null>(null);
  const [testing, setTesting] = useState<boolean>(false);

  useEffect(() => {
    if (!testUrl && startUrl) setTestUrl(startUrl);
  }, [startUrl, testUrl]);

  const runTest = async (): Promise<void> => {
    if (!customRobotsTxt.trim() || !testUrl.trim()) return;
    setTesting(true);
    try {
      const r = await window.api.testRobots({
        robotsTxt: customRobotsTxt,
        url: testUrl.trim(),
        userAgent: testUa,
      });
      setResult({
        allowed: r.allowed,
        matchedRule: r.matchedRule,
        appliedAgent: r.appliedAgent,
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div
      style={{
        padding: 10,
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: "var(--bg-secondary)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div>
        <label className="label">
          Custom robots.txt (overrides live fetch)
        </label>
        <p
          style={{
            fontSize: 10,
            color: "var(--text-muted)",
            margin: "2px 0 4px",
          }}
        >
          Paste a robots.txt body to test rules without modifying the target
          site. Leave blank to fetch from /robots.txt.
        </p>
        <textarea
          value={customRobotsTxt}
          onChange={(e) => onChangeBody(e.target.value)}
          disabled={busy}
          rows={6}
          spellCheck={false}
          placeholder={"User-agent: *\nDisallow: /admin\nAllow: /public"}
          style={{
            width: "100%",
            fontFamily: "monospace",
            fontSize: 11,
            padding: 6,
            border: "1px solid var(--border)",
            borderRadius: 4,
            background: "var(--bg-primary)",
            color: "var(--text-primary)",
            resize: "vertical",
            minHeight: 90,
          }}
        />
      </div>

      <div>
        <label className="label">Crawl as User-Agent</label>
        <select
          className="input"
          value={robotsUserAgent}
          onChange={(e) => onChangeUserAgent(e.target.value)}
          disabled={busy}
        >
          {COMMON_AGENTS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      <details style={{ borderTop: "1px dashed var(--border)", paddingTop: 8 }}>
        <summary
          style={{
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 500,
            color: "var(--text-secondary)",
          }}
        >
          robots.txt tester
        </summary>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            marginTop: 8,
          }}
        >
          <input
            className="input"
            type="url"
            placeholder="https://example.com/path"
            value={testUrl}
            onChange={(e) => setTestUrl(e.target.value)}
          />
          <select
            className="input"
            value={testUa}
            onChange={(e) => setTestUa(e.target.value)}
          >
            {COMMON_AGENTS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <button
            className="btn-ghost"
            onClick={runTest}
            disabled={testing || !customRobotsTxt.trim() || !testUrl.trim()}
            style={{ alignSelf: "flex-start" }}
          >
            {testing ? "Testing…" : "Test URL"}
          </button>
          {result && (
            <div
              role="status"
              data-testid="robots-test-result"
              style={{
                padding: 8,
                borderRadius: 4,
                background: result.allowed
                  ? "var(--tint-green)"
                  : "var(--tint-red)",
                border:
                  "1px solid " +
                  (result.allowed
                    ? "var(--accent-green)"
                    : "var(--accent-red)"),
                fontSize: 11,
                lineHeight: 1.4,
              }}
            >
              <div style={{ fontWeight: 600 }}>
                {result.allowed ? "✓ Allowed" : "✗ Blocked"} for User-Agent{" "}
                <code>{result.appliedAgent}</code>
              </div>
              {result.matchedRule && (
                <div style={{ marginTop: 2, color: "var(--text-secondary)" }}>
                  Matched: <code>{result.matchedRule}</code>
                </div>
              )}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
