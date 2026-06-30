import type { FredSeries } from '../../../../src/generated/server/worldmonitor/economic/v1/service_server';

export const FRED_KEY_PREFIX = 'economic:fred:v1';
export const FRED_LIVE_KEY_PREFIX = 'economic:fred-live:v1';
const FRED_LIVE_TTL = 60 * 60 * 6; // 6h — daily series rarely change intraday.

export function fredSeedKey(seriesId: string): string {
  return `${FRED_KEY_PREFIX}:${seriesId}:0`;
}

export function fredLiveCacheKey(seriesId: string): string {
  return `${FRED_LIVE_KEY_PREFIX}:${seriesId}`;
}

export const FRED_LIVE_FETCH_TTL = FRED_LIVE_TTL;

/**
 * Fetch a single FRED series directly from the FRED public API. Returns null
 * if no API key is configured or the upstream call fails. Used as a fallback
 * when the Railway seed cache is empty.
 */
export async function fetchFredSeriesLive(seriesId: string): Promise<{ series: FredSeries } | null> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) return null;
  const id = seriesId.trim().toUpperCase();
  if (!id) return null;
  try {
    const headers = { Accept: 'application/json', 'User-Agent': 'WorldMonitor/1.0' };
    const signal = AbortSignal.timeout(8_000);
    const obsParams = new URLSearchParams({
      series_id: id,
      api_key: apiKey,
      file_type: 'json',
      sort_order: 'desc',
      limit: '1000',
    });
    const metaParams = new URLSearchParams({
      series_id: id,
      api_key: apiKey,
      file_type: 'json',
    });
    const [obsRes, metaRes] = await Promise.all([
      fetch(`https://api.stlouisfed.org/fred/series/observations?${obsParams}`, { headers, signal }),
      fetch(`https://api.stlouisfed.org/fred/series?${metaParams}`, { headers, signal }),
    ]);
    if (!obsRes.ok || !metaRes.ok) return null;
    const obsData = await obsRes.json() as { observations?: Array<{ date: string; value: string }> };
    const metaData = await metaRes.json() as { seriess?: Array<{ title?: string; units_short?: string; units?: string; frequency_short?: string; frequency?: string }> };
    const observations = (obsData.observations ?? [])
      .map((o) => ({ date: o.date, value: Number.parseFloat(o.value) }))
      .filter((o) => Number.isFinite(o.value))
      .reverse(); // ascending by date
    if (!observations.length) return null;
    const meta = metaData.seriess?.[0] ?? {};
    return {
      series: {
        seriesId: id,
        title: meta.title ?? id,
        units: meta.units_short ?? meta.units ?? '',
        frequency: meta.frequency_short ?? meta.frequency ?? '',
        observations,
      },
    };
  } catch {
    return null;
  }
}

export function normalizeFredLimit(limit: number): number {
  return limit > 0 ? Math.min(limit, 1000) : 120;
}

export function applyFredObservationLimit(series: FredSeries, limit: number): FredSeries {
  if (limit > 0 && series.observations.length > limit) {
    return { ...series, observations: series.observations.slice(-limit) };
  }
  return series;
}
