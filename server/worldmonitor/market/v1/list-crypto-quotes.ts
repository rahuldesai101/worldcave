/**
 * RPC: ListCryptoQuotes -- reads seeded crypto data from Railway seed cache.
 * All external CoinGecko calls happen in ais-relay.cjs on Railway.
 */

import type {
  ServerContext,
  ListCryptoQuotesRequest,
  ListCryptoQuotesResponse,
  CryptoQuote,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import { CRYPTO_META, parseStringArray } from './_shared';
import { getCachedJson, cachedFetchJson } from '../../../_shared/redis';

const SEED_CACHE_KEY = 'market:crypto:v1';
const LIVE_CACHE_KEY = 'market:crypto-coingecko-live:v1';
const LIVE_TTL = 60; // CoinGecko free tier: ~10-30 req/min — 60s cache is safe.

const SYMBOL_TO_ID = new Map(Object.entries(CRYPTO_META).map(([id, m]) => [m.symbol, id]));

async function fetchCoingeckoLive(): Promise<{ quotes: CryptoQuote[] } | null> {
  const ids = Object.keys(CRYPTO_META);
  if (ids.length === 0) return null;
  const url =
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd` +
    `&ids=${encodeURIComponent(ids.join(','))}` +
    `&order=market_cap_desc&per_page=${ids.length}&page=1` +
    `&sparkline=true&price_change_percentage=24h,7d`;
  const apiKey = process.env.COINGECKO_API_KEY;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'WorldMonitor/1.0',
  };
  if (apiKey) headers['x-cg-demo-api-key'] = apiKey;
  const resp = await fetch(url, { headers, signal: AbortSignal.timeout(8_000) });
  if (!resp.ok) return null;
  const data = await resp.json() as Array<{
    id: string;
    current_price?: number;
    price_change_percentage_24h?: number;
    price_change_percentage_7d_in_currency?: number;
    sparkline_in_7d?: { price?: number[] };
  }>;
  if (!Array.isArray(data) || data.length === 0) return null;
  const quotes: CryptoQuote[] = data
    .map((c) => {
      const meta = CRYPTO_META[c.id];
      if (!meta) return null;
      const raw = c.sparkline_in_7d?.price ?? [];
      // Downsample to ~24 points to keep payload small.
      const stride = Math.max(1, Math.floor(raw.length / 24));
      const sparkline: number[] = [];
      for (let i = 0; i < raw.length; i += stride) sparkline.push(raw[i]!);
      return {
        name: meta.name,
        symbol: meta.symbol,
        price: c.current_price ?? 0,
        change: c.price_change_percentage_24h ?? 0,
        change7d: c.price_change_percentage_7d_in_currency ?? 0,
        sparkline,
      } as CryptoQuote;
    })
    .filter((q): q is CryptoQuote => q !== null);
  if (!quotes.length) return null;
  return { quotes };
}

export async function listCryptoQuotes(
  _ctx: ServerContext,
  req: ListCryptoQuotesRequest,
): Promise<ListCryptoQuotesResponse> {
  const parsedIds = parseStringArray(req.ids);
  const ids = parsedIds.length > 0 ? parsedIds : Object.keys(CRYPTO_META);

  try {
    let seedData = await getCachedJson(SEED_CACHE_KEY, true) as { quotes: CryptoQuote[] } | null;

    // Fallback: no Railway seeder → call CoinGecko free API directly.
    if (!seedData?.quotes?.length) {
      seedData = await cachedFetchJson<{ quotes: CryptoQuote[] }>(
        LIVE_CACHE_KEY,
        LIVE_TTL,
        fetchCoingeckoLive,
      );
    }

    if (!seedData?.quotes?.length) return { quotes: [] };

    const allIds = new Set(ids);
    const filtered = allIds.size === 0
      ? seedData.quotes
      : seedData.quotes.filter((q) => allIds.has(SYMBOL_TO_ID.get(q.symbol) ?? ''));

    return { quotes: filtered };
  } catch {
    return { quotes: [] };
  }
}
