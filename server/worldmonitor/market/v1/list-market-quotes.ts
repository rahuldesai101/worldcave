/**
 * RPC: ListMarketQuotes -- reads seeded stock/index data from Railway seed cache.
 * All external Finnhub/Yahoo Finance calls happen in ais-relay.cjs on Railway.
 */

import type {
  ServerContext,
  ListMarketQuotesRequest,
  ListMarketQuotesResponse,
  MarketQuote,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import { parseStringArray } from './_shared';
import { getCachedJson, cachedFetchJson } from '../../../_shared/redis';
import stocksConfig from '../../../../shared/stocks.json' assert { type: 'json' };

const BOOTSTRAP_KEY = 'market:stocks-bootstrap:v1';
const LIVE_FALLBACK_KEY = 'market:stocks-finnhub-live:v1';
const LIVE_TTL = 60; // 60s — respect Finnhub free-tier rate limits

// Curated subset (free-tier Finnhub doesn't return index symbols like ^GSPC,
// so we ship a smaller US-equity list as a live fallback).
const FINNHUB_FALLBACK_SYMBOLS = (stocksConfig as { symbols: Array<{ symbol: string; name: string; display: string }> })
  .symbols
  .filter((s) => /^[A-Z.\-]+$/.test(s.symbol) && !s.symbol.startsWith('^') && !s.symbol.endsWith('.NS'))
  .slice(0, 24);

async function fetchFinnhubLive(): Promise<ListMarketQuotesResponse | null> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return null;

  const results = await Promise.allSettled(
    FINNHUB_FALLBACK_SYMBOLS.map(async (meta) => {
      const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(meta.symbol)}`;
      const resp = await fetch(url, {
        headers: { 'X-Finnhub-Token': apiKey, 'User-Agent': 'WorldMonitor/1.0' },
        signal: AbortSignal.timeout(6_000),
      });
      if (!resp.ok) throw new Error(`finnhub ${resp.status}`);
      const data = await resp.json() as { c?: number; dp?: number; h?: number; l?: number };
      if (!data || (data.c === 0 && data.h === 0 && data.l === 0)) throw new Error('empty');
      return {
        symbol: meta.symbol,
        name: meta.name,
        display: meta.display,
        price: data.c ?? 0,
        change: data.dp ?? 0,
        sparkline: [],
      } as MarketQuote;
    }),
  );

  const quotes: MarketQuote[] = [];
  for (const r of results) if (r.status === 'fulfilled') quotes.push(r.value);
  if (!quotes.length) return null;
  return { quotes, finnhubSkipped: false, skipReason: '', rateLimited: false };
}

export async function listMarketQuotes(
  _ctx: ServerContext,
  req: ListMarketQuotesRequest,
): Promise<ListMarketQuotesResponse> {
  const parsedSymbols = parseStringArray(req.symbols);

  try {
    const bootstrap = await getCachedJson(BOOTSTRAP_KEY, true) as ListMarketQuotesResponse | null;
    let source: ListMarketQuotesResponse | null = bootstrap;

    // Fallback: no seed data (no Railway worker running) → call Finnhub directly.
    if (!source?.quotes?.length) {
      source = await cachedFetchJson<ListMarketQuotesResponse>(
        LIVE_FALLBACK_KEY,
        LIVE_TTL,
        fetchFinnhubLive,
      );
    }

    if (!source?.quotes?.length) {
      return { quotes: [], finnhubSkipped: false, skipReason: '', rateLimited: false };
    }

    if (parsedSymbols.length > 0) {
      const symbolSet = new Set(parsedSymbols);
      const filtered = source.quotes.filter((q: MarketQuote) => symbolSet.has(q.symbol));
      return { quotes: filtered, finnhubSkipped: false, skipReason: '', rateLimited: false };
    }

    return source;
  } catch {
    return { quotes: [], finnhubSkipped: false, skipReason: '', rateLimited: false };
  }
}
