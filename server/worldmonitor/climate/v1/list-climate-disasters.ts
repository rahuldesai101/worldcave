/**
 * ListClimateDisasters RPC -- reads seeded climate disaster data from Railway seed cache.
 * ReliefWeb and natural-event transforms happen in seed-climate-disasters.mjs on Railway.
 */

import type {
  ClimateServiceHandler,
  ServerContext,
  ListClimateDisastersRequest,
  ListClimateDisastersResponse,
  ClimateDisaster,
} from '../../../../src/generated/server/worldmonitor/climate/v1/service_server';

import { getCachedJson, cachedFetchJson } from '../../../_shared/redis';

const SEED_CACHE_KEY = 'climate:disasters:v1';
const LIVE_CACHE_KEY = 'climate:disasters-reliefweb-live:v1';
const LIVE_TTL = 1800; // ReliefWeb updates often; 30 min is plenty.
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 100;

function clampInt(value: number, fallback: number, min: number, max: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(num)));
}

function parseCursor(cursor: string | undefined): number {
  const num = parseInt(String(cursor || ''), 10);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

function asNumber(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeCachedDisaster(row: unknown): ClimateDisaster | null {
  if (!row || typeof row !== 'object') return null;

  const record = row as Record<string, unknown>;
  const id = String(record.id || '').trim();
  if (!id) return null;

  return {
    id,
    type: String(record.type || ''),
    name: String(record.name || ''),
    country: String(record.country || ''),
    countryCode: String(record.countryCode || record.country_code || ''),
    lat: asNumber(record.lat, 0),
    lng: asNumber(record.lng, 0),
    severity: String(record.severity || ''),
    startedAt: asNumber(record.startedAt ?? record.started_at, 0),
    status: String(record.status || ''),
    affectedPopulation: asNumber(record.affectedPopulation ?? record.affected_population, 0),
    source: String(record.source || ''),
    sourceUrl: String(record.sourceUrl || record.source_url || ''),
  };
}

async function fetchReliefWebLive(): Promise<{ disasters: ClimateDisaster[] } | null> {
  const url =
    'https://api.reliefweb.int/v1/disasters?appname=worldmonitor&profile=list&preset=latest&limit=100';
  const resp = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'WorldMonitor/1.0' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) return null;
  const data = (await resp.json()) as {
    data?: Array<{
      id?: string | number;
      fields?: {
        name?: string;
        status?: string;
        date?: { created?: string };
        primary_type?: { name?: string };
        primary_country?: { name?: string; iso3?: string; location?: { lat?: number; lon?: number } };
        url?: string;
      };
    }>;
  };
  const items = Array.isArray(data?.data) ? data.data : [];
  const disasters: ClimateDisaster[] = items
    .map((d): ClimateDisaster | null => {
      const f = d.fields;
      if (!f) return null;
      const country = f.primary_country;
      return {
        id: String(d.id ?? ''),
        type: String(f.primary_type?.name ?? ''),
        name: String(f.name ?? ''),
        country: String(country?.name ?? ''),
        countryCode: String(country?.iso3 ?? ''),
        lat: Number(country?.location?.lat ?? 0),
        lng: Number(country?.location?.lon ?? 0),
        severity: '',
        startedAt: f.date?.created ? Date.parse(f.date.created) : 0,
        status: String(f.status ?? ''),
        affectedPopulation: 0,
        source: 'ReliefWeb',
        sourceUrl: String(f.url ?? ''),
      };
    })
    .filter((d): d is ClimateDisaster => d !== null && Boolean(d.id));
  if (!disasters.length) return null;
  return { disasters };
}

export const listClimateDisasters: ClimateServiceHandler['listClimateDisasters'] = async (
  _ctx: ServerContext,
  req: ListClimateDisastersRequest,
): Promise<ListClimateDisastersResponse> => {
  try {
    const limit = clampInt(req.pageSize, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const offset = parseCursor(req.cursor);
    let result = (await getCachedJson(SEED_CACHE_KEY, true)) as { disasters?: unknown[] } | null;
    if (!Array.isArray(result?.disasters) || result.disasters.length === 0) {
      result = await cachedFetchJson<{ disasters: ClimateDisaster[] }>(
        LIVE_CACHE_KEY,
        LIVE_TTL,
        fetchReliefWebLive,
      );
    }
    const allDisasters = Array.isArray(result?.disasters)
      ? result.disasters.map(normalizeCachedDisaster).filter((row): row is ClimateDisaster => row != null)
      : [];
    if (offset >= allDisasters.length) {
      return {
        disasters: [],
        pagination: { nextCursor: '', totalCount: allDisasters.length },
      };
    }

    const disasters = allDisasters.slice(offset, offset + limit);
    const hasMore = offset + limit < allDisasters.length;
    return {
      disasters,
      pagination: {
        nextCursor: hasMore ? String(offset + limit) : '',
        totalCount: allDisasters.length,
      },
    };
  } catch {
    return {
      disasters: [],
      pagination: { nextCursor: '', totalCount: 0 },
    };
  }
};
