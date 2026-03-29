import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import path from 'path';
import keytar from 'keytar';
import { initDatabase, getAllCrawls, getPagesByCrawl, getLinksByCrawl, getImagesByCrawl, getAIAnalysisByPage, upsertAIAnalysis, getConfig, setConfig, getUsageStats, getRedirectsByCrawl, getHreflangByCrawl, getDuplicatesByCrawl, getCustomExtractionsByCrawl } from './database';
import { CrawlOrchestrator } from './crawler-orchestrator';
import { testBrightDataConnection } from './crawler-brightdata';
import { testOllamaConnection, listOllamaModels, analyzeContentQuality, analyzeTechnicalSEO, testAIProviderConnection, AIProviderConfig } from './ai-analyzer';
import { querySerpBatch, storeSerpResults, getSerpResults } from './serp-client';
import { IPC, CrawlConfig, AppSettings, AIProvider } from '../types/index';
import { autoUpdater } from 'electron-updater';
import fs from 'fs';

const KEYTAR_SERVICE = 'ghostfrog';
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
const orchestrator = new CrawlOrchestrator();

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

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── App Lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  initDatabase();
  createWindow();

  // Auto-update (silent check, only in production)
  if (!isDev) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
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
  mainWindow?.webContents.send(IPC.CRAWL_COMPLETE, crawlId);
});

orchestrator.on('cost-limit-warning', (data: { currentSpend: number; limit: number }) => {
  mainWindow?.webContents.send('crawl:cost-limit', data);
});

ipcMain.handle(IPC.CRAWL_START, async (_event, config: CrawlConfig) => {
  try {
    let apiKey: string | null = null;
    let bdZone: string | null = null;

    if (config.engine === 'brightdata') {
      apiKey = await keytar.getPassword(KEYTAR_SERVICE, 'bd_api_key');
      bdZone = await keytar.getPassword(KEYTAR_SERVICE, 'bd_zone');
      if (!apiKey) {
        return { success: false, error: 'Bright Data API key not configured. Go to Settings.' };
      }
    }

    const crawlId = await orchestrator.startCrawl(config, apiKey || undefined, bdZone || undefined);
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

    const incomplete = orchestrator.getIncompleteCrawl();
    if (!incomplete) return { success: false, error: 'No incomplete crawl found' };

    const config: CrawlConfig = JSON.parse(incomplete.configJson);
    if (config.engine === 'brightdata') {
      apiKey = await keytar.getPassword(KEYTAR_SERVICE, 'bd_api_key');
      bdZone = await keytar.getPassword(KEYTAR_SERVICE, 'bd_zone');
    }

    const crawlId = await orchestrator.resumeIncompleteCrawl(apiKey || undefined, bdZone || undefined);
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

    const keys = Object.keys(data.rows[0] || {});
    const header = keys.join(',');
    const rows = data.rows.map(row =>
      keys.map(k => {
        const val = row[k];
        if (val === null || val === undefined) return '';
        const str = String(val);
        // Escape CSV
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(',')
    );

    fs.writeFileSync(filePath, [header, ...rows].join('\n'), 'utf8');
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
  const openaiApiKey = await keytar.getPassword(KEYTAR_SERVICE, 'openai_api_key');
  const anthropicApiKey = await keytar.getPassword(KEYTAR_SERVICE, 'anthropic_api_key');
  const geminiApiKey = await keytar.getPassword(KEYTAR_SERVICE, 'gemini_api_key');

  const settings: AppSettings = {
    brightDataApiKey: apiKey || null,
    brightDataZone: bdZone || 'web_unlocker1',
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

ipcMain.handle(IPC.SETTINGS_TEST_OLLAMA, async (_event, url: string) => {
  const ok = await testOllamaConnection(url);
  const models = ok ? await listOllamaModels(url) : [];
  return { success: ok, models };
});

ipcMain.handle(IPC.SETTINGS_TEST_AI_PROVIDER, async (_event, provider: AIProvider, config: { ollamaUrl?: string; apiKey?: string }) => {
  return testAIProviderConnection(provider, config);
});

// ─── AI IPC Handlers ──────────────────────────────────────────────────────────

ipcMain.handle(IPC.AI_ANALYZE, async (_event, crawlId: string) => {
  try {
    const provider = (getConfig('ai_provider') as AIProvider) || 'ollama';
    let providerConfig: AIProviderConfig;

    switch (provider) {
      case 'openai': {
        const key = await keytar.getPassword(KEYTAR_SERVICE, 'openai_api_key');
        if (!key) return { success: false, error: 'OpenAI API key not configured. Go to Settings.' };
        providerConfig = { provider: 'openai', model: getConfig('openai_model') || 'gpt-4o-mini', apiKey: key };
        break;
      }
      case 'anthropic': {
        const key = await keytar.getPassword(KEYTAR_SERVICE, 'anthropic_api_key');
        if (!key) return { success: false, error: 'Anthropic API key not configured. Go to Settings.' };
        providerConfig = { provider: 'anthropic', model: getConfig('anthropic_model') || 'claude-sonnet-4-20250514', apiKey: key };
        break;
      }
      case 'gemini': {
        const key = await keytar.getPassword(KEYTAR_SERVICE, 'gemini_api_key');
        if (!key) return { success: false, error: 'Gemini API key not configured. Go to Settings.' };
        providerConfig = { provider: 'gemini', model: getConfig('gemini_model') || 'gemini-2.0-flash', apiKey: key };
        break;
      }
      default: {
        providerConfig = {
          provider: 'ollama',
          model: getConfig('ollama_model') || 'llama3',
          ollamaUrl: getConfig('ollama_url') || 'http://localhost:11434',
        };
      }
    }

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

ipcMain.handle(IPC.AI_GET_RESULTS, (_event, pageId: string) => {
  return getAIAnalysisByPage(pageId);
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
