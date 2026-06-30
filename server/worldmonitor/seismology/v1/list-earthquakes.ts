/**
 * ListEarthquakes RPC -- reads seeded earthquake data from Railway seed cache.
 * All external USGS API calls happen in seed-earthquakes.mjs on Railway.
 */

import type {
  SeismologyServiceHandler,
  ServerContext,
  ListEarthquakesRequest,
  ListEarthquakesResponse,
} from '../../../../src/generated/server/worldmonitor/seismology/v1/service_server';

import { getCachedJson, cachedFetchJson } from '../../../_shared/redis';

const SEED_CACHE_KEY = 'seismology:earthquakes:v1';
const LIVE_CACHE_KEY = 'seismology:earthquakes-usgs-live:v1';
const LIVE_TTL = 300; // USGS feeds refresh ~every 5 min.

type EarthquakeCache = { earthquakes: ListEarthquakesResponse['earthquakes'] };

async function fetchUsgsLive(): Promise<EarthquakeCache | null> {
  // USGS public GeoJSON feed — no key, no rate limit. M2.5+ past 7 days.
  const url = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson';
  const resp = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'WorldMonitor/1.0' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!resp.ok) return null;
  const data = (await resp.json()) as {
    features?: Array<{
      id?: string;
      properties?: { place?: string; mag?: number; time?: number; url?: string };
      geometry?: { coordinates?: [number, number, number] };
    }>;
  };
  const features = Array.isArray(data?.features) ? data.features : [];
  const earthquakes = features
    .map((f) => {
      const c = f.geometry?.coordinates;
      if (!c || c.length < 2 || typeof f.properties?.mag !== 'number') return null;
      return {
        id: String(f.id ?? ''),
        place: String(f.properties?.place ?? ''),
        magnitude: Number(f.properties.mag ?? 0),
        depthKm: Number(c[2] ?? 0),
        location: { latitude: Number(c[1] ?? 0), longitude: Number(c[0] ?? 0) },
        occurredAt: Number(f.properties?.time ?? 0),
        sourceUrl: String(f.properties?.url ?? ''),
      } as EarthquakeCache['earthquakes'][number];
    })
    .filter((e): e is EarthquakeCache['earthquakes'][number] => e !== null);
  if (!earthquakes.length) return null;
  return { earthquakes };
}

export const listEarthquakes: SeismologyServiceHandler['listEarthquakes'] = async (
  _ctx: ServerContext,
  req: ListEarthquakesRequest,
): Promise<ListEarthquakesResponse> => {
  const pageSize = req.pageSize || 500;
  const minMag = req.minMagnitude || 0;
  try {
    let seedData = (await getCachedJson(SEED_CACHE_KEY, true)) as EarthquakeCache | null;
    if (!seedData?.earthquakes?.length) {
      seedData = await cachedFetchJson<EarthquakeCache>(LIVE_CACHE_KEY, LIVE_TTL, fetchUsgsLive);
    }
    const earthquakes = (seedData?.earthquakes || []).filter((e) => e.magnitude >= minMag);
    return { earthquakes: earthquakes.slice(0, pageSize), pagination: undefined };
  } catch {
    return { earthquakes: [], pagination: undefined };
  }
};
