/**
 * Bright Data engine plumbing: the Web Unlocker request (timeout floor, one
 * retry) and the Browser API login built from a zone name.
 * Mocks axios so we never hit the network.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import type { MockedFunction } from 'vitest';
import type axiosType from 'axios';

vi.mock('axios');

type Engines = typeof import('../main/crawler-brightdata');
let postUnlockerRequest: Engines['postUnlockerRequest'];
let resolveBrowserAuth: Engines['resolveBrowserAuth'];
let BD_UNLOCKER_MIN_TIMEOUT_MS: number;
let axiosPost: MockedFunction<typeof axiosType.post>;
let axiosGet: MockedFunction<typeof axiosType.get>;

// The suite shares one module cache. If an earlier file already loaded
// crawler-brightdata, that copy is bound to the real axios and would send these
// requests to the network. Load a fresh copy bound to the mock.
beforeAll(async () => {
  vi.resetModules();
  const axios = (await import('axios')).default;
  axiosPost = vi.mocked(axios.post);
  axiosGet = vi.mocked(axios.get);
  ({ postUnlockerRequest, resolveBrowserAuth, BD_UNLOCKER_MIN_TIMEOUT_MS } = await import('../main/crawler-brightdata'));
});

beforeEach(() => {
  axiosPost.mockReset();
  axiosGet.mockReset();
});

describe('postUnlockerRequest', () => {
  it('gives a protected site at least 90 seconds', () => {
    expect(BD_UNLOCKER_MIN_TIMEOUT_MS).toBeGreaterThanOrEqual(90_000);
  });

  it('sends the zone, the URL and the timeout it was given', async () => {
    axiosPost.mockResolvedValueOnce({ status: 200, data: { status_code: 200, body: '<html></html>' } } as never);
    const res = await postUnlockerRequest('KEY', 'web_unlocker1', 'https://a.test/', 95_000);
    expect(res.status).toBe(200);
    expect(axiosPost).toHaveBeenCalledTimes(1);
    const [endpoint, body, options] = axiosPost.mock.calls[0];
    expect(endpoint).toBe('https://api.brightdata.com/request');
    expect(body).toMatchObject({ zone: 'web_unlocker1', url: 'https://a.test/', format: 'json' });
    expect(options).toMatchObject({ timeout: 95_000, headers: { Authorization: 'Bearer KEY' } });
  });

  it('retries once when the request itself fails', async () => {
    axiosPost.mockRejectedValueOnce(new Error('timeout of 90000ms exceeded'));
    axiosPost.mockResolvedValueOnce({ status: 200, data: { status_code: 200, body: 'ok' } } as never);
    const res = await postUnlockerRequest('KEY', 'z', 'https://a.test/', 90_000);
    expect(res.status).toBe(200);
    expect(axiosPost).toHaveBeenCalledTimes(2);
  });

  it('gives up after the second failure', async () => {
    axiosPost.mockRejectedValue(new Error('socket hang up'));
    await expect(postUnlockerRequest('KEY', 'z', 'https://a.test/', 90_000)).rejects.toThrow('socket hang up');
    expect(axiosPost).toHaveBeenCalledTimes(2);
  });

  it('does not retry an answer from Bright Data, even a failed one', async () => {
    axiosPost.mockResolvedValueOnce({ status: 502, data: 'bad gateway' } as never);
    const res = await postUnlockerRequest('KEY', 'z', 'https://a.test/', 90_000);
    expect(res.status).toBe(502);
    expect(axiosPost).toHaveBeenCalledTimes(1);
  });
});

describe('resolveBrowserAuth', () => {
  function mockAccount(customer: string | null, zones: Record<string, string>) {
    axiosGet.mockImplementation((async (url: string) => {
      if (url.endsWith('/status')) {
        return customer ? { status: 200, data: { customer } } : { status: 401, data: 'Unauthorized' };
      }
      const zone = new URL(url).searchParams.get('zone') ?? '';
      return zones[zone] ? { status: 200, data: { password: [zones[zone]] } } : { status: 422, data: 'Unknown zone' };
    }) as never);
  }

  it('passes a full USER:PASS login through untouched, with no API call', async () => {
    const res = await resolveBrowserAuth('  brd-customer-hl_1-zone-b:secret  ', null);
    expect(res).toEqual({ auth: 'brd-customer-hl_1-zone-b:secret' });
    expect(axiosGet).not.toHaveBeenCalled();
  });

  it('builds the login from a zone name and the API key', async () => {
    mockAccount('hl_abc12345', { browser_one: 'zonepw' });
    const res = await resolveBrowserAuth('browser_one', 'KEY-ONE');
    expect(res).toEqual({ auth: 'brd-customer-hl_abc12345-zone-browser_one:zonepw' });
  });

  it('asks for the API key when a zone name has none to work with', async () => {
    const res = await resolveBrowserAuth('browser_one', null);
    expect(res).toHaveProperty('error');
    expect((res as { error: string }).error).toMatch(/API key/);
    expect(axiosGet).not.toHaveBeenCalled();
  });

  it('names the zone when the account has no such zone', async () => {
    mockAccount('hl_abc12345', {});
    const res = await resolveBrowserAuth('missing_zone', 'KEY-TWO');
    expect((res as { error: string }).error).toContain('"missing_zone"');
  });

  it('reports a rejected API key', async () => {
    mockAccount(null, {});
    const res = await resolveBrowserAuth('browser_one', 'KEY-BAD');
    expect((res as { error: string }).error).toMatch(/did not accept the API key/);
  });

  it('rejects text that is neither a zone name nor a login', async () => {
    const res = await resolveBrowserAuth('not a zone!', 'KEY');
    expect(res).toHaveProperty('error');
    expect(axiosGet).not.toHaveBeenCalled();
  });
});
