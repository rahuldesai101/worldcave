import { createRelayHandler } from './_relay.js';
import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { jsonResponse } from './_json-response.js';

export const config = { runtime: 'edge' };

// In-memory cache (per edge instance) — 60s
let _cache = { key: '', body: null, expires: 0 };

// Direct fallback: hit OpenSky public REST API when no relay is configured.
// Same query params (lamin/lamax/lomin/lomax) the client already sends.
async function fallback(req, corsHeaders) {
  try {
    const url = new URL(req.url);
    const qs = url.searchParams.toString();
    const upstream = `https://opensky-network.org/api/states/all${qs ? `?${qs}` : ''}`;
    const now = Date.now();
    if (_cache.key === qs && _cache.body && now < _cache.expires) {
      return new Response(_cache.body, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
          'X-Cache': 'HIT',
          ...corsHeaders,
        },
      });
    }
    const headers = { Accept: 'application/json', 'User-Agent': 'WorldMonitor/1.0' };
    const clientId = process.env.OPENSKY_CLIENT_ID;
    const clientSecret = process.env.OPENSKY_CLIENT_SECRET;
    if (clientId && clientSecret) {
      const basic = btoa(`${clientId}:${clientSecret}`);
      headers.Authorization = `Basic ${basic}`;
    }
    const resp = await fetch(upstream, { headers, signal: AbortSignal.timeout(15_000) });
    const body = await resp.text();
    if (resp.ok) {
      _cache = { key: qs, body, expires: now + 60_000 };
    }
    return new Response(body, {
      status: resp.status,
      headers: {
        'Content-Type': resp.headers.get('content-type') || 'application/json',
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120, stale-if-error=300',
        'X-Cache': 'MISS',
        ...corsHeaders,
      },
    });
  } catch (err) {
    return jsonResponse({ error: 'OpenSky upstream failed', details: String(err?.message || err) }, 502, corsHeaders);
  }
}

export default createRelayHandler({
  relayPath: '/opensky',
  timeout: 20000,
  fallback,
  cacheHeaders: () => ({
    'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=60, stale-if-error=300',
  }),
  extraHeaders: (response) => {
    const xCache = response.headers.get('x-cache');
    return xCache ? { 'X-Cache': xCache } : {};
  },
});
