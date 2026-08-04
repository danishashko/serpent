import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Tiny in-process HTTP server serving a fixture mini-site for crawler tests.
 * Pages link to each other so the spider has something to crawl.
 *
 * Routes:
 *   /        → home, links to /about, /products, /contact, /broken
 *   /about   → about page
 *   /products → product index, links to /products/a, /products/b
 *   /products/a, /products/b → leaf product pages with image
 *   /contact → contact page
 *   /broken  → returns 404
 *   /robots.txt → allow all
 */
export interface SiteServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

const page = (title: string, body: string, extraHead = ''): string => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <meta name="description" content="Fixture page: ${title}" />
  <link rel="canonical" href="/" />
  ${extraHead}
</head>
<body>
  <h1>${title}</h1>
  ${body}
</body>
</html>`;

const routes: Record<string, { status: number; body: string; type?: string }> = {
  '/': {
    status: 200,
    body: page('Home', `
      <p>Welcome to the fixture site.</p>
      <ul>
        <li><a href="/about">About</a></li>
        <li><a href="/products">Products</a></li>
        <li><a href="/contact">Contact</a></li>
        <li><a href="/broken">Broken link</a></li>
      </ul>
    `),
  },
  '/about': {
    status: 200,
    body: page('About Us', '<p>About the fixture site.</p><p><a href="/">Home</a></p>'),
  },
  '/products': {
    status: 200,
    body: page('Products', `
      <ul>
        <li><a href="/products/a">Product A</a></li>
        <li><a href="/products/b">Product B</a></li>
      </ul>
      <p><a href="/">Home</a></p>
    `),
  },
  '/products/a': {
    status: 200,
    body: page('Product A', '<img src="/img/a.png" alt="Product A" /><p><a href="/products">Back</a></p>'),
  },
  '/products/b': {
    status: 200,
    body: page('Product B', '<img src="/img/b.png" alt="" /><p><a href="/products">Back</a></p>'),
  },
  '/contact': {
    status: 200,
    body: page('Contact', '<p>Email us.</p><p><a href="/">Home</a></p>'),
  },
  '/broken': {
    status: 404,
    body: page('Not Found', '<p>404</p>'),
  },
  // Deliberately NOT linked from '/': specs that assert crawl totals would
  // otherwise change meaning. Seed a crawl here directly to reach it.
  '/uncrawlable': {
    status: 200,
    body: page('Uncrawlable links', `
      <a href="/about">A normal link</a>
      <a href="/contact" onclick="track()">Normal link that also tracks</a>
      <div href="/div-href-target">href on a div</div>
      <span href="/span-href-target">href on a span</span>
      <a href="javascript:goTo('products')">javascript href</a>
      <a onclick="goto('/onclick-target')">onclick with no href</a>
      <a href="#" onclick="nav()">onclick with hash href</a>
      <a href="mailto:a@b.com">email</a>
      <a href="tel:+1234">phone</a>
      <a href="/huge">A very large page</a>
    `),
  },
  '/robots.txt': {
    status: 200,
    body: 'User-agent: *\nAllow: /\n',
    type: 'text/plain',
  },
  '/sitemap.xml': {
    status: 200,
    body: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>__ORIGIN__/</loc></url>
  <url><loc>__ORIGIN__/about</loc></url>
  <url><loc>__ORIGIN__/products</loc></url>
  <url><loc>__ORIGIN__/products/a</loc></url>
  <url><loc>__ORIGIN__/products/b</loc></url>
  <url><loc>__ORIGIN__/contact</loc></url>
  <url><loc>__ORIGIN__/orphan-from-sitemap</loc></url>
</urlset>`,
    type: 'application/xml; charset=utf-8',
  },
};

export async function startSiteServer(): Promise<SiteServer> {
  const server: Server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];

    // Just over Googlebot's 2MB HTML cap. Generated per request rather than
    // held in `routes` so every spec run doesn't carry 2MB of dead string.
    if (url === '/huge') {
      const body = page('Huge page', `<p>${'x'.repeat(2 * 1024 * 1024 + 50_000)}</p>`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
      return;
    }

    // Stub 1x1 transparent PNG for any /img/* request
    if (url.startsWith('/img/')) {
      const png = Buffer.from(
        '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
        '0000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082',
        'hex'
      );
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length });
      res.end(png);
      return;
    }

    const route = routes[url];
    if (!route) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end(page('Not Found', '<p>404</p>'));
      return;
    }
    const { port } = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${port}`;
    const body = route.body.includes('__ORIGIN__') ? route.body.split('__ORIGIN__').join(origin) : route.body;
    res.writeHead(route.status, { 'Content-Type': route.type ?? 'text/html; charset=utf-8' });
    res.end(body);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
