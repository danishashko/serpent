import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import path from 'path';
import keytar from 'keytar';
import { initDatabase, markRunningCrawlsAsInterrupted, getAllCrawls, getPagesByCrawl, getLinksByCrawl, getImagesByCrawl, getAIAnalysisByPage, upsertAIAnalysis, getConfig, setConfig, getUsageStats, getRedirectsByCrawl, getHreflangByCrawl, getDuplicatesByCrawl, getCustomExtractionsByCrawl, upsertIssueRecommendation, getIssueRecommendationsByCrawl, calculateLinkScores, compareCrawls, upsertGEOScoresBatch, getGEOScoresByCrawl, upsertPerformanceScoresBatch, getPerformanceScoresByCrawl, getInlinksForUrls, getOutlinksForUrls, getImagesForUrls, getInlinksToStatusCode, getPagesByStatusRange, getNonIndexablePages, getImagesMissingAlt, getInternalLinks, getExternalLinks, updateLinkStatusCodes } from './database';
import { checkExternalLinkStatuses } from './external-link-checker';
import { analyzeGEOBatch } from './geo-analyzer';
import { analyzePerformanceBatch } from './performance-analyzer';
import { generatePdfReport } from './report-generator';
import { CrawlOrchestrator } from './crawler-orchestrator';
import { testBrightDataConnection, testBrightDataBrowserConnection } from './crawler-brightdata';
import { testOllamaConnection, listOllamaModels, analyzeContentQuality, analyzeTechnicalSEO, analyzeIssueGroup, testAIProviderConnection, AIProviderConfig } from './ai-analyzer';
import { querySerpBatch, storeSerpResults, getSerpResults } from './serp-client';
import { discoverCompetitors, discoverContentGaps, getDiscoverResults, getContentGaps } from './discover-client';
import { connectGSC, clearGSCTokens, getGSCSites, fetchGSCData, isGSCConnected, setGSCCredentials } from './gsc-client';
import { generateSitemap as buildSitemap } from './sitemap-generator';
import { analyzeSitemap as runSitemapAnalyze } from './sitemap-analyzer';
import { testRobots as runRobotsTest } from './robots-tester';
import { IPC, CrawlConfig, AppSettings, AIProvider, IssueRecommendation, ReportConfig, BulkExportRequest, BulkExportCategory, PerUrlExportRequest, ExportFormat, PageData, LinkData, ImageData, GEOScore, PerformanceScore, RobotsTestRequest, SitemapGenerateOptions } from '../types/index';
import { autoUpdater } from 'electron-updater';
import fs from 'fs';
import { startMcpServer } from './mcp-server';

const KEYTAR_SERVICE = 'serpent';
const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';

let mainWindow: BrowserWindow | null = null;
const orchestrator = new CrawlOrchestrator();
let mcpHttpServer: import('http').Server | null = null;

// ─── URL / SSRF Safety Helpers ────────────────────────────────────────────────

/** Matches RFC-1918, loopback, link-local, and cloud-metadata hostnames. */
const INTERNAL_HOST_RE =
  /^(localhost|0\.0\.0\.0|::1|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|metadata\.google\.internal)$/i;

/** Returns true only for public http/https URLs (blocks SSRF to internal networks). */
function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    return !INTERNAL_HOST_RE.test(host);
  } catch {
    return false;
  }
}

/** Returns true only for local http/https URLs — Ollama must run on localhost. */
function isSafeLocalUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    return host === 'localhost' || /^127\.\d+\.\d+\.\d+$/.test(host) || host === '::1';
  } catch {
    return false;
  }
}

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f1117',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0f1117',
      symbolColor: '#74b9ff',
      height: 32,
    },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: path.join(__dirname, '../../resources/icon.png'),
    show: false,
  });

  // Fallback: if ready-to-show hasn't fired in 8 s, force-show the window
  const showTimeout = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      console.warn('[MAIN] ready-to-show timeout — force-showing window');
      mainWindow.show();
    }
  }, 8000);

  mainWindow.once('ready-to-show', () => {
    clearTimeout(showTimeout);
    console.log('[MAIN] ready-to-show fired — showing window');
    mainWindow?.show();
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
    console.error(`[MAIN] did-fail-load: ${code} ${desc} url=${url} isMain=${isMain}`);
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[MAIN] render-process-gone:', details);
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173').catch((err: Error) => {
      console.error('[MAIN] loadURL failed:', err.message);
    });
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Only open http/https external links — prevents arbitrary-protocol RCE.
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        shell.openExternal(url);
      }
    } catch { /* ignore malformed URLs */ }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── App Lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  console.log('[MAIN] app ready — initializing DB');
  initDatabase();
  // Clear stale state from previous sessions that crashed mid-crawl.
  const interrupted = markRunningCrawlsAsInterrupted();
  if (interrupted > 0) {
    console.log(`[MAIN] marked ${interrupted} stale running crawl(s) as interrupted`);
  }
  console.log('[MAIN] DB initialized — creating window');
  createWindow();
  console.log('[MAIN] window created');
  mcpHttpServer = startMcpServer(orchestrator);

  // Auto-update (silent check + IPC events, only in production)
  if (!isDev) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => {
      mainWindow?.webContents.send('update:available', { version: info.version });
    });

    autoUpdater.on('update-downloaded', (info) => {
      mainWindow?.webContents.send('update:downloaded', { version: info.version });
    });

    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  }

  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Gracefully close the MCP HTTP server before the process exits so the port
// (7777) is released before electronmon restarts the process in dev mode.
app.on('before-quit', (event) => {
  if (mcpHttpServer) {
    event.preventDefault();
    const srv = mcpHttpServer;
    mcpHttpServer = null;
    // closeAllConnections() available in Node 18.2+ — forces immediate release
    if (typeof (srv as any).closeAllConnections === 'function') {
      (srv as any).closeAllConnections();
    }
    srv.close(() => app.quit());
  }
});

// ─── Crawl IPC Handlers ────────────────────────────────────────────────────────

// Forward orchestrator progress events to renderer
orchestrator.on('progress', (progress) => {
  mainWindow?.webContents.send(IPC.CRAWL_PROGRESS, progress);
});

orchestrator.on('error', (err: Error) => {
  mainWindow?.webContents.send(IPC.CRAWL_ERROR, err.message);
});

orchestrator.on('complete', (crawlId: string) => {
  calculateLinkScores(crawlId);
  mainWindow?.webContents.send(IPC.CRAWL_COMPLETE, crawlId);

  // Check external link statuses in the background (non-blocking)
  checkExternalLinkStatuses(crawlId)
    .then(statusMap => {
      if (statusMap.size > 0) {
        updateLinkStatusCodes(crawlId, statusMap);
        mainWindow?.webContents.send('crawl:links-updated', crawlId);
      }
    })
    .catch(err => console.error('[EXTERNAL-LINKS] Status check failed:', err));
});

orchestrator.on('cost-limit-warning', (data: { currentSpend: number; limit: number }) => {
  mainWindow?.webContents.send('crawl:cost-limit', data);
});

ipcMain.handle(IPC.CRAWL_START, async (_event, config: CrawlConfig) => {
  try {
    // Basic URL validation — must be http/https
    let urlValid = false;
    try { urlValid = ['http:', 'https:'].includes(new URL(config.startUrl).protocol); } catch { /* invalid */ }
    if (!urlValid) {
      return { success: false, error: 'Invalid start URL. Must be an http/https address.' };
    }

    // ── (Open-source: no free tier gate) ──────────────────────────────────────

    let apiKey: string | null = null;
    let bdZone: string | null = null;
    let bdCustomerId: string | null = null;
    let bdBrowserAuth: string | null = null;

    if (config.engine === 'brightdata') {
      // BrightData proxies requests via external servers — block internal IPs to prevent SSRF
      if (!isSafeExternalUrl(config.startUrl)) {
        return { success: false, error: 'Invalid start URL. Must be a public http/https address.' };
      }
      apiKey = await keytar.getPassword(KEYTAR_SERVICE, 'bd_api_key');
      bdZone = await keytar.getPassword(KEYTAR_SERVICE, 'bd_zone');
      bdCustomerId = await keytar.getPassword(KEYTAR_SERVICE, 'bd_customer_id');
      if (!apiKey) {
        return { success: false, error: 'Bright Data API key not configured. Go to Settings.' };
      }
    } else if (config.engine === 'brightdata-browser') {
      // Browser API also proxies via external servers — block internal IPs to prevent SSRF
      if (!isSafeExternalUrl(config.startUrl)) {
        return { success: false, error: 'Invalid start URL. Must be a public http/https address.' };
      }
      bdBrowserAuth = await keytar.getPassword(KEYTAR_SERVICE, 'bd_browser_auth');
      if (!bdBrowserAuth) {
        return { success: false, error: 'Bright Data Browser API credentials not configured. Go to Settings.' };
      }
    }

    const crawlId = await orchestrator.startCrawl(config, apiKey || undefined, bdZone || undefined, bdBrowserAuth || undefined, bdCustomerId || undefined);
    return { success: true, crawlId };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle(IPC.CRAWL_PAUSE, () => {
  orchestrator.pause();
  return { success: true };
});

ipcMain.handle(IPC.CRAWL_RESUME, () => {
  orchestrator.resume();
  return { success: true };
});

ipcMain.handle(IPC.CRAWL_STOP, () => {
  orchestrator.stop();
  return { success: true };
});

ipcMain.handle(IPC.CRAWL_GET_INCOMPLETE, () => {
  const incomplete = orchestrator.getIncompleteCrawl();
  if (!incomplete) return null;
  return {
    id: incomplete.id,
    startUrl: incomplete.startUrl,
    completedUrls: incomplete.completedUrls,
    totalUrls: incomplete.totalUrls,
    status: incomplete.status,
  };
});

ipcMain.handle(IPC.CRAWL_RESUME_INCOMPLETE, async () => {
  try {
    let apiKey: string | null = null;
    let bdZone: string | null = null;
    let bdCustomerId: string | null = null;
    let bdBrowserAuth: string | null = null;

    const incomplete = orchestrator.getIncompleteCrawl();
    if (!incomplete) return { success: false, error: 'No incomplete crawl found' };

    const config: CrawlConfig = JSON.parse(incomplete.configJson);
    if (config.engine === 'brightdata') {
      apiKey = await keytar.getPassword(KEYTAR_SERVICE, 'bd_api_key');
      bdZone = await keytar.getPassword(KEYTAR_SERVICE, 'bd_zone');
      bdCustomerId = await keytar.getPassword(KEYTAR_SERVICE, 'bd_customer_id');
    } else if (config.engine === 'brightdata-browser') {
      bdBrowserAuth = await keytar.getPassword(KEYTAR_SERVICE, 'bd_browser_auth');
    }

    const crawlId = await orchestrator.resumeIncompleteCrawl(apiKey || undefined, bdZone || undefined, bdBrowserAuth || undefined, bdCustomerId || undefined);
    return { success: true, crawlId };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

// ─── Data IPC Handlers ─────────────────────────────────────────────────────────

ipcMain.handle(IPC.DATA_GET_CRAWLS, () => {
  return getAllCrawls();
});

ipcMain.handle(IPC.DATA_GET_PAGES, (_event, crawlId: string) => {
  return getPagesByCrawl(crawlId);
});

ipcMain.handle(IPC.DATA_GET_LINKS, (_event, crawlId: string) => {
  return getLinksByCrawl(crawlId);
});

ipcMain.handle(IPC.DATA_GET_IMAGES, (_event, crawlId: string) => {
  return getImagesByCrawl(crawlId);
});

ipcMain.handle(IPC.DATA_GET_REDIRECTS, (_event, crawlId: string) => {
  return getRedirectsByCrawl(crawlId);
});

ipcMain.handle(IPC.DATA_GET_HREFLANG, (_event, crawlId: string) => {
  return getHreflangByCrawl(crawlId);
});

ipcMain.handle(IPC.DATA_GET_DUPLICATES, (_event, crawlId: string) => {
  return getDuplicatesByCrawl(crawlId);
});

ipcMain.handle(IPC.DATA_GET_CUSTOM_EXTRACTS, (_event, crawlId: string) => {
  return getCustomExtractionsByCrawl(crawlId);
});

ipcMain.handle(IPC.DATA_EXPORT_CSV, async (_event, data: { rows: Record<string, unknown>[]; filename: string }) => {
  try {
    const { filePath } = await dialog.showSaveDialog({
      defaultPath: data.filename,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (!filePath) return { success: false, cancelled: true };

    fs.writeFileSync(filePath, buildCsvString(data.rows), 'utf8');
    return { success: true, filePath };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle(IPC.DATA_EXPORT_JSON, async (_event, data: { rows: Record<string, unknown>[]; filename: string }) => {
  try {
    const { filePath } = await dialog.showSaveDialog({
      defaultPath: data.filename,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!filePath) return { success: false, cancelled: true };

    fs.writeFileSync(filePath, JSON.stringify(data.rows, null, 2), 'utf8');
    return { success: true, filePath };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

// ─── Settings IPC Handlers ─────────────────────────────────────────────────────

ipcMain.handle(IPC.SETTINGS_GET, async () => {
  const apiKey = await keytar.getPassword(KEYTAR_SERVICE, 'bd_api_key');
  const bdZone = await keytar.getPassword(KEYTAR_SERVICE, 'bd_zone');
  const bdCustomerId = await keytar.getPassword(KEYTAR_SERVICE, 'bd_customer_id');
  const bdBrowserAuth = await keytar.getPassword(KEYTAR_SERVICE, 'bd_browser_auth');
  const openaiApiKey = await keytar.getPassword(KEYTAR_SERVICE, 'openai_api_key');
  const anthropicApiKey = await keytar.getPassword(KEYTAR_SERVICE, 'anthropic_api_key');
  const geminiApiKey = await keytar.getPassword(KEYTAR_SERVICE, 'gemini_api_key');
  const openrouterApiKey = await keytar.getPassword(KEYTAR_SERVICE, 'openrouter_api_key');

  const settings: AppSettings = {
    brightDataApiKey: apiKey || null,
    brightDataZone: bdZone || 'web_unlocker1',
    brightDataCustomerId: bdCustomerId || null,
    brightDataBrowserAuth: bdBrowserAuth || null,
    maxCostPerCrawl: parseFloat(getConfig('max_cost_per_crawl') || '10'),
    maxCostPerDay: parseFloat(getConfig('max_cost_per_day') || '50'),
    aiProvider: (getConfig('ai_provider') as AIProvider) || 'ollama',
    ollamaUrl: getConfig('ollama_url') || 'http://localhost:11434',
    ollamaModel: getConfig('ollama_model') || 'llama3',
    openaiApiKey: openaiApiKey || null,
    openaiModel: getConfig('openai_model') || 'gpt-4o-mini',
    anthropicApiKey: anthropicApiKey || null,
    anthropicModel: getConfig('anthropic_model') || 'claude-sonnet-4-20250514',
    geminiApiKey: geminiApiKey || null,
    geminiModel: getConfig('gemini_model') || 'gemini-2.0-flash',
    openrouterApiKey: openrouterApiKey || null,
    openrouterModel: getConfig('openrouter_model') || 'deepseek/deepseek-v4-flash',
    defaultEngine: (getConfig('default_engine') as AppSettings['defaultEngine']) || 'local',
    defaultStorageMode: (getConfig('default_storage_mode') as AppSettings['defaultStorageMode']) || 'database',
  };

  return settings;
});

ipcMain.handle(IPC.SETTINGS_SAVE, async (_event, settings: Partial<AppSettings>) => {
  try {
    if (settings.brightDataApiKey !== undefined) {
      if (settings.brightDataApiKey) {
        await keytar.setPassword(KEYTAR_SERVICE, 'bd_api_key', settings.brightDataApiKey);
      } else {
        await keytar.deletePassword(KEYTAR_SERVICE, 'bd_api_key');
      }
    }
    if (settings.brightDataZone !== undefined) {
      await keytar.setPassword(KEYTAR_SERVICE, 'bd_zone', settings.brightDataZone || 'web_unlocker1');
    }
    if (settings.brightDataCustomerId !== undefined) {
      if (settings.brightDataCustomerId) {
        await keytar.setPassword(KEYTAR_SERVICE, 'bd_customer_id', settings.brightDataCustomerId);
      } else {
        await keytar.deletePassword(KEYTAR_SERVICE, 'bd_customer_id').catch(() => {});
      }
    }
    if (settings.brightDataBrowserAuth !== undefined) {
      if (settings.brightDataBrowserAuth) {
        await keytar.setPassword(KEYTAR_SERVICE, 'bd_browser_auth', settings.brightDataBrowserAuth);
      } else {
        await keytar.deletePassword(KEYTAR_SERVICE, 'bd_browser_auth').catch(() => {});
      }
    }
    if (settings.maxCostPerCrawl !== undefined) setConfig('max_cost_per_crawl', String(settings.maxCostPerCrawl));
    if (settings.maxCostPerDay !== undefined) setConfig('max_cost_per_day', String(settings.maxCostPerDay));
    if (settings.ollamaUrl !== undefined) setConfig('ollama_url', settings.ollamaUrl);
    if (settings.ollamaModel !== undefined) setConfig('ollama_model', settings.ollamaModel);
    if (settings.aiProvider !== undefined) setConfig('ai_provider', settings.aiProvider);
    if (settings.openaiApiKey !== undefined) {
      if (settings.openaiApiKey) {
        await keytar.setPassword(KEYTAR_SERVICE, 'openai_api_key', settings.openaiApiKey);
      } else {
        await keytar.deletePassword(KEYTAR_SERVICE, 'openai_api_key').catch(() => {});
      }
    }
    if (settings.openaiModel !== undefined) setConfig('openai_model', settings.openaiModel);
    if (settings.anthropicApiKey !== undefined) {
      if (settings.anthropicApiKey) {
        await keytar.setPassword(KEYTAR_SERVICE, 'anthropic_api_key', settings.anthropicApiKey);
      } else {
        await keytar.deletePassword(KEYTAR_SERVICE, 'anthropic_api_key').catch(() => {});
      }
    }
    if (settings.anthropicModel !== undefined) setConfig('anthropic_model', settings.anthropicModel);
    if (settings.geminiApiKey !== undefined) {
      if (settings.geminiApiKey) {
        await keytar.setPassword(KEYTAR_SERVICE, 'gemini_api_key', settings.geminiApiKey);
      } else {
        await keytar.deletePassword(KEYTAR_SERVICE, 'gemini_api_key').catch(() => {});
      }
    }
    if (settings.geminiModel !== undefined) setConfig('gemini_model', settings.geminiModel);
    if (settings.openrouterApiKey !== undefined) {
      if (settings.openrouterApiKey) {
        await keytar.setPassword(KEYTAR_SERVICE, 'openrouter_api_key', settings.openrouterApiKey);
      } else {
        await keytar.deletePassword(KEYTAR_SERVICE, 'openrouter_api_key').catch(() => {});
      }
    }
    if (settings.openrouterModel !== undefined) setConfig('openrouter_model', settings.openrouterModel);
    if (settings.defaultEngine !== undefined) setConfig('default_engine', settings.defaultEngine);
    if (settings.defaultStorageMode !== undefined) setConfig('default_storage_mode', settings.defaultStorageMode);

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle(IPC.SETTINGS_TEST_BD, async (_event, apiKey: string, zone: string) => {
  const ok = await testBrightDataConnection(apiKey, zone);
  return { success: ok };
});

ipcMain.handle(IPC.SETTINGS_TEST_BD_BROWSER, async (_event, auth: string) => {
  const ok = await testBrightDataBrowserConnection(auth);
  return { success: ok };
});

ipcMain.handle(IPC.SETTINGS_TEST_OLLAMA, async (_event, url: string) => {
  if (!isSafeLocalUrl(url)) {
    return { success: false, models: [], error: 'Ollama URL must be a local address (http://localhost:...).' };
  }
  const ok = await testOllamaConnection(url);
  const models = ok ? await listOllamaModels(url) : [];
  return { success: ok, models };
});

ipcMain.handle(IPC.SETTINGS_TEST_AI_PROVIDER, async (_event, provider: AIProvider, config: { ollamaUrl?: string; apiKey?: string }) => {
  return testAIProviderConnection(provider, config);
});

// ─── AI IPC Handlers ──────────────────────────────────────────────────────────

async function buildAIProviderConfig(): Promise<{ config: AIProviderConfig } | { error: string }> {
  const provider = (getConfig('ai_provider') as AIProvider) || 'ollama';
  switch (provider) {
    case 'openai': {
      const key = await keytar.getPassword(KEYTAR_SERVICE, 'openai_api_key');
      if (!key) return { error: 'OpenAI API key not configured. Go to Settings.' };
      return { config: { provider: 'openai', model: getConfig('openai_model') || 'gpt-4o-mini', apiKey: key } };
    }
    case 'anthropic': {
      const key = await keytar.getPassword(KEYTAR_SERVICE, 'anthropic_api_key');
      if (!key) return { error: 'Anthropic API key not configured. Go to Settings.' };
      return { config: { provider: 'anthropic', model: getConfig('anthropic_model') || 'claude-sonnet-4-20250514', apiKey: key } };
    }
    case 'gemini': {
      const key = await keytar.getPassword(KEYTAR_SERVICE, 'gemini_api_key');
      if (!key) return { error: 'Gemini API key not configured. Go to Settings.' };
      return { config: { provider: 'gemini', model: getConfig('gemini_model') || 'gemini-2.0-flash', apiKey: key } };
    }
    case 'openrouter': {
      const key = await keytar.getPassword(KEYTAR_SERVICE, 'openrouter_api_key');
      if (!key) return { error: 'OpenRouter API key not configured. Go to Settings.' };
      return { config: { provider: 'openrouter', model: getConfig('openrouter_model') || 'openai/gpt-4o-mini', apiKey: key } };
    }
    default:
      return { config: { provider: 'ollama', model: getConfig('ollama_model') || 'llama3', ollamaUrl: getConfig('ollama_url') || 'http://localhost:11434' } };
  }
}

ipcMain.handle(IPC.AI_ANALYZE, async (_event, crawlId: string) => {
  try {
    const result = await buildAIProviderConfig();
    if ('error' in result) return { success: false, error: result.error };
    const providerConfig = result.config;

    const pages = getPagesByCrawl(crawlId);
    let analyzed = 0;

    for (const page of pages) {
      const analysisInput = {
        url: page.url,
        title: page.title,
        metaDescription: page.metaDescription,
        h1: page.h1,
        wordCount: page.wordCount,
        statusCode: page.statusCode,
        canonicalUrl: page.canonicalUrl,
        isIndexable: page.isIndexable,
      };

      const [contentResult, technicalResult] = await Promise.all([
        analyzeContentQuality(analysisInput, providerConfig),
        analyzeTechnicalSEO(analysisInput, providerConfig),
      ]);

      const now = new Date().toISOString();

      upsertAIAnalysis({
        pageId: page.id,
        analysisType: 'content',
        score: contentResult.score,
        insightsJson: JSON.stringify(contentResult),
        createdAt: now,
      });

      upsertAIAnalysis({
        pageId: page.id,
        analysisType: 'technical',
        score: technicalResult.score,
        insightsJson: JSON.stringify(technicalResult),
        createdAt: now,
      });

      analyzed++;
      mainWindow?.webContents.send(IPC.AI_ANALYZE_PROGRESS, {
        total: pages.length,
        completed: analyzed,
        currentUrl: page.url,
      });
    }

    return { success: true, total: analyzed };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle(IPC.AI_ANALYZE_PAGE, async (_event, pageId: string, pageData: { url: string; title: string | null; metaDescription: string | null; h1: string | null; wordCount: number | null; statusCode: number | null; canonicalUrl: string | null; isIndexable: boolean | null }) => {
  try {
    const result = await buildAIProviderConfig();
    if ('error' in result) return { success: false, error: result.error };
    const providerConfig = result.config;

    const analysisInput = {
      url: pageData.url,
      title: pageData.title,
      metaDescription: pageData.metaDescription,
      h1: pageData.h1,
      wordCount: pageData.wordCount,
      statusCode: pageData.statusCode,
      canonicalUrl: pageData.canonicalUrl,
      isIndexable: pageData.isIndexable ?? true,
    };

    const [contentResult, technicalResult] = await Promise.all([
      analyzeContentQuality(analysisInput, providerConfig),
      analyzeTechnicalSEO(analysisInput, providerConfig),
    ]);

    const now = new Date().toISOString();

    upsertAIAnalysis({
      pageId,
      analysisType: 'content',
      score: contentResult.score,
      insightsJson: JSON.stringify(contentResult),
      createdAt: now,
    });

    upsertAIAnalysis({
      pageId,
      analysisType: 'technical',
      score: technicalResult.score,
      insightsJson: JSON.stringify(technicalResult),
      createdAt: now,
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle(IPC.AI_GET_RESULTS, (_event, pageId: string) => {
  return getAIAnalysisByPage(pageId);
});

ipcMain.handle(IPC.AI_ANALYZE_ISSUES, async (_event, data: { crawlId: string; issueType: string; severity: string; affectedPages: { url: string; title?: string | null; statusCode?: number | null }[] }) => {
  try {
    const result = await buildAIProviderConfig();
    if ('error' in result) return { success: false, error: result.error };

    const analysis = await analyzeIssueGroup(data.issueType, data.affectedPages, result.config);
    const now = new Date().toISOString();

    const rec: IssueRecommendation = {
      crawlId: data.crawlId,
      issueType: data.issueType,
      severity: data.severity as IssueRecommendation['severity'],
      explanation: analysis.explanation,
      fixSuggestions: analysis.fixSuggestions,
      affectedCount: data.affectedPages.length,
      createdAt: now,
    };
    upsertIssueRecommendation(rec);
    return { success: true, recommendation: rec };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle(IPC.AI_GET_ISSUE_RECS, (_event, crawlId: string) => {
  return getIssueRecommendationsByCrawl(crawlId);
});

// ─── SERP IPC Handlers ─────────────────────────────────────────────────────────

ipcMain.handle(IPC.SERP_QUERY, async (_event, data: { crawlId: string; keywords: string[]; location?: string; device?: 'desktop' | 'mobile' }) => {
  try {
    const apiKey = await keytar.getPassword(KEYTAR_SERVICE, 'bd_api_key');
    const bdZone = await keytar.getPassword(KEYTAR_SERVICE, 'bd_zone');
    if (!apiKey) return { success: false, error: 'Bright Data API key not configured' };

    const results = await querySerpBatch(data.keywords, apiKey, bdZone || 'serp', data.location, data.device);
    storeSerpResults(data.crawlId, results);

    const totalCost = results.reduce((sum, r) => sum + (r.costUsd || 0), 0);
    return { success: true, total: results.length, totalCost };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle(IPC.SERP_GET_RESULTS, (_event, crawlId: string) => {
  return getSerpResults(crawlId);
});

// ─── Usage / Cost IPC ──────────────────────────────────────────────────────────

ipcMain.handle(IPC.USAGE_GET_STATS, () => {
  return getUsageStats();
});

// ─── Crawl Comparison IPC ──────────────────────────────────────────────────────

ipcMain.handle(IPC.DATA_COMPARE_CRAWLS, (_e, crawlIdA: string, crawlIdB: string) => {
  return compareCrawls(crawlIdA, crawlIdB);
});

// ─── GSC IPC Handlers ──────────────────────────────────────────────────────────

ipcMain.handle(IPC.GSC_CONNECT, async () => {
  const id = getConfig('gsc_client_id');
  const secret = getConfig('gsc_client_secret');
  if (!id || !secret) throw new Error('Set gsc_client_id and gsc_client_secret in Settings first');
  setGSCCredentials(id, secret);
  return connectGSC();
});

ipcMain.handle(IPC.GSC_DISCONNECT, async () => {
  await clearGSCTokens();
  return true;
});

ipcMain.handle(IPC.GSC_GET_SITES, async () => {
  return getGSCSites();
});

ipcMain.handle(IPC.GSC_FETCH_DATA, async (_e, siteUrl: string) => {
  return fetchGSCData(siteUrl);
});

ipcMain.handle(IPC.GSC_GET_STATUS, async () => {
  return isGSCConnected();
});

// ─── GEO/AEO IPC Handlers ──────────────────────────────────────────────────────

ipcMain.handle(IPC.GEO_ANALYZE, async (_event, crawlId: string) => {
  try {
    const pages = getPagesByCrawl(crawlId);
    const links = getLinksByCrawl(crawlId);
    const images = getImagesByCrawl(crawlId);
    const scores = analyzeGEOBatch(pages, links, images);
    upsertGEOScoresBatch(scores);
    return { success: true, total: scores.length };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle(IPC.GEO_GET_SCORES, (_event, crawlId: string) => {
  return getGEOScoresByCrawl(crawlId);
});

// ─── Performance IPC Handlers ───────────────────────────────────────────────────

ipcMain.handle(IPC.PERF_ANALYZE, async (_event, crawlId: string) => {
  try {
    const pages = getPagesByCrawl(crawlId);
    const images = getImagesByCrawl(crawlId);
    const scores = analyzePerformanceBatch(pages, images);
    upsertPerformanceScoresBatch(scores);
    return { success: true, total: scores.length };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle(IPC.PERF_GET_SCORES, (_event, crawlId: string) => {
  return getPerformanceScoresByCrawl(crawlId);
});

// ─── Report IPC Handlers ────────────────────────────────────────────────────────

ipcMain.handle(IPC.REPORT_GENERATE_PDF, async (_event, data: { config: ReportConfig; crawlId: string }) => {
  try {
    const pages = getPagesByCrawl(data.crawlId);
    const links = getLinksByCrawl(data.crawlId);
    const images = getImagesByCrawl(data.crawlId);
    const geoScores = getGEOScoresByCrawl(data.crawlId);
    const perfScores = getPerformanceScoresByCrawl(data.crawlId);
    return generatePdfReport({ config: data.config, pages, links, images, geoScores, perfScores });
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

// ─── Bulk / Flexible Export IPC Handlers ────────────────────────────────────────

function buildCsvString(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const keys = Object.keys(rows[0]);
  const header = keys.join(',');
  const lines = rows.map(row =>
    keys.map(k => {
      const val = row[k];
      if (val === null || val === undefined) return '';
      const str = String(val);
      // Prevent spreadsheet formula injection (OWASP CSV injection)
      const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
      if (safe.includes(',') || safe.includes('"') || safe.includes('\n')) {
        return `"${safe.replace(/"/g, '""')}"`;
      }
      return safe;
    }).join(',')
  );
  return [header, ...lines].join('\n');
}

function pageToFullRow(p: PageData): Record<string, unknown> {
  return {
    url: p.url, status_code: p.statusCode ?? '', content_type: p.contentType ?? '',
    title: p.title ?? '', title_length: p.titleLength ?? '', title_px: p.titlePixelWidth ?? '',
    meta_description: p.metaDescription ?? '', meta_length: p.metaDescLength ?? '',
    meta_px: p.metaDescPixelWidth ?? '', h1: p.h1 ?? '', h1_length: p.h1Length ?? '',
    h1_count: p.h1Count ?? '', h2: p.h2 ?? '', h2_length: p.h2Length ?? '', h2_count: p.h2Count ?? '',
    word_count: p.wordCount ?? '', text_ratio: p.textRatio ?? '',
    page_size_bytes: p.pageSizeBytes ?? '', crawl_depth: p.crawlDepth,
    canonical: p.canonicalUrl ?? '', is_canonicalized: p.isCanonicalized ? 'true' : 'false',
    indexable: p.isIndexable ? 'true' : 'false', response_ms: p.responseTimeMs ?? '',
    robots_directives: p.robotsDirectives ?? '', meta_keywords: p.metaKeywords ?? '',
    og_title: p.ogTitle ?? '', og_description: p.ogDescription ?? '',
    og_image: p.ogImage ?? '', og_type: p.ogType ?? '',
    twitter_card: p.twitterCard ?? '', twitter_title: p.twitterTitle ?? '',
    twitter_description: p.twitterDescription ?? '', twitter_image: p.twitterImage ?? '',
    schema_types: p.schemaTypes ?? '', has_structured_data: p.hasStructuredData ? 'true' : 'false',
    has_hsts: p.hasHSTS ? 'true' : 'false', has_csp: p.hasCSP ? 'true' : 'false',
    x_frame_options: p.xFrameOptions ?? '', x_content_type_options: p.xContentTypeOptions ?? '',
    image_count: p.imageCount, link_score: p.linkScore, content_hash: p.contentHash ?? '',
  };
}

function linkToRow(l: LinkData): Record<string, unknown> {
  return {
    source_url: l.sourceUrl, target_url: l.targetUrl, anchor_text: l.anchorText ?? '',
    type: l.isInternal ? 'internal' : 'external', rel: l.relAttr ?? '',
  };
}

function imageToRow(img: ImageData): Record<string, unknown> {
  return {
    image_url: img.imageUrl, source_page: img.pageUrl, alt_text: img.altText ?? '',
    format: img.format ?? '', has_width: img.hasWidth ? 'true' : 'false',
    has_height: img.hasHeight ? 'true' : 'false', is_lazy: img.isLazy ? 'true' : 'false',
  };
}

function geoToRow(g: GEOScore): Record<string, unknown> {
  return {
    url: g.url, overall_score: g.overallScore, entity_clarity: g.entityClarity,
    answer_readiness: g.answerReadiness, citation_signals: g.citationSignals,
    structured_data_completeness: g.structuredDataCompleteness,
    issues: g.issues.map(i => i.message).join(' | '),
  };
}

function perfToRow(p: PerformanceScore): Record<string, unknown> {
  return {
    url: p.url, overall_score: p.overallScore, ttfb_score: p.ttfbScore,
    page_size_score: p.pageSizeScore, image_opt_score: p.imageOptScore,
    content_efficiency: p.contentEfficiency, ttfb_ms: p.ttfbMs,
    total_bytes: p.totalBytes, image_bytes: p.imageBytes,
    issues: p.issues.map(i => i.message).join(' | '),
  };
}

function getCategoryData(crawlId: string, category: BulkExportCategory): { rows: Record<string, unknown>[]; label: string } {
  switch (category) {
    case 'all_inlinks': {
      const links = getLinksByCrawl(crawlId);
      return { rows: links.map(linkToRow), label: 'all-inlinks' };
    }
    case 'all_outlinks': {
      const links = getLinksByCrawl(crawlId);
      return { rows: links.map(linkToRow), label: 'all-outlinks' };
    }
    case 'internal_links': {
      const links = getInternalLinks(crawlId);
      return { rows: links.map(linkToRow), label: 'internal-links' };
    }
    case 'external_links': {
      const links = getExternalLinks(crawlId);
      return { rows: links.map(linkToRow), label: 'external-links' };
    }
    case 'inlinks_to_3xx': {
      const links = getInlinksToStatusCode(crawlId, 300, 400);
      return { rows: links.map(linkToRow), label: 'inlinks-to-3xx' };
    }
    case 'inlinks_to_4xx': {
      const links = getInlinksToStatusCode(crawlId, 400, 500);
      return { rows: links.map(linkToRow), label: 'inlinks-to-4xx' };
    }
    case 'inlinks_to_5xx': {
      const links = getInlinksToStatusCode(crawlId, 500, 600);
      return { rows: links.map(linkToRow), label: 'inlinks-to-5xx' };
    }
    case 'all_pages_full': {
      const pages = getPagesByCrawl(crawlId);
      return { rows: pages.map(pageToFullRow), label: 'all-pages-full' };
    }
    case 'pages_2xx': {
      const pages = getPagesByStatusRange(crawlId, 200, 300);
      return { rows: pages.map(pageToFullRow), label: 'pages-2xx' };
    }
    case 'pages_3xx': {
      const pages = getPagesByStatusRange(crawlId, 300, 400);
      return { rows: pages.map(pageToFullRow), label: 'pages-3xx' };
    }
    case 'pages_4xx': {
      const pages = getPagesByStatusRange(crawlId, 400, 500);
      return { rows: pages.map(pageToFullRow), label: 'pages-4xx' };
    }
    case 'pages_5xx': {
      const pages = getPagesByStatusRange(crawlId, 500, 600);
      return { rows: pages.map(pageToFullRow), label: 'pages-5xx' };
    }
    case 'non_indexable_pages': {
      const pages = getNonIndexablePages(crawlId);
      return { rows: pages.map(pageToFullRow), label: 'non-indexable' };
    }
    case 'all_images': {
      const images = getImagesByCrawl(crawlId);
      return { rows: images.map(imageToRow), label: 'all-images' };
    }
    case 'images_missing_alt': {
      const images = getImagesMissingAlt(crawlId);
      return { rows: images.map(imageToRow), label: 'images-missing-alt' };
    }
    case 'geo_scores': {
      const scores = getGEOScoresByCrawl(crawlId);
      return { rows: scores.map(geoToRow), label: 'geo-scores' };
    }
    case 'perf_scores': {
      const scores = getPerformanceScoresByCrawl(crawlId);
      return { rows: scores.map(perfToRow), label: 'perf-scores' };
    }
    case 'redirects': {
      const redirects = getRedirectsByCrawl(crawlId);
      return {
        rows: redirects.map(r => ({
          source_url: r.sourceUrl, target_url: r.targetUrl, status_code: r.statusCode,
          hop_number: r.hopNumber, final_url: r.finalUrl,
        })),
        label: 'redirects',
      };
    }
    case 'hreflang': {
      const hreflang = getHreflangByCrawl(crawlId);
      return {
        rows: hreflang.map(h => ({ page_url: h.pageUrl, hreflang: h.hreflang, href: h.href })),
        label: 'hreflang',
      };
    }
    case 'duplicates': {
      const dupes = getDuplicatesByCrawl(crawlId);
      return {
        rows: dupes.map(d => ({ content_hash: d.contentHash, urls: d.urls.join(' | '), count: d.urls.length })),
        label: 'duplicates',
      };
    }
    case 'custom_extractions': {
      const extracts = getCustomExtractionsByCrawl(crawlId);
      return {
        rows: extracts.map(e => ({ page_url: e.pageUrl, rule_name: e.ruleName, selector: e.selector, value: e.value ?? '' })),
        label: 'custom-extractions',
      };
    }
    default:
      return { rows: [], label: 'unknown' };
  }
}

function writeExportFile(filePath: string, rows: Record<string, unknown>[], format: ExportFormat): void {
  if (format === 'csv') {
    fs.writeFileSync(filePath, buildCsvString(rows), 'utf8');
  } else {
    fs.writeFileSync(filePath, JSON.stringify(rows, null, 2), 'utf8');
  }
}

ipcMain.handle(IPC.EXPORT_BULK, async (_event, req: BulkExportRequest) => {
  try {
    const { crawlId, categories, format } = req;
    const ext = format === 'csv' ? 'csv' : 'json';

    if (categories.length === 1) {
      // Single category: save as single file
      const { rows, label } = getCategoryData(crawlId, categories[0]);
      if (rows.length === 0) return { success: false, error: 'No data for this export' };
      const { filePath } = await dialog.showSaveDialog({
        defaultPath: `serpent-${label}.${ext}`,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      });
      if (!filePath) return { success: false, cancelled: true };
      writeExportFile(filePath, rows, format);
      return { success: true, filePath, totalRows: rows.length };
    }

    // Multiple categories: pick a folder, save as separate files
    const { filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select folder for bulk export',
    });
    if (!filePaths || filePaths.length === 0) return { success: false, cancelled: true };

    const dir = filePaths[0];
    let totalFiles = 0;
    let totalRows = 0;
    for (const cat of categories) {
      const { rows, label } = getCategoryData(crawlId, cat);
      if (rows.length === 0) continue;
      const outPath = path.join(dir, `serpent-${label}.${ext}`);
      writeExportFile(outPath, rows, format);
      totalFiles++;
      totalRows += rows.length;
    }
    return { success: true, filePath: dir, totalFiles, totalRows };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle(IPC.EXPORT_PER_URL, async (_event, req: PerUrlExportRequest) => {
  try {
    const { crawlId, urls, type, format } = req;
    const ext = format === 'csv' ? 'csv' : 'json';

    let rows: Record<string, unknown>[] = [];
    let label = '';
    if (type === 'inlinks') {
      const links = getInlinksForUrls(crawlId, urls);
      rows = links.map(linkToRow);
      label = 'inlinks';
    } else if (type === 'outlinks') {
      const links = getOutlinksForUrls(crawlId, urls);
      rows = links.map(linkToRow);
      label = 'outlinks';
    } else if (type === 'images') {
      const images = getImagesForUrls(crawlId, urls);
      rows = images.map(imageToRow);
      label = 'images';
    }

    if (rows.length === 0) return { success: false, error: 'No data for selected URLs' };

    const { filePath } = await dialog.showSaveDialog({
      defaultPath: `serpent-${label}-${urls.length}-pages.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (!filePath) return { success: false, cancelled: true };
    writeExportFile(filePath, rows, format);
    return { success: true, filePath, totalRows: rows.length };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

// ─── Discover (Competitor Discovery + Content Gap) ────────────────────────────

ipcMain.handle(IPC.DISCOVER_COMPETITORS, async (_event, data: { crawlId: string; domain: string; keywords: string[]; country?: string }) => {
  try {
    const apiKey = await keytar.getPassword(KEYTAR_SERVICE, 'bd_api_key');
    if (!apiKey) return { success: false, error: 'Bright Data API key not configured' };
    const results = await discoverCompetitors(data.crawlId, data.domain, data.keywords, apiKey, data.country);
    return { success: true, results, total: Array.isArray(results) ? results.length : 0 };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle(IPC.DISCOVER_CONTENT_GAPS, async (_event, data: { crawlId: string; domain: string; topics: string[]; country?: string }) => {
  try {
    const apiKey = await keytar.getPassword(KEYTAR_SERVICE, 'bd_api_key');
    if (!apiKey) return { success: false, error: 'Bright Data API key not configured' };
    const pages = getPagesByCrawl(data.crawlId);
    const crawledUrls = pages.map(p => p.url);
    const crawledTitles = pages.map(p => p.title || '');
    const gaps = await discoverContentGaps(data.crawlId, data.domain, data.topics, crawledUrls, crawledTitles, apiKey, data.country);
    return { success: true, gaps, total: Array.isArray(gaps) ? gaps.length : 0 };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle(IPC.DISCOVER_GET_RESULTS, async (_event, data: { crawlId: string; searchType?: string }) => {
  try {
    return getDiscoverResults(data.crawlId, data.searchType);
  } catch (err) {
    return [];
  }
});

ipcMain.handle(IPC.DISCOVER_GET_GAPS, async (_event, crawlId: string) => {
  try {
    return getContentGaps(crawlId);
  } catch (err) {
    return [];
  }
});

// ─── Robots.txt tester ───────────────────────────────────────────────────────

ipcMain.handle(IPC.ROBOTS_TEST, async (_event, req: RobotsTestRequest) => {
  try {
    return runRobotsTest(req);
  } catch (err) {
    return {
      allowed: true,
      matchedRule: `Error: ${(err as Error).message}`,
      ruleType: 'none' as const,
      appliedAgent: '*',
    };
  }
});

// ─── Sitemap: generate ────────────────────────────────────────────────────────

ipcMain.handle(IPC.SITEMAP_GENERATE, async (_event, opts: SitemapGenerateOptions) => {
  try {
    const pages = getPagesByCrawl(opts.crawlId);
    const bundle = buildSitemap(pages, opts);

    // Ask user where to write. Default filename is the index when present,
    // else the single sitemap file.
    const defaultName = bundle.index ? bundle.index.filename : bundle.files[0]?.filename ?? 'sitemap.xml';
    const result = await dialog.showSaveDialog({
      title: 'Save Sitemap',
      defaultPath: defaultName,
      filters: [{ name: 'XML Sitemap', extensions: ['xml'] }],
    });
    if (result.canceled || !result.filePath) {
      return {
        ok: false,
        canceled: true,
        totalUrls: bundle.totalUrls,
        files: bundle.files.map((f) => ({ filename: f.filename, urlCount: f.urlCount })),
      };
    }

    const dir = path.dirname(result.filePath);
    // Always write child sitemap files alongside, using their default names.
    const written: string[] = [];
    for (const f of bundle.files) {
      const target = path.join(dir, f.filename);
      fs.writeFileSync(target, f.xml, 'utf8');
      written.push(target);
    }
    if (bundle.index) {
      // Honour user-supplied filename for the top-level index.
      fs.writeFileSync(result.filePath, bundle.index.xml, 'utf8');
      written.push(result.filePath);
    } else {
      // Single-file: rename if user picked a different filename.
      if (path.basename(result.filePath) !== bundle.files[0].filename) {
        fs.writeFileSync(result.filePath, bundle.files[0].xml, 'utf8');
        written.push(result.filePath);
      }
    }
    return {
      ok: true,
      canceled: false,
      totalUrls: bundle.totalUrls,
      files: bundle.files.map((f) => ({ filename: f.filename, urlCount: f.urlCount })),
      written,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
});

// ─── Sitemap: analyze ─────────────────────────────────────────────────────────

ipcMain.handle(IPC.SITEMAP_ANALYZE, async (_event, payload: { crawlId: string; sitemapUrl: string }) => {
  try {
    const pages = getPagesByCrawl(payload.crawlId);
    return await runSitemapAnalyze(payload.sitemapUrl, pages);
  } catch (err) {
    return {
      sitemapUrl: payload.sitemapUrl,
      fetchedSitemaps: [],
      urlsInSitemap: [],
      notInSitemap: [],
      orphanFromSitemap: [],
      nonIndexableInSitemap: [],
      duplicateInSitemap: [],
      errors: [(err as Error).message],
    };
  }
});

ipcMain.handle(IPC.SITEMAP_FETCH_URLS, async (_event, sitemapUrl: string) => {
  if (!isSafeExternalUrl(sitemapUrl)) return { urls: [], error: 'Blocked: internal URL' };
  try {
    const xml = await new Promise<string>((resolve, reject) => {
      const mod = sitemapUrl.startsWith('https') ? require('https') : require('http');
      mod.get(sitemapUrl, { headers: { 'User-Agent': 'GhostFrog/1.0' } }, (res: import('http').IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      }).on('error', reject);
    });
    const urls: string[] = [];
    const locRe = /<loc>(.*?)<\/loc>/gi;
    let m: RegExpExecArray | null;
    while ((m = locRe.exec(xml)) !== null) urls.push(m[1].trim());
    return { urls };
  } catch (err) {
    return { urls: [], error: String(err) };
  }
});
