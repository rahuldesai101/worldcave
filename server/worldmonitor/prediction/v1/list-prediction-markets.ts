/**
 * ListPredictionMarkets RPC -- reads Railway-seeded prediction market data
 * from Redis. All external API calls (Polymarket Gamma, Kalshi) happen on
 * Railway seed scripts, never on Vercel.
 */

import {
  type MarketSource,
  type PredictionServiceHandler,
  type ServerContext,
  type ListPredictionMarketsRequest,
  type ListPredictionMarketsResponse,
  type PredictionMarket,
} from '../../../../src/generated/server/worldmonitor/prediction/v1/service_server';

import { clampInt } from '../../../_shared/constants';
import { getCachedJson, cachedFetchJson } from '../../../_shared/redis';

const BOOTSTRAP_KEY = 'prediction:markets-bootstrap:v1';
const LIVE_KEY = 'prediction:markets-kalshi-live:v1';
const LIVE_TTL = 300; // 5 minutes — Kalshi public events change slowly.

const TECH_CATEGORY_TAGS = ['ai', 'tech', 'crypto', 'science'];
const FINANCE_CATEGORY_TAGS = ['economy', 'fed', 'inflation', 'interest-rates', 'recession', 'trade', 'tariffs', 'debt-ceiling'];

interface BootstrapMarket {
  title: string;
  yesPrice: number;
  volume: number;
  url: string;
  endDate?: string;
  source?: 'kalshi' | 'polymarket';
}

interface BootstrapData {
  geopolitical?: BootstrapMarket[];
  tech?: BootstrapMarket[];
  finance?: BootstrapMarket[];
}

function toProtoMarket(m: BootstrapMarket, category: string): PredictionMarket {
  return {
    id: m.url?.split('/').pop() || '',
    title: m.title,
    yesPrice: (m.yesPrice ?? 50) / 100,
    volume: m.volume ?? 0,
    url: m.url || '',
    closesAt: m.endDate ? Date.parse(m.endDate) : 0,
    category,
    source: m.source === 'kalshi' ? 'MARKET_SOURCE_KALSHI' as MarketSource : 'MARKET_SOURCE_POLYMARKET' as MarketSource,
  };
}

async function fetchPolymarketLive(): Promise<BootstrapMarket[]> {
  try {
    const params = new URLSearchParams({
      closed: 'false', active: 'true', archived: 'false',
      order: 'volume', ascending: 'false', limit: '60',
      end_date_min: new Date().toISOString(),
    });
    const resp = await fetch(`https://gamma-api.polymarket.com/events?${params}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'WorldMonitor/1.0' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!resp.ok) return [];
    const events = await resp.json() as Array<{
      slug?: string; title?: string; volume?: number; endDate?: string;
      markets?: Array<{ question?: string; endDate?: string; closed?: boolean; outcomePrices?: string; volumeNum?: number; volume?: string }>;
    }>;
    const out: BootstrapMarket[] = [];
    for (const ev of Array.isArray(events) ? events : []) {
      const vol = ev.volume ?? 0;
      if (vol < 1000 || !ev.markets?.length) continue;
      const active = ev.markets.filter((m) => !m.closed);
      if (!active.length) continue;
      const top = active.reduce((b, m) => {
        const v = m.volumeNum ?? (m.volume ? parseFloat(m.volume) : 0);
        const bv = b.volumeNum ?? (b.volume ? parseFloat(b.volume) : 0);
        return v > bv ? m : b;
      });
      let yesPrice = 50;
      try {
        const prices = top.outcomePrices ? JSON.parse(top.outcomePrices) : null;
        if (Array.isArray(prices) && prices[0] != null) {
          const p = parseFloat(String(prices[0]));
          if (Number.isFinite(p)) yesPrice = +(p * 100).toFixed(1);
        }
      } catch { /* keep default */ }
      out.push({
        title: top.question || ev.title || '',
        yesPrice,
        volume: vol,
        url: `https://polymarket.com/event/${ev.slug ?? ''}`,
        endDate: top.endDate ?? ev.endDate,
        source: 'polymarket',
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchKalshiLive(): Promise<BootstrapData | null> {
  try {
    const url = `https://api.elections.kalshi.com/trade-api/v2/events?status=open&with_nested_markets=true&limit=100`;
    const resp = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'WorldMonitor/1.0' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as { events?: Array<{
      title?: string;
      markets?: Array<{
        ticker?: string;
        title?: string;
        yes_sub_title?: string;
        market_type?: string;
        status?: string;
        volume_fp?: string;
        last_price_dollars?: string;
        close_time?: string;
      }>;
    }> };
    const events = Array.isArray(data?.events) ? data!.events! : [];
    const all: BootstrapMarket[] = [];
    for (const ev of events) {
      const ms = (ev.markets ?? []).filter(
        (m) => m.market_type === 'binary' && m.status === 'active',
      );
      if (!ms.length) continue;
      const top = ms.reduce((best, m) => {
        const v = parseFloat(m.volume_fp ?? '0') || 0;
        const bv = parseFloat(best.volume_fp ?? '0') || 0;
        return v > bv ? m : best;
      });
      const volume = parseFloat(top.volume_fp ?? '0') || 0;
      if (volume <= 5000) continue;
      const raw = parseFloat(top.last_price_dollars ?? '');
      const yesPrice = Number.isFinite(raw) ? +(raw * 100).toFixed(1) : 50;
      const mt = top.yes_sub_title || top.title || '';
      const title = mt && (mt.includes('?') || mt.length > 60)
        ? mt
        : (ev.title ? (mt && mt !== ev.title ? `${ev.title}: ${mt}` : ev.title) : mt);
      all.push({
        title,
        yesPrice,
        volume,
        url: `https://kalshi.com/markets/${top.ticker ?? ''}`,
        endDate: top.close_time,
        source: 'kalshi',
      });
    }
    const poly = await fetchPolymarketLive();
    const combined = [...all, ...poly];
    if (!combined.length) return null;
    const sorted = combined.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
    return { geopolitical: sorted, finance: sorted, tech: sorted };
  } catch {
    return null;
  }
}

export const listPredictionMarkets: PredictionServiceHandler['listPredictionMarkets'] = async (
  _ctx: ServerContext,
  req: ListPredictionMarketsRequest,
): Promise<ListPredictionMarketsResponse> => {
  try {
    const category = (req.category || '').slice(0, 50);
    const query = (req.query || '').slice(0, 100);
    const limit = clampInt(req.pageSize, 50, 1, 100);

    let bootstrap = await getCachedJson(BOOTSTRAP_KEY) as BootstrapData | null;
    if (!bootstrap) {
      bootstrap = await cachedFetchJson<BootstrapData>(LIVE_KEY, LIVE_TTL, fetchKalshiLive);
    }
    if (!bootstrap) return { markets: [], pagination: undefined };

    const isTech = category && TECH_CATEGORY_TAGS.includes(category);
    const isFinance = !isTech && category && FINANCE_CATEGORY_TAGS.includes(category);
    const variant = isTech ? bootstrap.tech
      : isFinance ? (bootstrap.finance ?? bootstrap.geopolitical)
      : bootstrap.geopolitical;

    if (!variant || variant.length === 0) return { markets: [], pagination: undefined };

    let markets = variant.map((m) => toProtoMarket(m, category));

    if (query) {
      const q = query.toLowerCase();
      markets = markets.filter((m) => m.title.toLowerCase().includes(q));
    }

    return { markets: markets.slice(0, limit), pagination: undefined };
  } catch {
    return { markets: [], pagination: undefined };
  }
};
