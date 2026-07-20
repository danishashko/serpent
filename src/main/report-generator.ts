import { BrowserWindow, dialog } from 'electron';
import fs from 'fs';
import { PageData, LinkData, ImageData, GEOScore, PerformanceScore, ReportConfig, ReportSection } from '../types/index';

interface ReportData {
  config: ReportConfig;
  pages: PageData[];
  links: LinkData[];
  images: ImageData[];
  geoScores: GEOScore[];
  perfScores: PerformanceScore[];
}

function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function scoreColor(score: number): string {
  if (score >= 80) return '#10b981';
  if (score >= 60) return '#f59e0b';
  if (score >= 40) return '#f97316';
  return '#ef4444';
}

function buildExecutiveSummary(data: ReportData): string {
  const { pages, geoScores, perfScores } = data;
  const totalPages = pages.length;
  const avgGeo = geoScores.length ? Math.round(geoScores.reduce((s, g) => s + g.overallScore, 0) / geoScores.length) : 0;
  const avgPerf = perfScores.length ? Math.round(perfScores.reduce((s, p) => s + p.overallScore, 0) / perfScores.length) : 0;
  // On-page content issues only make sense for pages that returned HTML (2xx).
  // Redirects (3xx) and errors (4xx/5xx) have no body, so excluding them keeps
  // "missing title/description" counts honest.
  const isContentPage = (p: PageData) => (p.statusCode ?? 0) >= 200 && (p.statusCode ?? 0) < 300;
  const errPages = pages.filter(p => p.statusCode && p.statusCode >= 400).length;
  const noIndex = pages.filter(p => !p.isIndexable).length;
  const noTitle = pages.filter(p => isContentPage(p) && (!p.title || !p.title.trim())).length;
  const noMeta = pages.filter(p => isContentPage(p) && (!p.metaDescription || !p.metaDescription.trim())).length;

  return `
    <div class="section">
      <h2>Executive Summary</h2>
      <div class="grid-4">
        <div class="stat-card">
          <div class="stat-value">${totalPages}</div>
          <div class="stat-label">Pages Crawled</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:${scoreColor(avgGeo)}">${avgGeo}/100</div>
          <div class="stat-label">Avg GEO Score</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:${scoreColor(avgPerf)}">${avgPerf}/100</div>
          <div class="stat-label">Avg Performance</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:${errPages > 0 ? '#ef4444' : '#10b981'}">${errPages}</div>
          <div class="stat-label">Error Pages</div>
        </div>
      </div>
      <table>
        <tr><th>Metric</th><th>Value</th><th>Status</th></tr>
        <tr><td>Pages with errors (4xx/5xx)</td><td>${errPages}</td><td>${errPages === 0 ? '✅' : '❌'}</td></tr>
        <tr><td>Non-indexable pages</td><td>${noIndex}</td><td>${noIndex === 0 ? '✅' : '⚠️'}</td></tr>
        <tr><td>Missing titles</td><td>${noTitle}</td><td>${noTitle === 0 ? '✅' : '❌'}</td></tr>
        <tr><td>Missing meta descriptions</td><td>${noMeta}</td><td>${noMeta === 0 ? '✅' : '⚠️'}</td></tr>
      </table>
    </div>`;
}

function buildTechnicalIssues(data: ReportData): string {
  const { pages } = data;
  type Issue = { issue: string; count: number; severity: string; urls: string[] };
  const issues: Issue[] = [];

  const check = (label: string, severity: string, filter: (p: PageData) => boolean) => {
    const affected = pages.filter(filter);
    if (affected.length > 0) {
      issues.push({ issue: label, count: affected.length, severity, urls: affected.slice(0, 5).map(p => p.url) });
    }
  };

  // On-page content checks only apply to pages that returned HTML (2xx).
  // A 3xx redirect or 4xx/5xx error has no <title>/<h1>, so flagging it as
  // "Missing title" is a false positive that inflates the critical count.
  const is2xx = (p: PageData) => (p.statusCode ?? 0) >= 200 && (p.statusCode ?? 0) < 300;

  check('Missing title', 'critical', p => is2xx(p) && (!p.title || !p.title.trim()));
  check('Missing meta description', 'warning', p => is2xx(p) && (!p.metaDescription || !p.metaDescription.trim()));
  check('Missing H1', 'warning', p => is2xx(p) && (!p.h1 || !p.h1.trim()));
  check('Multiple H1 tags', 'warning', p => is2xx(p) && p.h1Count > 1);
  check('4xx errors', 'critical', p => (p.statusCode || 0) >= 400 && (p.statusCode || 0) < 500);
  check('5xx errors', 'critical', p => (p.statusCode || 0) >= 500);
  check('Non-indexable', 'warning', p => !p.isIndexable);
  check('Title too long (>60 chars)', 'info', p => (p.titleLength || 0) > 60);
  check('Meta description too long (>160)', 'info', p => (p.metaDescLength || 0) > 160);
  check('Thin content (<100 words)', 'warning', p => is2xx(p) && (p.wordCount || 0) < 100);

  if (issues.length === 0) return '<div class="section"><h2>Technical Issues</h2><p>No technical issues found. 🎉</p></div>';

  return `
    <div class="section">
      <h2>Technical Issues</h2>
      <table>
        <tr><th>Issue</th><th>Severity</th><th>Count</th><th>Sample URLs</th></tr>
        ${issues.map(i => `
          <tr>
            <td>${escapeHtml(i.issue)}</td>
            <td><span class="badge badge-${i.severity}">${i.severity}</span></td>
            <td>${i.count}</td>
            <td class="url-list">${i.urls.map(u => escapeHtml(u)).join('<br>')}</td>
          </tr>
        `).join('')}
      </table>
    </div>`;
}

function buildGEOReadiness(data: ReportData): string {
  const { geoScores } = data;
  if (geoScores.length === 0) return '<div class="section"><h2>GEO/AEO Readiness</h2><p>No GEO analysis data. Run GEO analysis first.</p></div>';

  const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
  const avgOverall = avg(geoScores.map(g => g.overallScore));
  const avgEntity = avg(geoScores.map(g => g.entityClarity));
  const avgAnswer = avg(geoScores.map(g => g.answerReadiness));
  const avgCitation = avg(geoScores.map(g => g.citationSignals));
  const avgSchema = avg(geoScores.map(g => g.structuredDataCompleteness));

  const worst = [...geoScores].sort((a, b) => a.overallScore - b.overallScore).slice(0, 10);

  return `
    <div class="section">
      <h2>GEO/AEO Readiness</h2>
      <div class="grid-4">
        <div class="stat-card"><div class="stat-value" style="color:${scoreColor(avgEntity)}">${avgEntity}</div><div class="stat-label">Entity Clarity</div></div>
        <div class="stat-card"><div class="stat-value" style="color:${scoreColor(avgAnswer)}">${avgAnswer}</div><div class="stat-label">Answer Readiness</div></div>
        <div class="stat-card"><div class="stat-value" style="color:${scoreColor(avgCitation)}">${avgCitation}</div><div class="stat-label">Citation Signals</div></div>
        <div class="stat-card"><div class="stat-value" style="color:${scoreColor(avgSchema)}">${avgSchema}</div><div class="stat-label">Schema Completeness</div></div>
      </div>
      <p style="text-align:center;font-size:18px;margin:12px 0">Overall GEO Score: <strong style="color:${scoreColor(avgOverall)}">${avgOverall}/100</strong></p>
      <h3>Lowest Scoring Pages</h3>
      <table>
        <tr><th>URL</th><th>Overall</th><th>Entity</th><th>Answer</th><th>Citation</th><th>Schema</th></tr>
        ${worst.map(g => `
          <tr>
            <td class="url-cell">${escapeHtml(g.url)}</td>
            <td style="color:${scoreColor(g.overallScore)}">${g.overallScore}</td>
            <td>${g.entityClarity}</td>
            <td>${g.answerReadiness}</td>
            <td>${g.citationSignals}</td>
            <td>${g.structuredDataCompleteness}</td>
          </tr>
        `).join('')}
      </table>
    </div>`;
}

function buildPerformance(data: ReportData): string {
  const { perfScores } = data;
  if (perfScores.length === 0) return '<div class="section"><h2>Performance</h2><p>No performance data. Run performance analysis first.</p></div>';

  const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
  const avgOverall = avg(perfScores.map(p => p.overallScore));
  const avgTTFB = avg(perfScores.map(p => p.ttfbScore));
  const avgSize = avg(perfScores.map(p => p.pageSizeScore));
  const avgImg = avg(perfScores.map(p => p.imageOptScore));

  const slowest = [...perfScores].sort((a, b) => a.overallScore - b.overallScore).slice(0, 10);

  return `
    <div class="section">
      <h2>Performance Overview</h2>
      <div class="grid-4">
        <div class="stat-card"><div class="stat-value" style="color:${scoreColor(avgTTFB)}">${avgTTFB}</div><div class="stat-label">TTFB Score</div></div>
        <div class="stat-card"><div class="stat-value" style="color:${scoreColor(avgSize)}">${avgSize}</div><div class="stat-label">Page Size Score</div></div>
        <div class="stat-card"><div class="stat-value" style="color:${scoreColor(avgImg)}">${avgImg}</div><div class="stat-label">Image Optimization</div></div>
        <div class="stat-card"><div class="stat-value" style="color:${scoreColor(avgOverall)}">${avgOverall}</div><div class="stat-label">Overall</div></div>
      </div>
      <h3>Slowest Pages</h3>
      <table>
        <tr><th>URL</th><th>Score</th><th>TTFB (ms)</th><th>Size (KB)</th></tr>
        ${slowest.map(p => `
          <tr>
            <td class="url-cell">${escapeHtml(p.url)}</td>
            <td style="color:${scoreColor(p.overallScore)}">${p.overallScore}</td>
            <td>${p.ttfbMs}</td>
            <td>${Math.round(p.totalBytes / 1024)}</td>
          </tr>
        `).join('')}
      </table>
    </div>`;
}

function buildContentQuality(data: ReportData): string {
  const { pages } = data;
  const withContent = pages.filter(p => (p.wordCount || 0) > 0);
  const avgWords = withContent.length ? Math.round(withContent.reduce((s, p) => s + (p.wordCount || 0), 0) / withContent.length) : 0;
  const thin = pages.filter(p => (p.statusCode ?? 0) >= 200 && (p.statusCode ?? 0) < 300 && (p.wordCount || 0) < 100);

  return `
    <div class="section">
      <h2>Content Quality</h2>
      <div class="grid-4">
        <div class="stat-card"><div class="stat-value">${withContent.length}</div><div class="stat-label">Pages with Content</div></div>
        <div class="stat-card"><div class="stat-value">${avgWords}</div><div class="stat-label">Avg Word Count</div></div>
        <div class="stat-card"><div class="stat-value" style="color:${thin.length > 0 ? '#f97316' : '#10b981'}">${thin.length}</div><div class="stat-label">Thin Pages</div></div>
        <div class="stat-card"><div class="stat-value">${pages.filter(p => p.hasStructuredData).length}</div><div class="stat-label">With Schema</div></div>
      </div>
    </div>`;
}

function buildInternalLinks(data: ReportData): string {
  const { links, pages } = data;
  const internal = links.filter(l => l.isInternal);
  const topLinked = [...pages].sort((a, b) => b.linkScore - a.linkScore).slice(0, 10);

  return `
    <div class="section">
      <h2>Internal Links</h2>
      <p>Total internal links: <strong>${internal.length}</strong></p>
      <h3>Top Linked Pages (by Link Score)</h3>
      <table>
        <tr><th>URL</th><th>Link Score</th></tr>
        ${topLinked.map(p => `<tr><td class="url-cell">${escapeHtml(p.url)}</td><td>${p.linkScore.toFixed(1)}</td></tr>`).join('')}
      </table>
    </div>`;
}

function buildStructuredData(data: ReportData): string {
  const { pages } = data;
  const withSchema = pages.filter(p => p.hasStructuredData);
  const typeMap = new Map<string, number>();
  for (const p of withSchema) {
    if (p.schemaTypes) {
      for (const t of p.schemaTypes.split(',')) {
        const trimmed = t.trim();
        if (trimmed) typeMap.set(trimmed, (typeMap.get(trimmed) || 0) + 1);
      }
    }
  }

  return `
    <div class="section">
      <h2>Structured Data</h2>
      <p>${withSchema.length} of ${pages.length} pages have structured data (${pages.length > 0 ? Math.round(withSchema.length / pages.length * 100) : 0}%)</p>
      ${typeMap.size > 0 ? `
      <table>
        <tr><th>Schema Type</th><th>Count</th></tr>
        ${[...typeMap.entries()].sort((a, b) => b[1] - a[1]).map(([t, c]) => `<tr><td>${escapeHtml(t)}</td><td>${c}</td></tr>`).join('')}
      </table>` : ''}
    </div>`;
}

function buildSecurity(data: ReportData): string {
  const { pages } = data;
  const withHSTS = pages.filter(p => p.hasHSTS).length;
  const withCSP = pages.filter(p => p.hasCSP).length;

  return `
    <div class="section">
      <h2>Security Headers</h2>
      <table>
        <tr><th>Header</th><th>Pages</th><th>Coverage</th></tr>
        <tr><td>HSTS</td><td>${withHSTS}/${pages.length}</td><td>${pages.length > 0 ? Math.round(withHSTS / pages.length * 100) : 0}%</td></tr>
        <tr><td>CSP</td><td>${withCSP}/${pages.length}</td><td>${pages.length > 0 ? Math.round(withCSP / pages.length * 100) : 0}%</td></tr>
      </table>
    </div>`;
}

function buildImages(data: ReportData): string {
  const { images } = data;
  const missingAlt = images.filter(i => !i.altText || !i.altText.trim()).length;
  const missingDims = images.filter(i => !i.hasWidth || !i.hasHeight).length;
  const lazyLoaded = images.filter(i => i.isLazy).length;

  return `
    <div class="section">
      <h2>Image Audit</h2>
      <div class="grid-4">
        <div class="stat-card"><div class="stat-value">${images.length}</div><div class="stat-label">Total Images</div></div>
        <div class="stat-card"><div class="stat-value" style="color:${missingAlt > 0 ? '#ef4444' : '#10b981'}">${missingAlt}</div><div class="stat-label">Missing Alt</div></div>
        <div class="stat-card"><div class="stat-value" style="color:${missingDims > 0 ? '#f97316' : '#10b981'}">${missingDims}</div><div class="stat-label">Missing Dimensions</div></div>
        <div class="stat-card"><div class="stat-value">${lazyLoaded}</div><div class="stat-label">Lazy Loaded</div></div>
      </div>
    </div>`;
}

const sectionBuilders: Record<ReportSection, (data: ReportData) => string> = {
  executive_summary: buildExecutiveSummary,
  technical_issues: buildTechnicalIssues,
  content_quality: buildContentQuality,
  performance: buildPerformance,
  geo_readiness: buildGEOReadiness,
  internal_links: buildInternalLinks,
  structured_data: buildStructuredData,
  security: buildSecurity,
  images: buildImages,
};

function buildReportHtml(data: ReportData): string {
  const { config } = data;
  const brandColor = config.brandColor || '#4f46e5';
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const sections = config.sections.map(s => sectionBuilders[s]?.(data) || '').join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(config.title)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1e293b; background: #fff; font-size: 12px; line-height: 1.5; }
  .cover { page-break-after: always; display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100vh; text-align: center; background: linear-gradient(135deg, ${brandColor}11, ${brandColor}05); }
  .cover h1 { font-size: 36px; color: ${brandColor}; margin-bottom: 8px; }
  .cover .subtitle { font-size: 16px; color: #64748b; margin-bottom: 24px; }
  .cover .meta { font-size: 13px; color: #94a3b8; }
  .section { page-break-inside: avoid; margin: 20px 30px; padding: 16px 0; border-bottom: 1px solid #e2e8f0; }
  .section h2 { font-size: 18px; color: ${brandColor}; margin-bottom: 12px; border-bottom: 2px solid ${brandColor}; padding-bottom: 4px; }
  .section h3 { font-size: 14px; color: #475569; margin: 10px 0 6px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 11px; }
  th { background: #f8fafc; text-align: left; padding: 6px 8px; border: 1px solid #e2e8f0; font-weight: 600; }
  td { padding: 5px 8px; border: 1px solid #e2e8f0; }
  tr:nth-child(even) { background: #fafbfc; }
  .url-cell { max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }
  .url-list { font-size: 10px; max-width: 250px; word-break: break-all; }
  .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 10px 0; }
  .stat-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; text-align: center; }
  .stat-value { font-size: 24px; font-weight: 700; }
  .stat-label { font-size: 10px; color: #64748b; margin-top: 2px; }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; }
  .badge-critical { background: #fef2f2; color: #dc2626; }
  .badge-warning { background: #fffbeb; color: #d97706; }
  .badge-info { background: #eff6ff; color: #2563eb; }
  .footer { text-align: center; color: #94a3b8; font-size: 10px; padding: 16px; }
</style>
</head>
<body>
  <div class="cover">
    <h1>${escapeHtml(config.title)}</h1>
    <div class="subtitle">${escapeHtml(config.companyName)}</div>
    <div class="meta">
      ${config.analystName ? `Prepared by ${escapeHtml(config.analystName)}<br>` : ''}
      ${date}
    </div>
  </div>
  ${sections}
  <div class="footer">Generated by Serpent SEO Spider · ${date}</div>
</body>
</html>`;
}

export async function generatePdfReport(data: ReportData): Promise<{ success: boolean; filePath?: string; error?: string }> {
  const html = buildReportHtml(data);

  const { filePath } = await dialog.showSaveDialog({
    defaultPath: `${data.config.title.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });

  if (!filePath) return { success: false, error: 'Cancelled' };

  const win = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    // Wait for rendering to complete
    await win.webContents.executeJavaScript(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
    );

    const pdfBuffer = await win.webContents.printToPDF({
      printBackground: true,
      margins: { top: 0.4, bottom: 0.4, left: 0.3, right: 0.3 },
    });

    fs.writeFileSync(filePath, pdfBuffer);
    return { success: true, filePath };
  } catch (err) {
    return { success: false, error: String(err) };
  } finally {
    win.destroy();
  }
}
