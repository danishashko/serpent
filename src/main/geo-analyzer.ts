import { PageData, LinkData, ImageData, GEOScore, GEOIssue, GEOCategory, IssueSeverity } from '../types/index';

interface GEOInput {
  page: PageData;
  links: LinkData[];
  images: ImageData[];
}

function addIssue(issues: GEOIssue[], category: GEOCategory, severity: IssueSeverity, message: string, recommendation: string): void {
  issues.push({ category, severity, message, recommendation });
}

function scoreEntityClarity(input: GEOInput): { score: number; issues: GEOIssue[] } {
  const { page } = input;
  const issues: GEOIssue[] = [];
  let points = 0;
  const max = 100;

  // H1 present and meaningful (25 pts)
  if (page.h1 && page.h1.trim().length > 3) {
    points += 25;
  } else {
    addIssue(issues, 'entity', 'critical', 'Missing or empty H1 tag', 'Add a clear, descriptive H1 that names the main entity or topic of the page');
  }

  // Schema.org structured data (25 pts)
  if (page.hasStructuredData && page.schemaTypes) {
    points += 25;
    // Bonus: has Organization or Person schema
    const types = page.schemaTypes.toLowerCase();
    if (types.includes('organization') || types.includes('person') || types.includes('localbusiness')) {
      // Already max for this check
    }
  } else {
    addIssue(issues, 'entity', 'critical', 'No structured data (Schema.org) found', 'Add JSON-LD structured data describing the main entity (Organization, Person, Product, Article, etc.)');
  }

  // Open Graph tags (20 pts)
  if (page.ogTitle && page.ogDescription) {
    points += 20;
  } else if (page.ogTitle || page.ogDescription) {
    points += 10;
    addIssue(issues, 'entity', 'warning', 'Incomplete Open Graph tags', 'Add both og:title and og:description to clearly identify the entity for social/AI platforms');
  } else {
    addIssue(issues, 'entity', 'warning', 'No Open Graph tags found', 'Add og:title, og:description, and og:image to help AI platforms identify your entity');
  }

  // Meta description present and descriptive (15 pts)
  if (page.metaDescription && page.metaDescription.length >= 50) {
    points += 15;
  } else if (page.metaDescription) {
    points += 7;
    addIssue(issues, 'entity', 'info', 'Meta description is too short for entity clarity', 'Write a meta description of 120-160 characters that clearly describes the entity');
  } else {
    addIssue(issues, 'entity', 'warning', 'Missing meta description', 'Add a meta description that clearly identifies what the page is about');
  }

  // Title tag present and descriptive (15 pts)
  if (page.title && page.title.length >= 10 && page.title.length <= 70) {
    points += 15;
  } else if (page.title) {
    points += 8;
    addIssue(issues, 'entity', 'info', `Title length (${page.titleLength || 0} chars) is not optimal`, 'Keep title between 30-60 characters for clarity');
  } else {
    addIssue(issues, 'entity', 'critical', 'Missing title tag', 'Add a descriptive title tag');
  }

  return { score: Math.min(max, points), issues };
}

function scoreAnswerReadiness(input: GEOInput): { score: number; issues: GEOIssue[] } {
  const { page } = input;
  const issues: GEOIssue[] = [];
  let points = 0;

  // FAQ or HowTo schema (25 pts)
  if (page.schemaTypes) {
    const types = page.schemaTypes.toLowerCase();
    if (types.includes('faqpage') || types.includes('howto') || types.includes('qapage')) {
      points += 25;
    } else {
      addIssue(issues, 'answer', 'opportunity', 'No FAQ/HowTo/QA structured data', 'Add FAQPage or HowTo schema to make content directly answerable by AI');
    }
  } else {
    addIssue(issues, 'answer', 'opportunity', 'No structured data for answer formatting', 'Add FAQPage or HowTo schema markup');
  }

  // Sufficient heading structure (20 pts)
  if (page.h2Count >= 3) {
    points += 20;
  } else if (page.h2Count >= 1) {
    points += 10;
    addIssue(issues, 'answer', 'info', `Only ${page.h2Count} H2 heading(s) found`, 'Use 3+ H2 subheadings to break content into clear, answerable sections');
  } else {
    addIssue(issues, 'answer', 'warning', 'No H2 subheadings found', 'Add H2 headings to organize content into scannable, answer-ready sections');
  }

  // Word count depth (20 pts) — 300+ words shows topic coverage
  if (page.wordCount && page.wordCount >= 800) {
    points += 20;
  } else if (page.wordCount && page.wordCount >= 300) {
    points += 12;
    addIssue(issues, 'answer', 'info', `Word count (${page.wordCount}) is moderate`, 'Aim for 800+ words for comprehensive topic coverage that AI can cite');
  } else {
    addIssue(issues, 'answer', 'warning', `Thin content: ${page.wordCount || 0} words`, 'Add more substantive content (800+ words) to provide depth for AI citation');
  }

  // Images present (15 pts)
  if (page.imageCount >= 2) {
    points += 15;
  } else if (page.imageCount >= 1) {
    points += 8;
    addIssue(issues, 'answer', 'info', 'Only 1 image on page', 'Add more relevant images to enhance answer quality');
  } else {
    addIssue(issues, 'answer', 'info', 'No images found on page', 'Add relevant images to support your content');
  }

  // Text-to-HTML ratio (20 pts)
  if (page.textRatio !== null && page.textRatio >= 0.15) {
    points += 20;
  } else if (page.textRatio !== null && page.textRatio >= 0.05) {
    points += 10;
    addIssue(issues, 'answer', 'info', `Low text ratio (${(page.textRatio * 100).toFixed(1)}%)`, 'Increase text content relative to HTML — aim for 15%+ text ratio');
  } else if (page.textRatio !== null) {
    addIssue(issues, 'answer', 'warning', `Very low text ratio (${(page.textRatio * 100).toFixed(1)}%)`, 'Page is mostly markup. Add more textual content');
  }

  return { score: Math.min(100, points), issues };
}

function scoreCitationSignals(input: GEOInput): { score: number; issues: GEOIssue[] } {
  const { page, links } = input;
  const issues: GEOIssue[] = [];
  let points = 0;

  // Author/byline via schema (25 pts)
  if (page.schemaTypes) {
    const types = page.schemaTypes.toLowerCase();
    if (types.includes('article') || types.includes('blogposting') || types.includes('newsarticle')) {
      points += 25;
    } else {
      addIssue(issues, 'citation', 'opportunity', 'No Article/BlogPosting schema', 'Add Article or BlogPosting schema with author, datePublished fields for citation credibility');
    }
  } else {
    addIssue(issues, 'citation', 'warning', 'Missing schema markup for citation signals', 'Add Article schema with author and date fields');
  }

  // Canonical URL set (15 pts)
  if (page.canonicalUrl) {
    points += 15;
  } else {
    addIssue(issues, 'citation', 'warning', 'No canonical URL specified', 'Set a canonical URL to establish this as the authoritative source');
  }

  // External outbound links (credibility signals) (20 pts)
  const externalLinks = links.filter(l => l.sourceUrl === page.url && !l.isInternal);
  if (externalLinks.length >= 3) {
    points += 20;
  } else if (externalLinks.length >= 1) {
    points += 10;
    addIssue(issues, 'citation', 'info', `Only ${externalLinks.length} external link(s)`, 'Add references to authoritative external sources (3+) to boost citation credibility');
  } else {
    addIssue(issues, 'citation', 'warning', 'No external outbound links', 'Link to authoritative sources to demonstrate research depth');
  }

  // Content depth (word count 1000+) (20 pts)
  if (page.wordCount && page.wordCount >= 1500) {
    points += 20;
  } else if (page.wordCount && page.wordCount >= 800) {
    points += 12;
  } else {
    addIssue(issues, 'citation', 'info', 'Content may lack depth for citation', 'Longer, more detailed content is more likely to be cited by AI');
  }

  // Indexable (20 pts)
  if (page.isIndexable) {
    points += 20;
  } else {
    addIssue(issues, 'citation', 'critical', 'Page is not indexable', 'Remove noindex directives — AI cannot cite pages it cannot find');
  }

  return { score: Math.min(100, points), issues };
}

function scoreStructuredDataCompleteness(input: GEOInput): { score: number; issues: GEOIssue[] } {
  const { page } = input;
  const issues: GEOIssue[] = [];
  let points = 0;

  // Any structured data at all (30 pts)
  if (page.hasStructuredData) {
    points += 30;
  } else {
    addIssue(issues, 'schema', 'critical', 'No structured data found', 'Add at least one JSON-LD schema type relevant to your content');
    return { score: 0, issues };
  }

  // Multiple schema types (20 pts)
  const typeCount = page.schemaTypes ? page.schemaTypes.split(',').filter(Boolean).length : 0;
  if (typeCount >= 3) {
    points += 20;
  } else if (typeCount >= 2) {
    points += 12;
  } else {
    addIssue(issues, 'schema', 'info', `Only ${typeCount} schema type(s) detected`, 'Add additional schema types (e.g. BreadcrumbList, Organization) for richer AI understanding');
  }

  // BreadcrumbList (15 pts)
  const types = (page.schemaTypes || '').toLowerCase();
  if (types.includes('breadcrumblist')) {
    points += 15;
  } else {
    addIssue(issues, 'schema', 'info', 'No BreadcrumbList schema', 'Add BreadcrumbList to show site hierarchy');
  }

  // Organization or Person (15 pts)
  if (types.includes('organization') || types.includes('person') || types.includes('localbusiness')) {
    points += 15;
  } else {
    addIssue(issues, 'schema', 'opportunity', 'No Organization/Person schema', 'Add Organization or Person schema to establish entity identity');
  }

  // Content-type schema — Article, Product, etc. (20 pts)
  if (types.includes('article') || types.includes('product') || types.includes('blogposting') || types.includes('faqpage') || types.includes('howto') || types.includes('recipe') || types.includes('event')) {
    points += 20;
  } else {
    addIssue(issues, 'schema', 'opportunity', 'No content-type schema (Article, Product, etc.)', 'Add a content-specific schema type for better AI understanding');
  }

  return { score: Math.min(100, points), issues };
}

export function analyzeGEOScore(input: GEOInput): GEOScore {
  const entity = scoreEntityClarity(input);
  const answer = scoreAnswerReadiness(input);
  const citation = scoreCitationSignals(input);
  const schema = scoreStructuredDataCompleteness(input);

  const overallScore = Math.round(
    (entity.score * 0.25 + answer.score * 0.25 + citation.score * 0.25 + schema.score * 0.25)
  );

  const allIssues = [...entity.issues, ...answer.issues, ...citation.issues, ...schema.issues];

  return {
    pageId: input.page.id,
    crawlId: input.page.crawlId,
    url: input.page.url,
    overallScore,
    entityClarity: Math.round(entity.score),
    answerReadiness: Math.round(answer.score),
    citationSignals: Math.round(citation.score),
    structuredDataCompleteness: Math.round(schema.score),
    issues: allIssues,
    analyzedAt: new Date().toISOString(),
  };
}

export function analyzeGEOBatch(pages: PageData[], links: LinkData[], images: ImageData[]): GEOScore[] {
  const linksByPage = new Map<string, LinkData[]>();
  for (const link of links) {
    const existing = linksByPage.get(link.sourceUrl) || [];
    existing.push(link);
    linksByPage.set(link.sourceUrl, existing);
  }

  const imagesByPage = new Map<string, ImageData[]>();
  for (const img of images) {
    const existing = imagesByPage.get(img.pageUrl) || [];
    existing.push(img);
    imagesByPage.set(img.pageUrl, existing);
  }

  return pages.map(page => analyzeGEOScore({
    page,
    links: linksByPage.get(page.url) || [],
    images: imagesByPage.get(page.url) || [],
  }));
}
