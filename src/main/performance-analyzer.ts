import { PageData, ImageData, PerformanceScore, PerformanceIssue, IssueSeverity } from '../types/index';

interface PerfInput {
  page: PageData;
  images: ImageData[];
}

function addIssue(issues: PerformanceIssue[], category: PerformanceIssue['category'], severity: IssueSeverity, message: string, recommendation: string): void {
  issues.push({ category, severity, message, recommendation });
}

function scoreTTFB(page: PageData): { score: number; issues: PerformanceIssue[] } {
  const issues: PerformanceIssue[] = [];
  const ttfb = page.responseTimeMs;

  if (ttfb === null || ttfb === undefined) {
    return { score: 50, issues: [{ category: 'ttfb', severity: 'info', message: 'No TTFB data available', recommendation: 'Re-crawl to capture response time data' }] };
  }

  if (ttfb <= 200) return { score: 100, issues };
  if (ttfb <= 500) return { score: 90, issues };
  if (ttfb <= 800) {
    addIssue(issues, 'ttfb', 'info', `TTFB is ${ttfb}ms (moderate)`, 'Consider server-side caching or CDN to reduce TTFB below 500ms');
    return { score: 75, issues };
  }
  if (ttfb <= 1500) {
    addIssue(issues, 'ttfb', 'warning', `TTFB is ${ttfb}ms (slow)`, 'Investigate server performance — consider caching, database optimization, or upgrading hosting');
    return { score: 50, issues };
  }
  if (ttfb <= 3000) {
    addIssue(issues, 'ttfb', 'critical', `TTFB is ${ttfb}ms (very slow)`, 'Server response is critically slow. Check server resources, database queries, and consider a CDN');
    return { score: 25, issues };
  }

  addIssue(issues, 'ttfb', 'critical', `TTFB is ${ttfb}ms (extremely slow)`, 'Server response exceeds 3s. Immediate investigation needed — likely server overload or misconfiguration');
  return { score: 10, issues };
}

function scorePageSize(page: PageData): { score: number; issues: PerformanceIssue[] } {
  const issues: PerformanceIssue[] = [];
  const bytes = page.pageSizeBytes;

  if (bytes === null || bytes === undefined) {
    return { score: 50, issues: [{ category: 'size', severity: 'info', message: 'No page size data available', recommendation: 'Re-crawl to capture page size data' }] };
  }

  const kb = bytes / 1024;
  const mb = kb / 1024;

  if (kb <= 100) return { score: 100, issues };
  if (kb <= 300) return { score: 90, issues };
  if (kb <= 500) {
    addIssue(issues, 'size', 'info', `Page size is ${kb.toFixed(0)}KB`, 'Consider minifying HTML/CSS/JS to reduce page weight');
    return { score: 80, issues };
  }
  if (kb <= 1000) {
    addIssue(issues, 'size', 'warning', `Page size is ${kb.toFixed(0)}KB`, 'Reduce page size below 500KB — minify resources, defer non-critical JS');
    return { score: 60, issues };
  }
  if (mb <= 2) {
    addIssue(issues, 'size', 'warning', `Page size is ${mb.toFixed(1)}MB`, 'Page exceeds 1MB — remove unused CSS/JS, compress resources, lazy-load images');
    return { score: 40, issues };
  }
  if (mb <= 5) {
    addIssue(issues, 'size', 'critical', `Page size is ${mb.toFixed(1)}MB`, 'Page is very large (>2MB). Aggressive optimization needed');
    return { score: 20, issues };
  }

  addIssue(issues, 'size', 'critical', `Page size is ${mb.toFixed(1)}MB (extremely large)`, 'Page exceeds 5MB — this severely impacts load time. Major restructuring needed');
  return { score: 5, issues };
}

function scoreImageOptimization(input: PerfInput): { score: number; issues: PerformanceIssue[]; imageBytes: number } {
  const { images } = input;
  const issues: PerformanceIssue[] = [];

  if (images.length === 0) {
    return { score: 100, issues: [], imageBytes: 0 };
  }

  let points = 0;
  const max = 100;

  // Check alt text coverage (25 pts)
  const withAlt = images.filter(i => i.altText && i.altText.trim().length > 0).length;
  const altRatio = withAlt / images.length;
  if (altRatio >= 0.95) {
    points += 25;
  } else if (altRatio >= 0.7) {
    points += 15;
    addIssue(issues, 'images', 'warning', `${Math.round((1 - altRatio) * 100)}% of images missing alt text`, 'Add descriptive alt text to all images for accessibility and SEO');
  } else {
    points += 5;
    addIssue(issues, 'images', 'critical', `${Math.round((1 - altRatio) * 100)}% of images missing alt text`, 'Most images lack alt text — critical for accessibility and SEO');
  }

  // Check dimension attributes (25 pts)
  const withDimensions = images.filter(i => i.hasWidth && i.hasHeight).length;
  const dimRatio = withDimensions / images.length;
  if (dimRatio >= 0.9) {
    points += 25;
  } else if (dimRatio >= 0.5) {
    points += 12;
    addIssue(issues, 'images', 'warning', `${Math.round((1 - dimRatio) * 100)}% of images missing width/height`, 'Add explicit width and height attributes to prevent layout shifts (CLS)');
  } else {
    addIssue(issues, 'images', 'critical', 'Most images missing width/height attributes', 'Set width and height on all images to prevent layout shifts');
  }

  // Check lazy loading (25 pts)
  const withLazy = images.filter(i => i.isLazy).length;
  const lazyRatio = images.length > 3 ? withLazy / images.length : 1; // Skip for pages with few images
  if (lazyRatio >= 0.7) {
    points += 25;
  } else if (lazyRatio >= 0.3) {
    points += 12;
    addIssue(issues, 'images', 'info', `Only ${Math.round(lazyRatio * 100)}% of images use lazy loading`, 'Add loading="lazy" to below-fold images');
  } else if (images.length > 3) {
    addIssue(issues, 'images', 'warning', 'Few images use lazy loading', 'Implement lazy loading for non-critical images');
  }

  // Check modern formats (25 pts)
  const modernFormats = images.filter(i => {
    const fmt = (i.format || '').toLowerCase();
    return fmt.includes('webp') || fmt.includes('avif') || fmt.includes('svg');
  }).length;
  const modernRatio = modernFormats / images.length;
  if (modernRatio >= 0.7) {
    points += 25;
  } else if (modernRatio >= 0.3) {
    points += 12;
    addIssue(issues, 'images', 'info', `Only ${Math.round(modernRatio * 100)}% using modern image formats`, 'Convert images to WebP or AVIF for smaller file sizes');
  } else {
    addIssue(issues, 'images', 'opportunity', 'Most images use legacy formats (JPEG/PNG)', 'Convert to WebP/AVIF to reduce image payload by 25-50%');
  }

  // Estimate image bytes (rough: 50KB per image without modern formats, 30KB with)
  const estimatedImageBytes = images.length * (modernRatio > 0.5 ? 30 * 1024 : 50 * 1024);

  return { score: Math.min(max, points), issues, imageBytes: estimatedImageBytes };
}

function scoreContentEfficiency(page: PageData): { score: number; issues: PerformanceIssue[] } {
  const issues: PerformanceIssue[] = [];
  const textRatio = page.textRatio;
  const wordCount = page.wordCount || 0;
  const pageSize = page.pageSizeBytes || 0;

  if (textRatio === null || textRatio === undefined) {
    return { score: 50, issues: [] };
  }

  // Content efficiency = text content vs total page weight
  let points = 0;

  // Text ratio (50 pts)
  if (textRatio >= 0.25) {
    points += 50;
  } else if (textRatio >= 0.15) {
    points += 35;
  } else if (textRatio >= 0.05) {
    points += 20;
    addIssue(issues, 'content', 'info', `Low text ratio (${(textRatio * 100).toFixed(1)}%)`, 'Page has excessive markup/scripts relative to content. Streamline HTML');
  } else {
    points += 5;
    addIssue(issues, 'content', 'warning', `Very low text ratio (${(textRatio * 100).toFixed(1)}%)`, 'Page is mostly non-content markup. Remove unnecessary JS/CSS');
  }

  // Words per KB of page size (50 pts)
  if (pageSize > 0 && wordCount > 0) {
    const wordsPerKB = wordCount / (pageSize / 1024);
    if (wordsPerKB >= 5) {
      points += 50;
    } else if (wordsPerKB >= 2) {
      points += 30;
    } else if (wordsPerKB >= 0.5) {
      points += 15;
      addIssue(issues, 'content', 'info', `Low content density: ${wordsPerKB.toFixed(1)} words/KB`, 'Content is sparse relative to page weight');
    } else {
      addIssue(issues, 'content', 'warning', `Very low content density: ${wordsPerKB.toFixed(1)} words/KB`, 'Most of the page payload is not useful content');
    }
  } else {
    points += 25; // Unknown, give middle score
  }

  return { score: Math.min(100, points), issues };
}

export function analyzePerformanceScore(input: PerfInput): PerformanceScore {
  const ttfb = scoreTTFB(input.page);
  const size = scorePageSize(input.page);
  const imgOpt = scoreImageOptimization(input);
  const efficiency = scoreContentEfficiency(input.page);

  const overallScore = Math.round(
    ttfb.score * 0.30 + size.score * 0.25 + imgOpt.score * 0.25 + efficiency.score * 0.20
  );

  const allIssues = [...ttfb.issues, ...size.issues, ...imgOpt.issues, ...efficiency.issues];

  return {
    pageId: input.page.id,
    crawlId: input.page.crawlId,
    url: input.page.url,
    overallScore,
    ttfbScore: Math.round(ttfb.score),
    pageSizeScore: Math.round(size.score),
    imageOptScore: Math.round(imgOpt.score),
    contentEfficiency: Math.round(efficiency.score),
    ttfbMs: input.page.responseTimeMs || 0,
    totalBytes: input.page.pageSizeBytes || 0,
    imageBytes: imgOpt.imageBytes,
    issues: allIssues,
    analyzedAt: new Date().toISOString(),
  };
}

export function analyzePerformanceBatch(pages: PageData[], images: ImageData[]): PerformanceScore[] {
  const imagesByPage = new Map<string, ImageData[]>();
  for (const img of images) {
    const existing = imagesByPage.get(img.pageUrl) || [];
    existing.push(img);
    imagesByPage.set(img.pageUrl, existing);
  }

  return pages.map(page => analyzePerformanceScore({
    page,
    images: imagesByPage.get(page.url) || [],
  }));
}
