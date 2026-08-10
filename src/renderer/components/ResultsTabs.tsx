import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { PageData, LinkData, ImageData, SerpResultRow, RedirectData, HreflangData, CustomExtractionResult, IssueSeverity, IssueRecommendation, CrawlDiff, CrawlRecord, GEOScore, PerformanceScore, ReportConfig, DiscoverResult, ContentGap, PsiScore, UncrawlableReason, UNCRAWLABLE_REASON_LABELS } from '../../types/index';
import CrawlComparison from './CrawlComparison';
import SiteMap from './SiteMap';
import ExportModal from './ExportModal';
import IssuesTab from './IssuesTab';
import SitemapPanel from './SitemapPanel';
import SemanticPanel from './SemanticPanel';

interface Props {
  pages: PageData[];
  links: LinkData[];
  images: ImageData[];
  serpResults: SerpResultRow[];
  redirects: RedirectData[];
  hreflang: HreflangData[];
  duplicates: { contentHash: string; urls: string[] }[];
  customExtracts: CustomExtractionResult[];
  geoScores: GEOScore[];
  perfScores: PerformanceScore[];
  crawlId: string | null;
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
  onSerpQuery?: (keywords: string[], location?: string, device?: 'desktop' | 'mobile') => void;
  serpLoading?: boolean;
  onGeoScoresUpdate?: (scores: GEOScore[]) => void;
  onPerfScoresUpdate?: (scores: PerformanceScore[]) => void;
  discoverResults: DiscoverResult[];
  contentGaps: ContentGap[];
  onDiscoverResultsUpdate?: (results: DiscoverResult[]) => void;
  onContentGapsUpdate?: (gaps: ContentGap[]) => void;
}

type Tab = 'pages' | 'links' | 'images' | 'issues_v2' | 'issues' | 'sitemap' | 'semantic' | 'redirects' | 'hreflang' | 'duplicates' | 'extractions' | 'serp' | 'map' | 'geo' | 'perf' | 'competitors' | 'content_gaps';
type IssueFilter =
  | 'all'
  | 'missing_title'
  | 'duplicate_title'
  | 'long_title'
  | 'short_title'
  | 'missing_meta'
  | 'duplicate_meta'
  | 'long_meta'
  | 'short_meta'
  | 'missing_h1'
  | 'duplicate_h1'
  | 'multiple_h1'
  | 'h1_over_70'
  | 'missing_h2'
  | 'multiple_h2'
  | 'h2_over_70'
  | 'same_title_h1'
  | 'broken'
  | 'redirect'
  | 'noindex'
  | 'canonicalized'
  | 'missing_canonical'
  | 'thin_content'
  | 'high_crawl_depth'
  | 'url_over_115'
  | 'url_uppercase'
  | 'url_parameters'
  | 'url_underscores'
  | 'url_non_ascii'
  | 'url_multiple_slashes'
  | 'url_repetitive_path'
  | 'no_internal_outlinks'
  | 'missing_og'
  | 'missing_twitter_card'
  | 'missing_schema'
  | 'missing_hsts'
  | 'missing_csp'
  | 'missing_x_frame'
  | 'missing_x_content_type';

const titleWidthColor = (px: number): string => {
  if (px < 200) return 'var(--text-muted)';
  if (px <= 580) return 'var(--accent-green)';
  return 'var(--accent-red)';
};

const metaWidthColor = (px: number): string => {
  if (px < 100) return 'var(--text-muted)';
  if (px <= 990) return 'var(--accent-green)';
  return 'var(--accent-red)';
};

const titleLengthColor = (len: number): string => {
  if (!len) return 'var(--text-muted)';
  if (len >= 30 && len <= 60) return 'var(--accent-green)';
  return 'var(--accent-red)';
};

const metaLengthColor = (len: number): string => {
  if (!len) return 'var(--text-muted)';
  if (len >= 70 && len <= 155) return 'var(--accent-green)';
  return 'var(--accent-red)';
};

const statusColor = (code: number): string => {
  if (code === 200) return 'var(--accent-green)';
  if (code >= 300 && code < 400) return 'var(--accent-orange)';
  if (code >= 400) return 'var(--accent-red)';
  return 'var(--text-muted)';
};

const headingLengthColor = (len: number | null): string => {
  if (!len) return 'var(--text-muted)';
  if (len <= 70) return 'var(--accent-green)';
  return 'var(--accent-red)';
};

const issueSeverity = (filter: IssueFilter): IssueSeverity => {
  switch (filter) {
    case 'broken':
    case 'noindex':
    case 'missing_title':
      return 'critical';
    case 'duplicate_title':
    case 'duplicate_meta':
    case 'missing_meta':
    case 'missing_h1':
    case 'multiple_h1':
    case 'canonicalized':
    case 'thin_content':
    case 'missing_canonical':
    case 'missing_og':
    case 'missing_twitter_card':
    case 'missing_schema':
      return 'warning';
    case 'long_title':
    case 'short_title':
    case 'long_meta':
    case 'short_meta':
    case 'h1_over_70':
    case 'h2_over_70':
    case 'same_title_h1':
    case 'high_crawl_depth':
    case 'missing_h2':
    case 'multiple_h2':
    case 'duplicate_h1':
    case 'redirect':
    case 'missing_hsts':
    case 'missing_csp':
    case 'missing_x_frame':
    case 'missing_x_content_type':
      return 'info';
    case 'url_over_115':
    case 'url_uppercase':
    case 'url_parameters':
    case 'url_underscores':
    case 'url_non_ascii':
    case 'url_multiple_slashes':
    case 'url_repetitive_path':
    case 'no_internal_outlinks':
      return 'opportunity';
    default:
      return 'info';
  }
};

const severityColor = (severity: IssueSeverity): string => {
  switch (severity) {
    case 'critical': return 'var(--accent-red)';
    case 'warning': return 'var(--accent-orange)';
    case 'info': return 'var(--accent-blue)';
    case 'opportunity': return 'var(--accent-green)';
  }
};

// Max rows we'll render in any single table. Beyond this the DOM (22 cols × N rows)
// becomes too heavy and the UI stops responding. Users can search/filter to narrow
// the set, or export to CSV for the full data.
const MAX_RENDER_ROWS = 1000;

export default function ResultsTabs({ pages, links, images, serpResults, redirects, hreflang, duplicates, customExtracts, geoScores, perfScores, crawlId, showToast, onSerpQuery, serpLoading, onGeoScoresUpdate, onPerfScoresUpdate, discoverResults, contentGaps, onDiscoverResultsUpdate, onContentGapsUpdate }: Props): React.ReactElement {
  const [tab, setTab] = useState<Tab>('pages');
  const stripRef = useRef<HTMLDivElement>(null);
  const [tabFade, setTabFade] = useState({ l: false, r: false });
  const [issueFilter, setIssueFilter] = useState<IssueFilter>('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<string>('url');
  const [sortAsc, setSortAsc] = useState(true);
  const [serpKeywords, setSerpKeywords] = useState('');
  const [serpLocation, setSerpLocation] = useState('United States');
  const [serpDevice, setSerpDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [issueRecs, setIssueRecs] = useState<Record<string, IssueRecommendation>>({});
  const [recLoading, setRecLoading] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [comparisonDiffs, setComparisonDiffs] = useState<CrawlDiff[]>([]);
  const [compareCrawls, setCompareCrawls] = useState<CrawlRecord[]>([]);
  const [showCrawlPicker, setShowCrawlPicker] = useState(false);
  const [geoAnalyzing, setGeoAnalyzing] = useState(false);
  const [perfAnalyzing, setPerfAnalyzing] = useState(false);
  // PageSpeed Insights / CWV
  const [psiScores, setPsiScores] = useState<PsiScore[]>([]);
  const [psiAnalyzing, setPsiAnalyzing] = useState(false);
  const [psiStrategy, setPsiStrategy] = useState<'mobile' | 'desktop'>('mobile');
  const [psiProgress, setPsiProgress] = useState<{ done: number; total: number; url: string } | null>(null);

  useEffect(() => {
    if (!crawlId) { setPsiScores([]); return; }
    window.api.psiGetScores(crawlId).then(setPsiScores).catch(() => setPsiScores([]));
  }, [crawlId]);

  useEffect(() => {
    window.api.onPsiProgress?.(data => setPsiProgress(data));
    return () => window.api.removeAllListeners('psi:progress');
  }, []);

  // Track which sides of the tab strip still have tabs off-screen.
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const update = () => setTabFade({
      l: el.scrollLeft > 1,
      r: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    });
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', update); ro.disconnect(); };
  }, []);
  const [reportGenerating, setReportGenerating] = useState(false);
  const reportTitle = 'SEO Audit Report';
  const reportCompany = '';
  const [showExportModal, setShowExportModal] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; url: string } | null>(null);
  // Discover — Competitor Discovery
  const [competitorDomain, setCompetitorDomain] = useState('');
  const [competitorKeywords, setCompetitorKeywords] = useState('');
  const [competitorCountry, setCompetitorCountry] = useState('US');
  const [competitorAnalyzing, setCompetitorAnalyzing] = useState(false);
  // Discover — Content Gap
  const [gapDomain, setGapDomain] = useState('');
  const [gapTopics, setGapTopics] = useState('');
  const [gapCountry, setGapCountry] = useState('US');
  const [gapAnalyzing, setGapAnalyzing] = useState(false);

  // Load cached AI issue recommendations when crawlId changes
  useEffect(() => {
    if (!crawlId) { setIssueRecs({}); return; }
    window.api.aiGetIssueRecs(crawlId).then((recs: IssueRecommendation[]) => {
      const m: Record<string, IssueRecommendation> = {};
      for (const r of recs) m[r.issueType] = r;
      setIssueRecs(m);
    }).catch(() => {});
  }, [crawlId]);

  const handleSort = (key: string) => {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(true); }
  };

  const titleCounts = useMemo(() => {
    const m: Record<string, number> = {};
    pages.forEach(p => { if (p.title) m[p.title] = (m[p.title] ?? 0) + 1; });
    return m;
  }, [pages]);

  const metaCounts = useMemo(() => {
    const m: Record<string, number> = {};
    pages.forEach(p => { if (p.metaDescription) m[p.metaDescription] = (m[p.metaDescription] ?? 0) + 1; });
    return m;
  }, [pages]);

  const h1Counts = useMemo(() => {
    const m: Record<string, number> = {};
    pages.forEach(p => { if (p.h1) m[p.h1] = (m[p.h1] ?? 0) + 1; });
    return m;
  }, [pages]);

  const outlinkMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of links) {
      m.set(l.sourceUrl, (m.get(l.sourceUrl) ?? 0) + 1);
    }
    return m;
  }, [links]);

  // O(1) lookups — replaces per-row geoScores.find()/perfScores.find() in the pages table
  // (those were O(n²) and made the table unscrollable past a few thousand pages).
  const geoScoreMap = useMemo(() => {
    const m = new Map<string, GEOScore>();
    for (const g of geoScores) m.set(g.pageId, g);
    return m;
  }, [geoScores]);

  const perfScoreMap = useMemo(() => {
    const m = new Map<string, PerformanceScore>();
    for (const p of perfScores) m.set(p.pageId, p);
    return m;
  }, [perfScores]);

  const filteredPages = useMemo(() => {
    let list = [...pages];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p => p.url.toLowerCase().includes(q) || (p.title ?? '').toLowerCase().includes(q));
    }
    if (issueFilter !== 'all' && tab === 'issues') {
      list = list.filter(p => {
        switch (issueFilter) {
          case 'missing_title': return !p.title;
          case 'duplicate_title': return !!p.title && (titleCounts[p.title] ?? 0) > 1;
          case 'long_title': return (p.titleLength ?? 0) > 60;
          case 'short_title': return !!p.title && (p.titleLength ?? 0) < 30;
          case 'missing_meta': return !p.metaDescription;
          case 'duplicate_meta': return !!p.metaDescription && (metaCounts[p.metaDescription] ?? 0) > 1;
          case 'long_meta': return (p.metaDescLength ?? 0) > 155;
          case 'short_meta': return !!p.metaDescription && (p.metaDescLength ?? 0) < 70;
          case 'missing_h1': return !p.h1;
          case 'duplicate_h1': return !!p.h1 && (h1Counts[p.h1] ?? 0) > 1;
          case 'multiple_h1': return (p.h1Count ?? 0) > 1;
          case 'h1_over_70': return (p.h1Length ?? 0) > 70;
          case 'missing_h2': return !p.h2;
          case 'multiple_h2': return (p.h2Count ?? 0) > 1;
          case 'h2_over_70': return (p.h2Length ?? 0) > 70;
          case 'same_title_h1': return !!p.title && !!p.h1 && p.title.trim() === p.h1.trim();
          case 'broken': return (p.statusCode ?? 0) >= 400;
          case 'redirect': return (p.statusCode ?? 0) >= 300 && (p.statusCode ?? 0) < 400;
          case 'noindex': return !p.isIndexable;
          case 'canonicalized': return p.isCanonicalized;
          case 'missing_canonical': return !p.canonicalUrl && p.isIndexable;
          case 'thin_content': return (p.wordCount ?? 0) < 200;
          case 'high_crawl_depth': return p.crawlDepth > 3;
          case 'url_over_115': return p.url.length > 115;
          case 'url_uppercase': return /[A-Z]/.test(p.url.replace(/^https?:\/\/[^/]+/i, ''));
          case 'url_parameters': return p.url.includes('?');
          case 'url_underscores': return /_/.test(p.url.replace(/^https?:\/\/[^/]+/i, ''));
          case 'url_non_ascii': return /[^\x00-\x7F]/.test(p.url);
          case 'url_multiple_slashes': return /\/\//.test(p.url.replace(/^https?:\/\//, ''));
          case 'url_repetitive_path': return /(\/.+?)\1/.test(new URL(p.url).pathname);
          case 'no_internal_outlinks': return (outlinkMap.get(p.url) ?? 0) === 0 && (p.statusCode ?? 0) >= 200 && (p.statusCode ?? 0) < 300;
          case 'missing_og': return !p.ogTitle && !p.ogDescription && !p.ogImage;
          case 'missing_twitter_card': return !p.twitterCard;
          case 'missing_schema': return !p.hasStructuredData;
          case 'missing_hsts': return !p.hasHSTS;
          case 'missing_csp': return !p.hasCSP;
          case 'missing_x_frame': return !p.xFrameOptions;
          case 'missing_x_content_type': return !p.xContentTypeOptions;
          default: return true;
        }
      });
    }
    list.sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortKey] ?? '';
      const bv = (b as unknown as Record<string, unknown>)[sortKey] ?? '';
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [pages, search, issueFilter, tab, titleCounts, metaCounts, h1Counts, outlinkMap, sortKey, sortAsc]);

  const handleGetRec = useCallback(async () => {
    if (!crawlId || issueFilter === 'all' || recLoading) return;
    setRecLoading(true);
    try {
      const affectedPages = filteredPages.slice(0, 50).map(p => ({
        url: p.url,
        title: p.title,
        statusCode: p.statusCode,
      }));
      const result = await window.api.aiAnalyzeIssues({
        crawlId,
        issueType: issueFilter,
        severity: issueSeverity(issueFilter),
        affectedPages,
      });
      if (result.success && result.recommendation) {
        const rec = result.recommendation;
        setIssueRecs(prev => ({ ...prev, [issueFilter]: rec }));
        showToast('AI recommendation generated', 'success');
      } else {
        showToast(result.error || 'AI analysis failed', 'error');
      }
    } catch (err) {
      showToast(String(err), 'error');
    } finally {
      setRecLoading(false);
    }
  }, [crawlId, issueFilter, filteredPages, recLoading, showToast]);

  // Build inlinks map: targetUrl → array of source LinkData
  const inlinkMap = useMemo(() => {
    const m = new Map<string, LinkData[]>();
    for (const l of links) {
      const target = l.targetUrl;
      const arr = m.get(target);
      if (arr) arr.push(l);
      else m.set(target, [l]);
    }
    return m;
  }, [links]);

  const [expandedInlinks, setExpandedInlinks] = useState<string | null>(null);
  const toggleInlinks = useCallback((url: string) => {
    setExpandedInlinks(prev => prev === url ? null : url);
  }, []);

  const issueCounts: Record<IssueFilter, number> = useMemo(() => ({
    all: pages.length,
    missing_title: pages.filter(p => !p.title).length,
    duplicate_title: pages.filter(p => !!p.title && (titleCounts[p.title] ?? 0) > 1).length,
    long_title: pages.filter(p => (p.titleLength ?? 0) > 60).length,
    short_title: pages.filter(p => !!p.title && (p.titleLength ?? 0) < 30).length,
    missing_meta: pages.filter(p => !p.metaDescription).length,
    duplicate_meta: pages.filter(p => !!p.metaDescription && (metaCounts[p.metaDescription] ?? 0) > 1).length,
    long_meta: pages.filter(p => (p.metaDescLength ?? 0) > 155).length,
    short_meta: pages.filter(p => !!p.metaDescription && (p.metaDescLength ?? 0) < 70).length,
    missing_h1: pages.filter(p => !p.h1).length,
    duplicate_h1: pages.filter(p => !!p.h1 && (h1Counts[p.h1] ?? 0) > 1).length,
    multiple_h1: pages.filter(p => (p.h1Count ?? 0) > 1).length,
    h1_over_70: pages.filter(p => (p.h1Length ?? 0) > 70).length,
    missing_h2: pages.filter(p => !p.h2).length,
    multiple_h2: pages.filter(p => (p.h2Count ?? 0) > 1).length,
    h2_over_70: pages.filter(p => (p.h2Length ?? 0) > 70).length,
    same_title_h1: pages.filter(p => !!p.title && !!p.h1 && p.title.trim() === p.h1.trim()).length,
    broken: pages.filter(p => (p.statusCode ?? 0) >= 400).length,
    redirect: pages.filter(p => (p.statusCode ?? 0) >= 300 && (p.statusCode ?? 0) < 400).length,
    noindex: pages.filter(p => !p.isIndexable).length,
    canonicalized: pages.filter(p => p.isCanonicalized).length,
    missing_canonical: pages.filter(p => !p.canonicalUrl && p.isIndexable).length,
    thin_content: pages.filter(p => (p.wordCount ?? 0) < 200).length,
    high_crawl_depth: pages.filter(p => p.crawlDepth > 3).length,
    url_over_115: pages.filter(p => p.url.length > 115).length,
    url_uppercase: pages.filter(p => /[A-Z]/.test(p.url.replace(/^https?:\/\/[^/]+/i, ''))).length,
    url_parameters: pages.filter(p => p.url.includes('?')).length,
    url_underscores: pages.filter(p => /_/.test(p.url.replace(/^https?:\/\/[^/]+/i, ''))).length,
    url_non_ascii: pages.filter(p => /[^\x00-\x7F]/.test(p.url)).length,
    url_multiple_slashes: pages.filter(p => /\/\//.test(p.url.replace(/^https?:\/\//, ''))).length,
    url_repetitive_path: pages.filter(p => { try { return /(\/.+?)\1/.test(new URL(p.url).pathname); } catch { return false; } }).length,
    no_internal_outlinks: pages.filter(p => (outlinkMap.get(p.url) ?? 0) === 0 && (p.statusCode ?? 0) >= 200 && (p.statusCode ?? 0) < 300).length,
    missing_og: pages.filter(p => !p.ogTitle && !p.ogDescription && !p.ogImage).length,
    missing_twitter_card: pages.filter(p => !p.twitterCard).length,
    missing_schema: pages.filter(p => !p.hasStructuredData).length,
    missing_hsts: pages.filter(p => !p.hasHSTS).length,
    missing_csp: pages.filter(p => !p.hasCSP).length,
    missing_x_frame: pages.filter(p => !p.xFrameOptions).length,
    missing_x_content_type: pages.filter(p => !p.xContentTypeOptions).length,
  }), [pages, titleCounts, metaCounts, h1Counts, outlinkMap]);

  const totalIssueCount = useMemo(() => {
    return Object.entries(issueCounts).reduce((s, [k, v]) => k === 'all' ? s : s + v, 0);
  }, [issueCounts]);

  const exportCsv = async () => {
    if (!crawlId) return;
    const { rows, filename } = getExportData('csv');
    if (rows.length === 0) { showToast('No data to export', 'warning'); return; }
    const result = await window.api.exportCsv({ rows, filename });
    if (result.success) showToast('CSV exported!', 'success');
    else showToast('CSV export cancelled', 'info');
  };

  const exportJson = async () => {
    if (!crawlId) return;
    const { rows, filename } = getExportData('json');
    if (rows.length === 0) { showToast('No data to export', 'warning'); return; }
    const result = await window.api.exportJson({ rows, filename });
    if (result.success) showToast('JSON exported!', 'success');
    else showToast('JSON export cancelled', 'info');
  };

  const getExportData = (ext: string): { rows: Record<string, unknown>[]; filename: string } => {
    const prefix = `serpent-${crawlId}`;
    if (tab === 'pages' || tab === 'issues') {
      return {
        rows: filteredPages.map(p => ({
          url: p.url, status_code: p.statusCode ?? '', content_type: p.contentType ?? '',
          title: p.title ?? '', title_length: p.titleLength ?? '', title_len_px: p.titlePixelWidth ?? '',
          meta_description: p.metaDescription ?? '', meta_length: p.metaDescLength ?? '',
          meta_len_px: p.metaDescPixelWidth ?? '', h1: p.h1 ?? '', h1_length: p.h1Length ?? '',
          h1_count: p.h1Count ?? '', h2: p.h2 ?? '', h2_length: p.h2Length ?? '', h2_count: p.h2Count ?? '',
          word_count: p.wordCount ?? '', page_size_bytes: p.pageSizeBytes ?? '',
          crawl_depth: p.crawlDepth, canonical: p.canonicalUrl ?? '',
          indexable: p.isIndexable ? 'true' : 'false', response_ms: p.responseTimeMs ?? '',
          inlinks: (inlinkMap.get(p.url) ?? []).length, outlinks: outlinkMap.get(p.url) ?? 0,
          robots_directives: p.robotsDirectives ?? '', meta_keywords: p.metaKeywords ?? '',
          text_ratio: p.textRatio ?? '',
          og_title: p.ogTitle ?? '', og_description: p.ogDescription ?? '',
          og_image: p.ogImage ?? '', og_type: p.ogType ?? '',
          twitter_card: p.twitterCard ?? '', twitter_title: p.twitterTitle ?? '',
          twitter_description: p.twitterDescription ?? '', twitter_image: p.twitterImage ?? '',
          schema_types: p.schemaTypes ?? '', has_structured_data: p.hasStructuredData ? 'true' : 'false',
          has_hsts: p.hasHSTS ? 'true' : 'false', has_csp: p.hasCSP ? 'true' : 'false',
          x_frame_options: p.xFrameOptions ?? '', x_content_type_options: p.xContentTypeOptions ?? '',
          image_count: p.imageCount ?? '', link_score: p.linkScore ?? '', content_hash: p.contentHash ?? '',
        })),
        filename: `${prefix}-pages.${ext}`,
      };
    }
    if (tab === 'links') {
      const filtered = links.filter(l => !search || l.sourceUrl.toLowerCase().includes(search.toLowerCase()) || l.targetUrl.toLowerCase().includes(search.toLowerCase()));
      return {
        rows: filtered.map(l => ({
          source_url: l.sourceUrl, target_url: l.targetUrl, anchor_text: l.anchorText ?? '',
          type: l.isInternal ? 'internal' : 'external', rel: l.relAttr ?? '',
          crawlability: l.crawlability ?? 'crawlable', uncrawlable_reason: l.uncrawlableReason ?? '',
        })),
        filename: `${prefix}-links.${ext}`,
      };
    }
    if (tab === 'images') {
      const filtered = images.filter(img => !search || img.imageUrl.toLowerCase().includes(search.toLowerCase()));
      return {
        rows: filtered.map(img => ({
          image_url: img.imageUrl, alt_text: img.altText ?? '', source_page: img.pageUrl,
          format: img.format ?? '', has_width: img.hasWidth ? 'true' : 'false',
          has_height: img.hasHeight ? 'true' : 'false', is_lazy: img.isLazy ? 'true' : 'false',
        })),
        filename: `${prefix}-images.${ext}`,
      };
    }
    if (tab === 'serp') {
      const filtered = serpResults.filter(s => !search || s.keyword.toLowerCase().includes(search.toLowerCase()) || s.url.toLowerCase().includes(search.toLowerCase()));
      return {
        rows: filtered.map(s => ({
          keyword: s.keyword, position: s.position, url: s.url, title: s.title,
          description: s.description, features: s.featuresJson, device: s.device ?? '', location: s.location ?? '',
        })),
        filename: `${prefix}-serp.${ext}`,
      };
    }
    if (tab === 'redirects') {
      const filtered = redirects.filter(r => !search || r.sourceUrl.toLowerCase().includes(search.toLowerCase()) || r.targetUrl.toLowerCase().includes(search.toLowerCase()));
      return {
        rows: filtered.map(r => ({
          source_url: r.sourceUrl, target_url: r.targetUrl, status_code: r.statusCode, hop_number: r.hopNumber, final_url: r.finalUrl,
        })),
        filename: `${prefix}-redirects.${ext}`,
      };
    }
    if (tab === 'hreflang') {
      const filtered = hreflang.filter(h => !search || h.pageUrl.toLowerCase().includes(search.toLowerCase()) || h.hreflang.toLowerCase().includes(search.toLowerCase()));
      return {
        rows: filtered.map(h => ({
          page_url: h.pageUrl, hreflang: h.hreflang, href: h.href,
        })),
        filename: `${prefix}-hreflang.${ext}`,
      };
    }
    if (tab === 'duplicates') {
      return {
        rows: duplicates.map(d => ({
          content_hash: d.contentHash, urls: d.urls.join(' | '), count: d.urls.length,
        })),
        filename: `${prefix}-duplicates.${ext}`,
      };
    }
    if (tab === 'extractions') {
      const filtered = customExtracts.filter(e => !search || e.pageUrl.toLowerCase().includes(search.toLowerCase()) || e.ruleName.toLowerCase().includes(search.toLowerCase()));
      return {
        rows: filtered.map(e => ({
          page_url: e.pageUrl, rule_name: e.ruleName, selector: e.selector, value: e.value ?? '',
        })),
        filename: `${prefix}-extractions.${ext}`,
      };
    }
    if (tab === 'geo') {
      return {
        rows: geoScores.map(g => ({
          url: g.url, overall_score: g.overallScore, entity_clarity: g.entityClarity,
          answer_readiness: g.answerReadiness, citation_signals: g.citationSignals,
          structured_data_completeness: g.structuredDataCompleteness,
          issues: g.issues.map(i => i.message).join(' | '),
        })),
        filename: `${prefix}-geo-scores.${ext}`,
      };
    }
    if (tab === 'perf') {
      return {
        rows: perfScores.map(p => ({
          url: p.url, overall_score: p.overallScore, ttfb_score: p.ttfbScore,
          page_size_score: p.pageSizeScore, image_opt_score: p.imageOptScore,
          content_efficiency: p.contentEfficiency, ttfb_ms: p.ttfbMs,
          total_bytes: p.totalBytes, image_bytes: p.imageBytes,
          issues: p.issues.map(i => i.message).join(' | '),
        })),
        filename: `${prefix}-perf-scores.${ext}`,
      };
    }
    return { rows: [], filename: '' };
  };

  const handlePerUrlExport = async (url: string, type: 'inlinks' | 'outlinks' | 'images', format: 'csv' | 'json') => {
    if (!crawlId) return;
    try {
      const result = await (window as any).api.exportPerUrl({ crawlId, urls: [url], type, format });
      if (result.success) showToast(`${type} exported (${result.totalRows} rows)`, 'success');
      else if (!result.cancelled) showToast(result.error || 'Export failed', 'error');
    } catch (err) { showToast(String(err), 'error'); }
    setContextMenu(null);
  };

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  const handleSerpQuery = () => {
    if (!onSerpQuery || !crawlId) return;
    const kws = serpKeywords.split('\n').map(k => k.trim()).filter(Boolean);
    if (kws.length === 0) { showToast('Enter at least one keyword', 'warning'); return; }
    onSerpQuery(kws, serpLocation, serpDevice);
  };

  const Th = ({ label, sortable, field }: { label: string; sortable?: boolean; field?: string }) => (
    <th
      onClick={sortable && field ? () => handleSort(field) : undefined}
      style={{ cursor: sortable ? 'pointer' : 'default', userSelect: 'none', whiteSpace: 'nowrap' }}
    >
      {label}
      {sortable && field === sortKey && (sortAsc ? ' ▲' : ' ▼')}
    </th>
  );

  const tabs: Tab[] = ['pages', 'links', 'images', 'issues_v2', 'issues', 'sitemap', 'semantic', 'redirects', 'hreflang', 'duplicates', 'extractions', 'serp', 'map', 'geo', 'perf', 'competitors', 'content_gaps'];

  // Label and count are separate so the count can be de-emphasised and the
  // label can stay on one line — the old single string wrapped to 3 rows.
  const TAB_META: Record<Tab, { label: string; count?: number }> = {
    pages: { label: 'Pages', count: pages.length },
    links: { label: 'Links', count: links.length },
    images: { label: 'Images', count: images.length },
    issues_v2: { label: 'Issues' },
    issues: { label: 'Issue list', count: totalIssueCount },
    sitemap: { label: 'Sitemap' },
    semantic: { label: 'Semantic' },
    redirects: { label: 'Redirects', count: redirects.length },
    hreflang: { label: 'Hreflang', count: hreflang.length },
    duplicates: { label: 'Duplicates', count: duplicates.length },
    extractions: { label: 'Extractions', count: customExtracts.length },
    serp: { label: 'SERP', count: serpResults.length },
    map: { label: 'Map', count: pages.length },
    geo: { label: 'GEO', count: geoScores.length },
    perf: { label: 'Perf', count: perfScores.length },
    competitors: { label: 'Competitors', count: discoverResults.length },
    content_gaps: { label: 'Gaps', count: contentGaps.length },
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Row 1 — tabs. Scrolls horizontally; 17 of them will not fit at any
          sane window width, and sharing a row with the toolbar pushed the
          export buttons off-screen entirely. */}
      <div style={{
        display: 'flex',
        alignItems: 'stretch',
        padding: '0 12px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <div ref={stripRef} className={`tab-strip${tabFade.l ? ' fade-l' : ''}${tabFade.r ? ' fade-r' : ''}`} role="tablist">
          {tabs.map(t => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={`tab${tab === t ? ' active' : ''}`}
              onClick={() => setTab(t)}
            >
              {TAB_META[t].label}
              {TAB_META[t].count !== undefined && (
                <span className="tab-count">{TAB_META[t].count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Row 2 — filter + actions */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <input
          className="input"
          style={{ width: 220, padding: '3px 8px', fontSize: 12, flexShrink: 0 }}
          placeholder="Filter…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div style={{ flex: 1 }} />
        {crawlId && (
          <div style={{ display: 'flex', gap: 4 }}>
            <div style={{ position: 'relative' }}>
              <button className="btn-ghost" style={{ fontSize: 12, padding: '3px 10px' }} onClick={async () => {
                const crawls = await window.api.getCrawls();
                setCompareCrawls(crawls.filter((c: CrawlRecord) => c.id !== crawlId));
                setShowCrawlPicker(p => !p);
              }}>⇄ Compare</button>
              {showCrawlPicker && compareCrawls.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 50, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 6, padding: 4, minWidth: 250, maxHeight: 200, overflowY: 'auto' }}>
                  {compareCrawls.map(c => (
                    <button key={c.id} className="btn-ghost" style={{ display: 'block', width: '100%', textAlign: 'left', fontSize: 11, padding: '4px 8px' }} onClick={async () => {
                      setShowCrawlPicker(false);
                      const diffs = await window.api.compareCrawls(crawlId, c.id);
                      setComparisonDiffs(diffs);
                      setShowComparison(true);
                    }}>
                      {c.startUrl} — {new Date(c.startTime).toLocaleDateString()} ({c.completedUrls} pages)
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className="btn-ghost" style={{ fontSize: 12, padding: '3px 10px' }} onClick={exportCsv}>
              ↓ CSV
            </button>
            <button className="btn-ghost" style={{ fontSize: 12, padding: '3px 10px' }} onClick={exportJson}>
              ↓ JSON
            </button>
            <button className="btn-ghost" style={{ fontSize: 12, padding: '3px 10px' }} disabled={!crawlId} onClick={() => setShowExportModal(true)}>
              ⤓ Bulk Export
            </button>
            <button className="btn-ghost" style={{ fontSize: 12, padding: '3px 10px' }} disabled={reportGenerating || !crawlId} onClick={async () => {
              if (!crawlId) return;
              setReportGenerating(true);
              try {
                const config: ReportConfig = {
                  crawlId,
                  title: reportTitle || 'SEO Audit Report',
                  companyName: reportCompany || undefined,
                  analystName: undefined,
                  sections: ['executive_summary', 'technical_issues', 'content_quality', 'performance', 'geo_readiness', 'internal_links', 'structured_data', 'security', 'images'],
                  brandColor: '#22c55e',
                };
                const result = await window.api.reportGeneratePdf({ config, crawlId });
                if (result.success) showToast(`PDF saved to ${result.filePath}`, 'success');
                else showToast(result.error || 'PDF failed', 'error');
              } catch (err) {
                showToast(String(err), 'error');
              } finally {
                setReportGenerating(false);
              }
            }}>
              {reportGenerating ? '⏳' : '📄'} PDF
            </button>
          </div>
        )}
      </div>

      {/* Issues filter bar */}
      {tab === 'issues' && (
        <div style={{
          display: 'flex',
          gap: 6,
          padding: '6px 12px',
          borderBottom: '1px solid var(--border)',
          overflowX: 'auto',
          flexShrink: 0,
        }}>
          {(Object.keys(issueCounts) as IssueFilter[]).map(f => (
            <button
              key={f}
              onClick={() => setIssueFilter(f)}
              style={{
                padding: '3px 10px',
                fontSize: 11,
                borderRadius: 12,
                border: '1px solid ' + (issueFilter === f ? 'var(--accent-blue)' : 'var(--border)'),
                background: issueFilter === f ? 'var(--tint-blue)' : 'transparent',
                color: issueFilter === f ? 'var(--accent-blue)' : 'var(--text-secondary)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              {f !== 'all' && (
                <span style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: severityColor(issueSeverity(f)),
                  display: 'inline-block',
                  flexShrink: 0,
                }} />
              )}
              {f.replace(/_/g, ' ')}
              <span style={{ marginLeft: 3, color: issueCounts[f] > 0 && f !== 'all' ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                {issueCounts[f]}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* AI issue recommendation card */}
      {tab === 'issues' && issueFilter !== 'all' && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {issueRecs[issueFilter] ? (
            <div style={{
              background: 'var(--tint-blue)',
              border: '1px solid var(--accent-blue)',
              borderRadius: 8,
              padding: '10px 14px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                  🤖 AI Recommendation — {issueFilter.replace(/_/g, ' ')}
                </span>
                <button
                  className="btn-ghost"
                  style={{ fontSize: 11, padding: '2px 8px' }}
                  onClick={handleGetRec}
                  disabled={recLoading}
                >
                  {recLoading ? '⏳' : '↻ Refresh'}
                </button>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 8px 0', lineHeight: 1.5 }}>
                {issueRecs[issueFilter].explanation}
              </p>
              {issueRecs[issueFilter].fixSuggestions.length > 0 && (
                <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  {issueRecs[issueFilter].fixSuggestions.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              )}
            </div>
          ) : (
            <button
              className="btn-ghost"
              style={{
                fontSize: 12,
                padding: '6px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
              onClick={handleGetRec}
              disabled={recLoading || !crawlId}
            >
              {recLoading ? '⏳ Analyzing…' : '🤖 Get AI Recommendation'}
            </button>
          )}
        </div>
      )}

      {/* Crawl comparison overlay */}
      {showComparison && (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <CrawlComparison diffs={comparisonDiffs} onClose={() => setShowComparison(false)} />
        </div>
      )}

      {/* Table area */}
      {!showComparison && <div style={{ flex: 1, overflowY: 'auto' }}>
        {(tab === 'pages' || tab === 'issues') && (
          <table className="data-table">
            <thead>
              <tr>
                <Th label="URL" sortable field="url" />
                <Th label="Status" sortable field="statusCode" />
                <Th label="Title" sortable field="title" />
                <Th label="Title Len" sortable field="titleLength" />
                <Th label="Title px" sortable field="titlePixelWidth" />
                <Th label="Meta" sortable field="metaDescription" />
                <Th label="Meta Len" sortable field="metaDescLength" />
                <Th label="Meta px" sortable field="metaDescPixelWidth" />
                <Th label="H1" sortable field="h1" />
                <Th label="H1 Len" sortable field="h1Length" />
                <Th label="H2" sortable field="h2" />
                <Th label="H2 Len" sortable field="h2Length" />
                <Th label="Words" sortable field="wordCount" />
                <Th label="Size" sortable field="pageSizeBytes" />
                <Th label="Depth" sortable field="crawlDepth" />
                <Th label="ms" sortable field="responseTimeMs" />
                <Th label="Link Score" sortable field="linkScore" />
                <Th label="GEO" />
                <Th label="Perf" />
                <Th label="Inlinks" />
                <Th label="Outlinks" />
                <Th label="Indexability" />
              </tr>
            </thead>
            <tbody>
              {filteredPages.length === 0 ? (
                <tr><td colSpan={22} className="table-empty">
                  {pages.length === 0 ? 'Start a crawl to see results' : 'No results match filter'}
                </td></tr>
              ) : filteredPages.slice(0, MAX_RENDER_ROWS).map(p => {
                const inlinks = inlinkMap.get(p.url) ?? [];
                const isExpanded = expandedInlinks === p.url;
                return (
                <React.Fragment key={p.id}>
                <tr onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, url: p.url }); }}>
                  <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <a href={p.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>
                      {p.url}
                    </a>
                  </td>
                  <td style={{ color: statusColor(p.statusCode ?? 0), fontWeight: 600 }}>{p.statusCode ?? '—'}</td>
                  <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.title ? (
                      <span title={p.title}>{p.title}</span>
                    ) : (
                      <span style={{ color: 'var(--accent-red)', fontSize: 11 }}>MISSING</span>
                    )}
                  </td>
                  <td style={{ color: titleLengthColor(p.titleLength ?? 0), fontVariantNumeric: 'tabular-nums' }}>
                    {p.titleLength ?? '—'}
                  </td>
                  <td style={{ color: titleWidthColor(p.titlePixelWidth ?? 0), fontVariantNumeric: 'tabular-nums' }}>
                    {p.titlePixelWidth ?? '—'}
                  </td>
                  <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.metaDescription ? (
                      <span title={p.metaDescription}>{p.metaDescription}</span>
                    ) : (
                      <span style={{ color: 'var(--accent-red)', fontSize: 11 }}>MISSING</span>
                    )}
                  </td>
                  <td style={{ color: metaLengthColor(p.metaDescLength ?? 0), fontVariantNumeric: 'tabular-nums' }}>
                    {p.metaDescLength ?? '—'}
                  </td>
                  <td style={{ color: metaWidthColor(p.metaDescPixelWidth ?? 0), fontVariantNumeric: 'tabular-nums' }}>
                    {p.metaDescPixelWidth ?? '—'}
                  </td>
                  <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.h1 ?? <span style={{ color: 'var(--accent-red)', fontSize: 11 }}>MISSING</span>}
                  </td>
                  <td style={{ color: headingLengthColor(p.h1Length ?? null), fontVariantNumeric: 'tabular-nums' }}>
                    {p.h1Length ?? '—'}
                  </td>
                  <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.h2 ?? <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>}
                  </td>
                  <td style={{ color: headingLengthColor(p.h2Length ?? null), fontVariantNumeric: 'tabular-nums' }}>
                    {p.h2Length ?? '—'}
                  </td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{p.wordCount ?? '—'}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11 }}>
                    {p.pageSizeBytes != null ? (p.pageSizeBytes / 1024).toFixed(1) : '—'}
                  </td>
                  <td style={{ fontVariantNumeric: 'tabular-nums', color: p.crawlDepth > 3 ? 'var(--accent-orange)' : undefined }}>
                    {p.crawlDepth}
                  </td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{p.responseTimeMs ?? '—'}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: (p.linkScore ?? 0) >= 50 ? 'var(--accent-green)' : 'var(--text-muted)' }}>{p.linkScore?.toFixed(1) ?? '—'}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: (() => { const g = geoScoreMap.get(p.id); if (!g) return 'var(--text-muted)'; return g.overallScore >= 70 ? 'var(--accent-green)' : g.overallScore >= 40 ? 'var(--accent-orange)' : 'var(--accent-red)'; })() }}>{geoScoreMap.get(p.id)?.overallScore?.toFixed(0) ?? '—'}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: (() => { const pf = perfScoreMap.get(p.id); if (!pf) return 'var(--text-muted)'; return pf.overallScore >= 70 ? 'var(--accent-green)' : pf.overallScore >= 40 ? 'var(--accent-orange)' : 'var(--accent-red)'; })() }}>{perfScoreMap.get(p.id)?.overallScore?.toFixed(0) ?? '—'}</td>
                  <td>
                    {inlinks.length > 0 ? (
                      <span
                        onClick={() => toggleInlinks(p.url)}
                        style={{
                          cursor: 'pointer',
                          color: 'var(--accent-blue)',
                          fontWeight: 600,
                          fontSize: 12,
                          userSelect: 'none',
                        }}
                        title="Click to view inlinks"
                      >
                        {inlinks.length} {isExpanded ? '▾' : '▸'}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>0</span>
                    )}
                  </td>
                  <td style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>
                    {outlinkMap.get(p.url) ?? 0}
                  </td>
                  <td>
                    {!p.isIndexable ? (
                      <span style={{ color: 'var(--accent-orange)', fontSize: 10, fontWeight: 600 }}>
                        {p.isCanonicalized ? 'CANON' : 'NOINDEX'}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--accent-green)', fontSize: 10 }}>✓</span>
                    )}
                  </td>
                </tr>
                {isExpanded && inlinks.length > 0 && (
                  <tr>
                    <td colSpan={22} style={{ padding: 0, background: 'var(--bg-secondary)' }}>
                      <div style={{ padding: '8px 16px 8px 32px', maxHeight: 200, overflowY: 'auto' }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600 }}>
                          Inlinks to {p.url} ({inlinks.length})
                        </div>
                        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)' }}>
                              <th style={{ textAlign: 'left', padding: '2px 8px', color: 'var(--text-muted)', fontWeight: 500, fontSize: 11 }}>Source URL</th>
                              <th style={{ textAlign: 'left', padding: '2px 8px', color: 'var(--text-muted)', fontWeight: 500, fontSize: 11 }}>Anchor Text</th>
                              <th style={{ textAlign: 'left', padding: '2px 8px', color: 'var(--text-muted)', fontWeight: 500, fontSize: 11 }}>Rel</th>
                            </tr>
                          </thead>
                          <tbody>
                            {inlinks.map((il, idx) => (
                              <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                                <td style={{ padding: '3px 8px', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  <a href={il.sourceUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>{il.sourceUrl}</a>
                                </td>
                                <td style={{ padding: '3px 8px', color: 'var(--text-secondary)' }}>{il.anchorText || '(none)'}</td>
                                <td style={{ padding: '3px 8px', color: 'var(--text-muted)', fontSize: 11 }}>{il.relAttr || ''}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
                </React.Fragment>
                );
              })}
              {filteredPages.length > MAX_RENDER_ROWS && (
                <tr>
                  <td colSpan={22} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 12, fontSize: 12, background: 'var(--bg-secondary)' }}>
                    Showing first {MAX_RENDER_ROWS.toLocaleString()} of {filteredPages.length.toLocaleString()} rows. Use search to narrow, or Export to get the full dataset.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {tab === 'issues_v2' && (
          <div style={{ height: '100%', padding: 12 }}>
            <IssuesTab pages={pages} links={links} />
          </div>
        )}

        {tab === 'sitemap' && (
          <SitemapPanel crawlId={crawlId} pages={pages} />
        )}

        {tab === 'semantic' && (
          <SemanticPanel crawlId={crawlId} showToast={showToast} />
        )}

        {tab === 'links' && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Source URL</th>
                <th>Destination URL</th>
                <th>Anchor Text</th>
                <th>Type</th>
                <th>Crawlability</th>
                <th>Nofollow</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {links.length === 0 ? (
                <tr><td colSpan={7} className="table-empty">No links collected yet</td></tr>
              ) : (() => {
                const filteredLinks = links.filter(l => !search || l.sourceUrl.toLowerCase().includes(search.toLowerCase()) || l.targetUrl.toLowerCase().includes(search.toLowerCase()));
                const capped = filteredLinks.slice(0, MAX_RENDER_ROWS);
                return (<>{capped.map((l, i) => (
                <tr key={i}>
                  <td style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <a href={l.sourceUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>{l.sourceUrl}</a>
                  </td>
                  <td style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <a href={l.targetUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>{l.targetUrl}</a>
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>{l.anchorText || '(none)'}</td>
                  <td>
                    <span style={{
                      fontSize: 10,
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: !l.isInternal ? 'var(--tint-orange)' : 'var(--tint-blue)',
                      color: !l.isInternal ? 'var(--accent-orange)' : 'var(--accent-blue)',
                    }}>
                      {!l.isInternal ? 'External' : 'Internal'}
                    </span>
                  </td>
                  <td style={{ fontSize: 11 }}>
                    {l.crawlability === 'uncrawlable' ? (
                      <span
                        title={UNCRAWLABLE_REASON_LABELS[l.uncrawlableReason as UncrawlableReason] ?? l.uncrawlableReason ?? ''}
                        style={{
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: 'var(--tint-orange)',
                          color: 'var(--accent-orange)',
                          fontWeight: 600,
                        }}
                      >Uncrawlable</span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>Crawlable</span>
                    )}
                  </td>
                  <td style={{ color: l.relAttr?.includes('nofollow') ? 'var(--accent-orange)' : 'var(--text-muted)', fontSize: 11 }}>
                    {l.relAttr?.includes('nofollow') ? 'nofollow' : ''}
                  </td>
                  <td style={{ fontSize: 11, textAlign: 'center' }}>
                    {!l.isInternal && l.statusCode != null ? (
                      <span style={{
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: 'var(--tint-gray)',
                        color: statusColor(l.statusCode),
                        fontWeight: 600,
                      }}>{l.statusCode}</span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}{filteredLinks.length > MAX_RENDER_ROWS && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 12, fontSize: 12, background: 'var(--bg-secondary)' }}>
                  Showing first {MAX_RENDER_ROWS.toLocaleString()} of {filteredLinks.length.toLocaleString()} rows. Use search to narrow, or Export to get the full dataset.
                </td></tr>
              )}</>);
              })()}
            </tbody>
          </table>
        )}

        {tab === 'images' && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Image URL</th>
                <th>Alt Text</th>
                <th>Format</th>
                <th>Width Attr</th>
                <th>Height Attr</th>
                <th>Lazy Load</th>
                <th>Source Page</th>
              </tr>
            </thead>
            <tbody>
              {images.length === 0 ? (
                <tr><td colSpan={7} className="table-empty">No images collected yet</td></tr>
              ) : (() => {
                const filteredImages = images.filter(img => !search || img.imageUrl.toLowerCase().includes(search.toLowerCase()));
                const capped = filteredImages.slice(0, MAX_RENDER_ROWS);
                return (<>{capped.map((img, i) => (
                <tr key={i}>
                  <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <a href={img.imageUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>{img.imageUrl}</a>
                  </td>
                  <td style={{ color: img.altText ? 'var(--text-secondary)' : 'var(--accent-red)', fontSize: img.altText ? 13 : 11 }}>
                    {img.altText || 'MISSING'}
                  </td>
                  <td>{img.format ?? '—'}</td>
                  <td>{img.hasWidth ? '✓' : '✗'}</td>
                  <td>{img.hasHeight ? '✓' : '✗'}</td>
                  <td>{img.isLazy ? '✓' : '✗'}</td>
                  <td style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                    {img.pageUrl}
                  </td>
                </tr>
              ))}{filteredImages.length > MAX_RENDER_ROWS && (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 12, fontSize: 12, background: 'var(--bg-secondary)' }}>
                  Showing first {MAX_RENDER_ROWS.toLocaleString()} of {filteredImages.length.toLocaleString()} rows. Use search to narrow, or Export to get the full dataset.
                </td></tr>
              )}</>);
              })()}
            </tbody>
          </table>
        )}

        {tab === 'redirects' && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Source URL</th>
                <th>Target URL</th>
                <th>Status</th>
                <th>Hop #</th>
                <th>Final URL</th>
              </tr>
            </thead>
            <tbody>
              {redirects.length === 0 ? (
                <tr><td colSpan={5} className="table-empty">No redirect chains detected</td></tr>
              ) : redirects
                .filter(r => !search || r.sourceUrl.toLowerCase().includes(search.toLowerCase()) || r.targetUrl.toLowerCase().includes(search.toLowerCase()))
                .map((r, i) => (
                <tr key={i}>
                  <td style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <a href={r.sourceUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>{r.sourceUrl}</a>
                  </td>
                  <td style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <a href={r.targetUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>{r.targetUrl}</a>
                  </td>
                  <td style={{ color: statusColor(r.statusCode), fontWeight: 600 }}>{r.statusCode}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.hopNumber}</td>
                  <td style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                    {r.finalUrl}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'hreflang' && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Page URL</th>
                <th>Hreflang</th>
                <th>Href</th>
              </tr>
            </thead>
            <tbody>
              {hreflang.length === 0 ? (
                <tr><td colSpan={3} className="table-empty">No hreflang tags found</td></tr>
              ) : hreflang
                .filter(h => !search || h.pageUrl.toLowerCase().includes(search.toLowerCase()) || h.hreflang.toLowerCase().includes(search.toLowerCase()))
                .map((h, i) => (
                <tr key={i}>
                  <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <a href={h.pageUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>{h.pageUrl}</a>
                  </td>
                  <td style={{ fontWeight: 500 }}>{h.hreflang}</td>
                  <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <a href={h.href} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>{h.href}</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'duplicates' && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Content Hash</th>
                <th>Duplicate URLs</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {duplicates.length === 0 ? (
                <tr><td colSpan={3} className="table-empty">No duplicate content detected</td></tr>
              ) : duplicates
                .filter(d => !search || d.urls.some(u => u.toLowerCase().includes(search.toLowerCase())) || d.contentHash.toLowerCase().includes(search.toLowerCase()))
                .map((d, i) => (
                <tr key={i}>
                  <td style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>{d.contentHash.slice(0, 16)}…</td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {d.urls.map((u, j) => (
                        <a key={j} href={u} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'none', fontSize: 12 }}>{u}</a>
                      ))}
                    </div>
                  </td>
                  <td style={{ fontWeight: 600, color: 'var(--accent-red)' }}>{d.urls.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'extractions' && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Page URL</th>
                <th>Rule Name</th>
                <th>Selector</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {customExtracts.length === 0 ? (
                <tr><td colSpan={4} className="table-empty">No custom extractions configured</td></tr>
              ) : customExtracts
                .filter(e => !search || e.pageUrl.toLowerCase().includes(search.toLowerCase()) || e.ruleName.toLowerCase().includes(search.toLowerCase()))
                .map((e, i) => (
                <tr key={i}>
                  <td style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <a href={e.pageUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>{e.pageUrl}</a>
                  </td>
                  <td style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>{e.ruleName}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>{e.selector}</td>
                  <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.value ?? <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>null</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'map' && (
          <SiteMap pages={pages} />
        )}

        {tab === 'geo' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
              <button
                className="btn-primary"
                style={{ padding: '6px 14px', fontSize: 12 }}
                disabled={geoAnalyzing || !crawlId || pages.length === 0}
                onClick={async () => {
                  if (!crawlId) return;
                  setGeoAnalyzing(true);
                  try {
                    const result = await window.api.geoAnalyze(crawlId);
                    if (result.success) {
                      showToast(`GEO analysis complete: ${result.total} pages scored`, 'success');
                      const scores = await window.api.geoGetScores(crawlId);
                      onGeoScoresUpdate?.(scores);
                    } else {
                      showToast(result.error || 'GEO analysis failed', 'error');
                    }
                  } catch (err) {
                    showToast(String(err), 'error');
                  } finally {
                    setGeoAnalyzing(false);
                  }
                }}
              >
                {geoAnalyzing ? '⏳ Analyzing…' : '🌐 Run GEO/AEO Analysis'}
              </button>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{geoScores.length} pages scored</span>
              {geoScores.length > 0 && (
                <span style={{ fontSize: 11, color: 'var(--accent-green)', fontWeight: 600, marginLeft: 'auto' }}>
                  Avg: {(geoScores.reduce((s, g) => s + g.overallScore, 0) / geoScores.length).toFixed(1)}/100
                </span>
              )}
            </div>
            {geoScores.length > 0 && (
              <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 16, flexShrink: 0 }}>
                {(['entityClarity', 'answerReadiness', 'citationSignals', 'structuredDataCompleteness'] as const).map(cat => {
                  const avg = geoScores.reduce((s, g) => s + g[cat], 0) / geoScores.length;
                  return (
                    <div key={cat} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 20, fontWeight: 700, color: avg >= 70 ? 'var(--accent-green)' : avg >= 40 ? 'var(--accent-orange)' : 'var(--accent-red)' }}>{avg.toFixed(0)}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{cat.replace(/([A-Z])/g, ' $1').trim()}</span>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>URL</th>
                    <th>Overall</th>
                    <th>Entity Clarity</th>
                    <th>Answer Ready</th>
                    <th>Citation</th>
                    <th>Structured Data</th>
                    <th>Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {geoScores.length === 0 ? (
                    <tr><td colSpan={7} className="table-empty">Click "Run GEO/AEO Analysis" to score pages</td></tr>
                  ) : [...geoScores].sort((a, b) => a.overallScore - b.overallScore).map(g => (
                    <tr key={g.pageId}>
                      <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <a href={g.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>{g.url}</a>
                      </td>
                      <td style={{ fontWeight: 700, color: g.overallScore >= 70 ? 'var(--accent-green)' : g.overallScore >= 40 ? 'var(--accent-orange)' : 'var(--accent-red)' }}>{g.overallScore.toFixed(0)}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{g.entityClarity.toFixed(0)}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{g.answerReadiness.toFixed(0)}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{g.citationSignals.toFixed(0)}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{g.structuredDataCompleteness.toFixed(0)}</td>
                      <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{g.issues.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'perf' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
              <button
                className="btn-primary"
                style={{ padding: '6px 14px', fontSize: 12 }}
                disabled={perfAnalyzing || !crawlId || pages.length === 0}
                onClick={async () => {
                  if (!crawlId) return;
                  setPerfAnalyzing(true);
                  try {
                    const result = await window.api.perfAnalyze(crawlId);
                    if (result.success) {
                      showToast(`Performance analysis complete: ${result.total} pages scored`, 'success');
                      const scores = await window.api.perfGetScores(crawlId);
                      onPerfScoresUpdate?.(scores);
                    } else {
                      showToast(result.error || 'Performance analysis failed', 'error');
                    }
                  } catch (err) {
                    showToast(String(err), 'error');
                  } finally {
                    setPerfAnalyzing(false);
                  }
                }}
              >
                {perfAnalyzing ? '⏳ Analyzing…' : '⚡ Run Performance Analysis'}
              </button>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{perfScores.length} pages scored</span>
              {perfScores.length > 0 && (
                <span style={{ fontSize: 11, color: 'var(--accent-green)', fontWeight: 600, marginLeft: 'auto' }}>
                  Avg: {(perfScores.reduce((s, p) => s + p.overallScore, 0) / perfScores.length).toFixed(1)}/100
                </span>
              )}
            </div>
            {perfScores.length > 0 && (
              <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 16, flexShrink: 0 }}>
                {([['ttfbScore', 'TTFB'], ['pageSizeScore', 'Page Size'], ['imageOptScore', 'Image Opt'], ['contentEfficiency', 'Content Eff']] as const).map(([key, label]) => {
                  const avg = perfScores.reduce((s, p) => s + p[key], 0) / perfScores.length;
                  return (
                    <div key={key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 20, fontWeight: 700, color: avg >= 70 ? 'var(--accent-green)' : avg >= 40 ? 'var(--accent-orange)' : 'var(--accent-red)' }}>{avg.toFixed(0)}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{label}</span>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>URL</th>
                    <th>Overall</th>
                    <th>TTFB</th>
                    <th>Page Size</th>
                    <th>Image Opt</th>
                    <th>Content Eff</th>
                    <th>TTFB (ms)</th>
                    <th>Size (KB)</th>
                    <th>Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {perfScores.length === 0 ? (
                    <tr><td colSpan={9} className="table-empty">Click "Run Performance Analysis" to score pages</td></tr>
                  ) : [...perfScores].sort((a, b) => a.overallScore - b.overallScore).map(p => (
                    <tr key={p.pageId}>
                      <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <a href={p.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>{p.url}</a>
                      </td>
                      <td style={{ fontWeight: 700, color: p.overallScore >= 70 ? 'var(--accent-green)' : p.overallScore >= 40 ? 'var(--accent-orange)' : 'var(--accent-red)' }}>{p.overallScore.toFixed(0)}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{p.ttfbScore.toFixed(0)}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{p.pageSizeScore.toFixed(0)}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{p.imageOptScore.toFixed(0)}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{p.contentEfficiency.toFixed(0)}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums', color: p.ttfbMs > 1000 ? 'var(--accent-red)' : p.ttfbMs > 500 ? 'var(--accent-orange)' : 'var(--accent-green)' }}>{p.ttfbMs}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{(p.totalBytes / 1024).toFixed(1)}</td>
                      <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.issues.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* ── Core Web Vitals via PageSpeed Insights ── */}
              <div data-testid="psi-section" style={{ borderTop: '1px solid var(--border)', marginTop: 8 }}>
                <div style={{ padding: '8px 12px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>
                    Core Web Vitals (PageSpeed Insights)
                  </span>
                  <select
                    className="input"
                    data-testid="psi-strategy"
                    style={{ width: 110, padding: '4px 6px', fontSize: 11 }}
                    value={psiStrategy}
                    onChange={e => setPsiStrategy(e.target.value as 'mobile' | 'desktop')}
                    disabled={psiAnalyzing}
                  >
                    <option value="mobile">📱 Mobile</option>
                    <option value="desktop">🖥 Desktop</option>
                  </select>
                  <button
                    className="btn-primary"
                    data-testid="psi-fetch"
                    style={{ padding: '5px 12px', fontSize: 12 }}
                    disabled={psiAnalyzing || !crawlId || pages.length === 0}
                    onClick={async () => {
                      if (!crawlId) return;
                      setPsiAnalyzing(true);
                      setPsiProgress(null);
                      try {
                        const result = await window.api.psiAnalyze({ crawlId, strategy: psiStrategy });
                        if (result.success) {
                          const suffix = result.capped ? ` (keyless — capped at ${result.capped} URLs, add a free API key in Settings for more)` : '';
                          showToast(`CWV fetched for ${result.total} URL${result.total === 1 ? '' : 's'}${result.errors ? `, ${result.errors} failed` : ''}${suffix}`, 'success');
                          setPsiScores(await window.api.psiGetScores(crawlId));
                        } else {
                          showToast(result.error || 'PSI analysis failed', 'error');
                        }
                      } catch (err) {
                        showToast(String(err), 'error');
                      } finally {
                        setPsiAnalyzing(false);
                        setPsiProgress(null);
                      }
                    }}
                  >
                    {psiAnalyzing ? '⏳ Fetching…' : '🌐 Fetch CWV'}
                  </button>
                  {psiAnalyzing && psiProgress && psiProgress.total > 0 && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {psiProgress.done}/{psiProgress.total} {psiProgress.url ? `— ${psiProgress.url}` : ''}
                    </span>
                  )}
                  {!psiAnalyzing && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {psiScores.length > 0 ? `${psiScores.length} URL${psiScores.length === 1 ? '' : 's'} scored` : 'Real Lighthouse + CrUX field data from Google. Public URLs only, ~15 s per URL.'}
                    </span>
                  )}
                </div>
                {psiScores.length > 0 && (
                  <table className="data-table" data-testid="psi-table">
                    <thead>
                      <tr>
                        <th>URL</th>
                        <th>Device</th>
                        <th>Perf</th>
                        <th>LCP (lab)</th>
                        <th>CLS (lab)</th>
                        <th>TBT</th>
                        <th>FCP</th>
                        <th>LCP (field)</th>
                        <th>INP (field)</th>
                        <th>CLS (field)</th>
                        <th>CrUX Rating</th>
                      </tr>
                    </thead>
                    <tbody>
                      {psiScores.map(s => {
                        const ms = (v: number | null) => v === null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`;
                        const scoreColor = (v: number | null) => v === null ? 'var(--text-muted)' : v >= 90 ? 'var(--accent-green)' : v >= 50 ? 'var(--accent-orange)' : 'var(--accent-red)';
                        return (
                          <tr key={s.pageId + s.strategy}>
                            <td style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              <a href={s.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>{s.url}</a>
                            </td>
                            <td style={{ fontSize: 11 }}>{s.strategy}</td>
                            <td style={{ fontWeight: 700, color: scoreColor(s.performanceScore) }}>{s.performanceScore ?? '—'}</td>
                            <td style={{ fontVariantNumeric: 'tabular-nums' }}>{ms(s.lcpMs)}</td>
                            <td style={{ fontVariantNumeric: 'tabular-nums' }}>{s.clsValue === null ? '—' : s.clsValue.toFixed(3)}</td>
                            <td style={{ fontVariantNumeric: 'tabular-nums' }}>{ms(s.tbtMs)}</td>
                            <td style={{ fontVariantNumeric: 'tabular-nums' }}>{ms(s.fcpMs)}</td>
                            <td style={{ fontVariantNumeric: 'tabular-nums' }}>{ms(s.fieldLcpMs)}</td>
                            <td style={{ fontVariantNumeric: 'tabular-nums' }}>{ms(s.fieldInpMs)}</td>
                            <td style={{ fontVariantNumeric: 'tabular-nums' }}>{s.fieldCls === null ? '—' : s.fieldCls.toFixed(2)}</td>
                            <td style={{
                              fontSize: 11,
                              fontWeight: 600,
                              color: s.fieldOverallCategory === 'FAST' ? 'var(--accent-green)'
                                : s.fieldOverallCategory === 'AVERAGE' ? 'var(--accent-orange)'
                                : s.fieldOverallCategory === 'SLOW' ? 'var(--accent-red)' : 'var(--text-muted)',
                            }}>
                              {s.fieldOverallCategory ?? 'no data'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === 'serp' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* SERP keyword input */}
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Keywords (one per line)</label>
                <textarea
                  className="input"
                  style={{ height: 60, fontSize: 12, resize: 'none', fontFamily: 'inherit' }}
                  placeholder={'seo spider tool\nwebsite crawler\nsite audit tool'}
                  value={serpKeywords}
                  onChange={e => setSerpKeywords(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Location</label>
                <input className="input" style={{ width: 130, padding: '4px 8px', fontSize: 12 }} value={serpLocation} onChange={e => setSerpLocation(e.target.value)} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Device</label>
                <select className="input" style={{ width: 90, padding: '4px 6px', fontSize: 12 }} value={serpDevice} onChange={e => setSerpDevice(e.target.value as 'desktop' | 'mobile')}>
                  <option value="desktop">Desktop</option>
                  <option value="mobile">Mobile</option>
                </select>
              </div>
              <button
                className="btn-primary"
                style={{ padding: '6px 14px', fontSize: 12, whiteSpace: 'nowrap' }}
                onClick={handleSerpQuery}
                disabled={!crawlId || serpLoading}
              >
                {serpLoading ? 'Querying…' : '🔍 Query SERP'}
              </button>
            </div>

            {/* SERP results table */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Keyword</th>
                    <th>#</th>
                    <th>URL</th>
                    <th>Title</th>
                    <th>Description</th>
                    <th>Features</th>
                    <th>Device</th>
                  </tr>
                </thead>
                <tbody>
                  {serpResults.length === 0 ? (
                    <tr><td colSpan={7} className="table-empty">
                      {crawlId ? 'Enter keywords above to query SERP rankings' : 'Start a crawl first to use SERP queries'}
                    </td></tr>
                  ) : serpResults
                    .filter(s => !search || s.keyword.toLowerCase().includes(search.toLowerCase()) || s.url.toLowerCase().includes(search.toLowerCase()))
                    .map((s, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{s.keyword}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums', color: s.position <= 3 ? 'var(--accent-green)' : s.position <= 10 ? 'var(--accent-blue)' : 'var(--text-secondary)', fontWeight: 600 }}>
                        {s.position}
                      </td>
                      <td style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <a href={s.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>{s.url}</a>
                      </td>
                      <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.title}
                      </td>
                      <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: 12 }}>
                        {s.description}
                      </td>
                      <td style={{ fontSize: 10 }}>
                        {(() => { try { const f = JSON.parse(s.featuresJson); return Array.isArray(f) ? f.join(', ') : ''; } catch { return ''; } })()}
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.device ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'competitors' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Your Domain</label>
                <input className="input" style={{ width: 180, padding: '4px 8px', fontSize: 12 }} placeholder="example.com" value={competitorDomain} onChange={e => setCompetitorDomain(e.target.value)} />
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Keywords (one per line)</label>
                <textarea
                  className="input"
                  style={{ height: 60, fontSize: 12, resize: 'none', fontFamily: 'inherit' }}
                  placeholder={'seo spider tool\nwebsite crawler\nsite audit tool'}
                  value={competitorKeywords}
                  onChange={e => setCompetitorKeywords(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Country</label>
                <input className="input" style={{ width: 60, padding: '4px 8px', fontSize: 12 }} value={competitorCountry} onChange={e => setCompetitorCountry(e.target.value)} />
              </div>
              <button
                className="btn-primary"
                style={{ padding: '6px 14px', fontSize: 12, whiteSpace: 'nowrap' }}
                disabled={competitorAnalyzing || !crawlId || !competitorDomain.trim() || !competitorKeywords.trim()}
                onClick={async () => {
                  if (!crawlId) return;
                  setCompetitorAnalyzing(true);
                  try {
                    const keywords = competitorKeywords.split('\n').map(k => k.trim()).filter(Boolean);
                    const result = await window.api.discoverCompetitors({ crawlId, domain: competitorDomain.trim(), keywords, country: competitorCountry || undefined });
                    if (result.success && result.results) {
                      showToast(`Found ${result.total} competitor pages`, 'success');
                      onDiscoverResultsUpdate?.(result.results);
                    } else {
                      showToast(result.error || 'Competitor discovery failed', 'error');
                    }
                  } catch (err) {
                    showToast(String(err), 'error');
                  } finally {
                    setCompetitorAnalyzing(false);
                  }
                }}
              >
                {competitorAnalyzing ? '⏳ Discovering…' : '🔍 Discover Competitors'}
              </button>
            </div>
            {discoverResults.length > 0 && (
              <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 16, flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{discoverResults.length} results</span>
                <span style={{ fontSize: 11, color: 'var(--accent-green)' }}>High relevance (≥0.7): {discoverResults.filter(r => r.relevanceScore >= 0.7).length}</span>
                <span style={{ fontSize: 11, color: 'var(--accent-orange)' }}>Medium (0.4–0.7): {discoverResults.filter(r => r.relevanceScore >= 0.4 && r.relevanceScore < 0.7).length}</span>
                <span style={{ fontSize: 11, color: 'var(--accent-red)' }}>Low (&lt;0.4): {discoverResults.filter(r => r.relevanceScore < 0.4).length}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>Domains: {new Set(discoverResults.map(r => { try { return new URL(r.link).hostname; } catch { return r.link; } })).size}</span>
              </div>
            )}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>URL</th>
                    <th>Domain</th>
                    <th>Title</th>
                    <th>Description</th>
                    <th>Relevance</th>
                  </tr>
                </thead>
                <tbody>
                  {discoverResults.length === 0 ? (
                    <tr><td colSpan={5} className="table-empty">Enter your domain and target keywords above to discover competitors</td></tr>
                  ) : [...discoverResults].sort((a, b) => b.relevanceScore - a.relevanceScore).map((r, i) => (
                    <tr key={i}>
                      <td style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <a href={r.link} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>{r.link}</a>
                      </td>
                      <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                        {(() => { try { return new URL(r.link).hostname; } catch { return '—'; } })()}
                      </td>
                      <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</td>
                      <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: 12 }}>{r.description}</td>
                      <td style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: r.relevanceScore >= 0.7 ? 'var(--accent-green)' : r.relevanceScore >= 0.4 ? 'var(--accent-orange)' : 'var(--accent-red)' }}>
                        {(r.relevanceScore * 100).toFixed(0)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'content_gaps' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Your Domain</label>
                <input className="input" style={{ width: 180, padding: '4px 8px', fontSize: 12 }} placeholder="example.com" value={gapDomain} onChange={e => setGapDomain(e.target.value)} />
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Topics (one per line)</label>
                <textarea
                  className="input"
                  style={{ height: 60, fontSize: 12, resize: 'none', fontFamily: 'inherit' }}
                  placeholder={'technical seo guide\ncrawl budget optimization\ncore web vitals'}
                  value={gapTopics}
                  onChange={e => setGapTopics(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Country</label>
                <input className="input" style={{ width: 60, padding: '4px 8px', fontSize: 12 }} value={gapCountry} onChange={e => setGapCountry(e.target.value)} />
              </div>
              <button
                className="btn-primary"
                style={{ padding: '6px 14px', fontSize: 12, whiteSpace: 'nowrap' }}
                disabled={gapAnalyzing || !crawlId || !gapDomain.trim() || !gapTopics.trim()}
                onClick={async () => {
                  if (!crawlId) return;
                  setGapAnalyzing(true);
                  try {
                    const topics = gapTopics.split('\n').map(t => t.trim()).filter(Boolean);
                    const result = await window.api.discoverContentGaps({ crawlId, domain: gapDomain.trim(), topics, country: gapCountry || undefined });
                    if (result.success && result.gaps) {
                      showToast(`Analyzed ${result.total} topics for content gaps`, 'success');
                      onContentGapsUpdate?.(result.gaps);
                    } else {
                      showToast(result.error || 'Content gap analysis failed', 'error');
                    }
                  } catch (err) {
                    showToast(String(err), 'error');
                  } finally {
                    setGapAnalyzing(false);
                  }
                }}
              >
                {gapAnalyzing ? '⏳ Analyzing…' : '📊 Analyze Content Gaps'}
              </button>
            </div>
            {contentGaps.length > 0 && (
              <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 16, flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{contentGaps.length} topics analyzed</span>
                <span style={{ fontSize: 11, color: 'var(--accent-red)' }}>High: {contentGaps.filter(g => g.gapSeverity === 'high').length}</span>
                <span style={{ fontSize: 11, color: 'var(--accent-orange)' }}>Medium: {contentGaps.filter(g => g.gapSeverity === 'medium').length}</span>
                <span style={{ fontSize: 11, color: 'var(--accent-blue)' }}>Low: {contentGaps.filter(g => g.gapSeverity === 'low').length}</span>
                <span style={{ fontSize: 11, color: 'var(--accent-green)' }}>None: {contentGaps.filter(g => g.gapSeverity === 'none').length}</span>
              </div>
            )}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Topic</th>
                    <th>Severity</th>
                    <th>Own Content</th>
                    <th>Own Count</th>
                    <th>Competitor Count</th>
                    <th>Top Competitor Domains</th>
                    <th>Avg Relevance</th>
                  </tr>
                </thead>
                <tbody>
                  {contentGaps.length === 0 ? (
                    <tr><td colSpan={7} className="table-empty">Enter topics above to analyze content gaps against competitors</td></tr>
                  ) : [...contentGaps].sort((a, b) => {
                    const order = { high: 0, medium: 1, low: 2, none: 3 };
                    return (order[a.gapSeverity] ?? 4) - (order[b.gapSeverity] ?? 4);
                  }).map((g, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 500 }}>{g.topic}</td>
                      <td>
                        <span className={`badge ${g.gapSeverity === 'high' ? 'badge-red' : g.gapSeverity === 'medium' ? 'badge-orange' : g.gapSeverity === 'low' ? 'badge-blue' : 'badge-green'}`}>
                          {g.gapSeverity}
                        </span>
                      </td>
                      <td style={{ color: g.hasOwnContent ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 600 }}>{g.hasOwnContent ? 'Yes' : 'No'}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{g.ownContentCount}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums', color: g.competitorCount > 5 ? 'var(--accent-red)' : g.competitorCount > 2 ? 'var(--accent-orange)' : 'var(--text-secondary)' }}>{g.competitorCount}</td>
                      <td style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--text-muted)' }}>
                        {g.competitorDomains.slice(0, 3).join(', ')}{g.competitorDomains.length > 3 ? ` +${g.competitorDomains.length - 3}` : ''}
                      </td>
                      <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: g.avgRelevanceScore >= 0.7 ? 'var(--accent-green)' : g.avgRelevanceScore >= 0.4 ? 'var(--accent-orange)' : 'var(--accent-red)' }}>
                        {(g.avgRelevanceScore * 100).toFixed(0)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>}

      {/* Status bar */}
      <div style={{
        padding: '4px 12px',
        borderTop: '1px solid var(--border)',
        fontSize: 11,
        color: 'var(--text-muted)',
        display: 'flex',
        gap: 16,
        flexShrink: 0,
      }}>
        {tab === 'pages' || tab === 'issues' ? (
          <>
            <span>Total: {pages.length}</span>
            <span style={{ color: 'var(--accent-green)' }}>200: {pages.filter(p => p.statusCode === 200).length}</span>
            <span style={{ color: 'var(--accent-orange)' }}>3xx: {pages.filter(p => (p.statusCode ?? 0) >= 300 && (p.statusCode ?? 0) < 400).length}</span>
            <span style={{ color: 'var(--accent-red)' }}>4xx/5xx: {pages.filter(p => (p.statusCode ?? 0) >= 400).length}</span>
            <span>Noindex: {pages.filter(p => !p.isIndexable).length}</span>
          </>
        ) : tab === 'links' ? (
          <>
            <span>Total: {links.length}</span>
            <span style={{ color: 'var(--accent-blue)' }}>Internal: {links.filter(l => l.isInternal).length}</span>
            <span style={{ color: 'var(--accent-orange)' }}>External: {links.filter(l => !l.isInternal).length}</span>
          </>
        ) : tab === 'serp' ? (
          <>
            <span>Results: {serpResults.length}</span>
            <span>Keywords: {new Set(serpResults.map(s => s.keyword)).size}</span>
            <span style={{ color: 'var(--accent-green)' }}>Top 3: {serpResults.filter(s => s.position <= 3).length}</span>
            <span style={{ color: 'var(--accent-blue)' }}>Top 10: {serpResults.filter(s => s.position <= 10).length}</span>
          </>
        ) : tab === 'redirects' ? (
          <>
            <span>Total: {redirects.length}</span>
            <span>Chains: {new Set(redirects.map(r => r.sourceUrl)).size}</span>
          </>
        ) : tab === 'hreflang' ? (
          <>
            <span>Total: {hreflang.length}</span>
            <span>Pages: {new Set(hreflang.map(h => h.pageUrl)).size}</span>
            <span>Languages: {new Set(hreflang.map(h => h.hreflang)).size}</span>
          </>
        ) : tab === 'duplicates' ? (
          <>
            <span>Groups: {duplicates.length}</span>
            <span style={{ color: 'var(--accent-red)' }}>Duplicate URLs: {duplicates.reduce((s, d) => s + d.urls.length, 0)}</span>
          </>
        ) : tab === 'extractions' ? (
          <>
            <span>Total: {customExtracts.length}</span>
            <span>Rules: {new Set(customExtracts.map(e => e.ruleName)).size}</span>
          </>
        ) : tab === 'map' ? (
          <>
            <span>Pages: {pages.length}</span>
          </>
        ) : tab === 'geo' ? (
          <>
            <span>Scored: {geoScores.length}</span>
            {geoScores.length > 0 && (
              <>
                <span style={{ color: 'var(--accent-green)' }}>Good (70+): {geoScores.filter(g => g.overallScore >= 70).length}</span>
                <span style={{ color: 'var(--accent-orange)' }}>Needs Work (40-69): {geoScores.filter(g => g.overallScore >= 40 && g.overallScore < 70).length}</span>
                <span style={{ color: 'var(--accent-red)' }}>Poor (&lt;40): {geoScores.filter(g => g.overallScore < 40).length}</span>
              </>
            )}
          </>
        ) : tab === 'perf' ? (
          <>
            <span>Scored: {perfScores.length}</span>
            {perfScores.length > 0 && (
              <>
                <span style={{ color: 'var(--accent-green)' }}>Good (70+): {perfScores.filter(p => p.overallScore >= 70).length}</span>
                <span style={{ color: 'var(--accent-orange)' }}>Needs Work (40-69): {perfScores.filter(p => p.overallScore >= 40 && p.overallScore < 70).length}</span>
                <span style={{ color: 'var(--accent-red)' }}>Poor (&lt;40): {perfScores.filter(p => p.overallScore < 40).length}</span>
              </>
            )}
          </>
        ) : tab === 'competitors' ? (
          <>
            <span>Results: {discoverResults.length}</span>
            {discoverResults.length > 0 && (
              <>
                <span style={{ color: 'var(--accent-green)' }}>High: {discoverResults.filter(r => r.relevanceScore >= 0.7).length}</span>
                <span style={{ color: 'var(--accent-orange)' }}>Medium: {discoverResults.filter(r => r.relevanceScore >= 0.4 && r.relevanceScore < 0.7).length}</span>
                <span>Domains: {new Set(discoverResults.map(r => { try { return new URL(r.link).hostname; } catch { return r.link; } })).size}</span>
              </>
            )}
          </>
        ) : tab === 'content_gaps' ? (
          <>
            <span>Topics: {contentGaps.length}</span>
            {contentGaps.length > 0 && (
              <>
                <span style={{ color: 'var(--accent-red)' }}>High: {contentGaps.filter(g => g.gapSeverity === 'high').length}</span>
                <span style={{ color: 'var(--accent-orange)' }}>Medium: {contentGaps.filter(g => g.gapSeverity === 'medium').length}</span>
                <span style={{ color: 'var(--accent-green)' }}>Covered: {contentGaps.filter(g => g.gapSeverity === 'none').length}</span>
              </>
            )}
          </>
        ) : (
          <>
            <span>Total: {images.length}</span>
            <span style={{ color: 'var(--accent-red)' }}>Missing alt: {images.filter(i => !i.altText).length}</span>
          </>
        )}
        {filteredPages.length !== pages.length && tab !== 'links' && tab !== 'images' && (
          <span>Showing: {filteredPages.length}</span>
        )}
      </div>

      {/* Bulk Export Modal */}
      {showExportModal && crawlId && (
        <ExportModal crawlId={crawlId} onClose={() => setShowExportModal(false)} showToast={showToast} />
      )}

      {/* Right-click context menu for page rows */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 300,
            background: 'var(--bg-secondary)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: 4, minWidth: 180,
            boxShadow: 'var(--shadow)',
          }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ padding: '4px 8px', fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 250 }}>
            {contextMenu.url}
          </div>
          {(['inlinks', 'outlinks', 'images'] as const).map(type => (
            <div key={type} style={{ display: 'flex' }}>
              <button
                className="btn-ghost"
                style={{ flex: 1, textAlign: 'left', fontSize: 12, padding: '4px 8px', borderRadius: 0 }}
                onClick={() => handlePerUrlExport(contextMenu.url, type, 'csv')}
              >
                Export {type} (CSV)
              </button>
              <button
                className="btn-ghost"
                style={{ fontSize: 12, padding: '4px 8px', borderRadius: 0, color: 'var(--text-muted)' }}
                onClick={() => handlePerUrlExport(contextMenu.url, type, 'json')}
              >
                JSON
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
