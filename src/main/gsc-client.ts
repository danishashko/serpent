import { shell } from 'electron';
import http from 'http';
import { URL } from 'url';
import keytar from 'keytar';
import type { GSCRow, GSCData } from '../types';

const SERVICE_NAME = 'ghostfrog-gsc';
const ACCOUNT_NAME = 'oauth-tokens';

// Users must provide their own Google OAuth client ID/secret via config
// These are placeholders — real values come from getConfig/setConfig
let clientId = '';
let clientSecret = '';
const REDIRECT_PORT = 48321;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
const SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly'];

interface TokenData {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
}

let cachedTokens: TokenData | null = null;

export function setGSCCredentials(id: string, secret: string): void {
  clientId = id;
  clientSecret = secret;
}

async function saveTokens(tokens: TokenData): Promise<void> {
  cachedTokens = tokens;
  await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, JSON.stringify(tokens));
}

async function loadTokens(): Promise<TokenData | null> {
  if (cachedTokens) return cachedTokens;
  const stored = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
  if (stored) {
    cachedTokens = JSON.parse(stored);
    return cachedTokens;
  }
  return null;
}

export async function clearGSCTokens(): Promise<void> {
  cachedTokens = null;
  await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME);
}

export async function isGSCConnected(): Promise<boolean> {
  const tokens = await loadTokens();
  return !!tokens?.refresh_token;
}

async function refreshAccessToken(): Promise<string> {
  const tokens = await loadTokens();
  if (!tokens?.refresh_token) throw new Error('Not connected to GSC');

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: tokens.refresh_token,
    grant_type: 'refresh_token',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  const data = await res.json();

  const newTokens: TokenData = {
    access_token: data.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  await saveTokens(newTokens);
  return newTokens.access_token;
}

async function getAccessToken(): Promise<string> {
  const tokens = await loadTokens();
  if (!tokens) throw new Error('Not connected to GSC');
  if (tokens.expires_at > Date.now() + 60000) return tokens.access_token;
  return refreshAccessToken();
}

export function connectGSC(): Promise<boolean> {
  if (!clientId || !clientSecret) {
    throw new Error('GSC OAuth credentials not configured. Set gsc_client_id and gsc_client_secret in Settings.');
  }

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${REDIRECT_PORT}`);
        if (url.pathname !== '/callback') {
          res.writeHead(404);
          res.end();
          return;
        }

        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error || !code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><h2>Authorization failed.</h2><p>You can close this tab.</p></body></html>');
          server.close();
          resolve(false);
          return;
        }

        // Exchange code for tokens
        const body = new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: REDIRECT_URI,
          grant_type: 'authorization_code',
        });

        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });

        if (!tokenRes.ok) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><h2>Token exchange failed.</h2></body></html>');
          server.close();
          resolve(false);
          return;
        }

        const data = await tokenRes.json();
        await saveTokens({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
        });

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h2>Connected to Google Search Console!</h2><p>You can close this tab.</p></body></html>');
        server.close();
        resolve(true);
      } catch (err) {
        res.writeHead(500);
        res.end('Internal error');
        server.close();
        reject(err);
      }
    });

    server.listen(REDIRECT_PORT, '127.0.0.1', () => {
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', SCOPES.join(' '));
      authUrl.searchParams.set('access_type', 'offline');
      authUrl.searchParams.set('prompt', 'consent');

      shell.openExternal(authUrl.toString());
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      server.close();
      resolve(false);
    }, 120000);
  });
}

export async function getGSCSites(): Promise<string[]> {
  const token = await getAccessToken();
  const res = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GSC API error: ${res.status}`);
  const data = await res.json();
  return (data.siteEntry ?? []).map((s: { siteUrl: string }) => s.siteUrl);
}

export async function fetchGSCData(siteUrl: string, days = 28): Promise<GSCData> {
  const token = await getAccessToken();
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const body = {
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
    dimensions: ['page'],
    rowLimit: 5000,
  };

  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) throw new Error(`GSC query failed: ${res.status}`);
  const data = await res.json();

  const rows: GSCRow[] = (data.rows ?? []).map((r: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }) => ({
    url: r.keys[0],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: Math.round(r.ctr * 10000) / 100,
    position: Math.round(r.position * 10) / 10,
  }));

  return {
    rows,
    siteUrl,
    lastFetched: new Date().toISOString(),
  };
}

export function findOrphanPages(gscRows: GSCRow[], crawledUrls: Set<string>): GSCRow[] {
  return gscRows.filter(r => !crawledUrls.has(r.url) && r.impressions > 0);
}

export function findRankingOpportunities(gscRows: GSCRow[]): GSCRow[] {
  return gscRows.filter(r => r.position >= 11 && r.position <= 20).sort((a, b) => b.impressions - a.impressions);
}
