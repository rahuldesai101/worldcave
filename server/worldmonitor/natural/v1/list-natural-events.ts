/**
 * ListNaturalEvents RPC -- reads seeded natural disaster data from Railway seed cache.
 * All external EONET/GDACS/NHC API calls happen in seed-natural-events.mjs on Railway.
 */

import type {
  NaturalServiceHandler,
  ServerContext,
  ListNaturalEventsRequest,
  ListNaturalEventsResponse,
  NaturalEvent,
} from '../../../../src/generated/server/worldmonitor/natural/v1/service_server';

import { getCachedJson, cachedFetchJson } from '../../../_shared/redis';

const SEED_CACHE_KEY = 'natural:events:v1';
const LIVE_CACHE_KEY = 'natural:events-eonet-live:v1';
const LIVE_TTL = 900; // EONET refreshes ~hourly; 15 min is fine.

async function fetchEonetLive(days: number): Promise<{ events: NaturalEvent[] } | null> {
  const url = `https://eonet.gsfc.nasa.gov/api/v3/events?days=${days}&status=open`;
  const resp = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'WorldMonitor/1.0' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) return null;
  const data = (await resp.json()) as {
    events?: Array<{
      id?: string;
      title?: string;
      description?: string;
      categories?: Array<{ id?: string; title?: string }>;
      sources?: Array<{ id?: string; url?: string }>;
      geometry?: Array<{ date?: string; coordinates?: [number, number] | number[]; magnitudeValue?: number; magnitudeUnit?: string }>;
      closed?: string | null;
    }>;
  };
  const items = Array.isArray(data?.events) ? data.events : [];
  const events: NaturalEvent[] = items
    .map((e): NaturalEvent | null => {
      const geo = e.geometry?.[e.geometry.length - 1];
      const coords = geo?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) return null;
      const cat = e.categories?.[0];
      const src = e.sources?.[0];
      return {
        id: String(e.id ?? ''),
        title: String(e.title ?? ''),
        description: String(e.description ?? ''),
        category: String(cat?.id ?? ''),
        categoryTitle: String(cat?.title ?? ''),
        lat: Number(coords[1] ?? 0),
        lon: Number(coords[0] ?? 0),
        date: geo?.date ? Date.parse(geo.date) : 0,
        magnitude: Number(geo?.magnitudeValue ?? 0),
        magnitudeUnit: String(geo?.magnitudeUnit ?? ''),
        sourceUrl: String(src?.url ?? ''),
        sourceName: String(src?.id ?? 'EONET'),
        closed: Boolean(e.closed),
        forecastTrack: [],
        conePolygon: [],
        pastTrack: [],
      } as NaturalEvent;
    })
    .filter((e): e is NaturalEvent => e !== null);
  if (!events.length) return null;
  return { events };
}

export const listNaturalEvents: NaturalServiceHandler['listNaturalEvents'] = async (
  _ctx: ServerContext,
  req: ListNaturalEventsRequest,
): Promise<ListNaturalEventsResponse> => {
  try {
    let result = (await getCachedJson(SEED_CACHE_KEY, true)) as { events: NaturalEvent[] } | null;
    if (!result?.events?.length) {
      const days = req.days && req.days > 0 ? Math.min(req.days, 30) : 7;
      result = await cachedFetchJson<{ events: NaturalEvent[] }>(
        `${LIVE_CACHE_KEY}:${days}`,
        LIVE_TTL,
        () => fetchEonetLive(days),
      );
    }
    return { events: result?.events || [] };
  } catch {
    return { events: [] };
  }
};
