/**
 * RPC: getFredSeries -- reads seeded FRED time series data from Railway seed cache.
 * All external FRED API calls happen in seed-economy.mjs on Railway.
 */

import type {
  ServerContext,
  GetFredSeriesRequest,
  GetFredSeriesResponse,
} from '../../../../src/generated/server/worldmonitor/economic/v1/service_server';

import { getCachedJson, cachedFetchJson } from '../../../_shared/redis';
import {
  applyFredObservationLimit,
  fetchFredSeriesLive,
  fredLiveCacheKey,
  FRED_LIVE_FETCH_TTL,
  fredSeedKey,
  normalizeFredLimit,
} from './_fred-shared';

export async function getFredSeries(
  _ctx: ServerContext,
  req: GetFredSeriesRequest,
): Promise<GetFredSeriesResponse> {
  if (!req.seriesId) return { series: undefined };
  try {
    const seedKey = fredSeedKey(req.seriesId);
    let result = await getCachedJson(seedKey, true) as GetFredSeriesResponse | null;
    if (!result?.series) {
      // Fallback: no Railway seeder → fetch directly from FRED public API.
      result = await cachedFetchJson<GetFredSeriesResponse>(
        fredLiveCacheKey(req.seriesId),
        FRED_LIVE_FETCH_TTL,
        () => fetchFredSeriesLive(req.seriesId),
      );
    }
    if (!result?.series) return { series: undefined };
    const limit = normalizeFredLimit(req.limit);
    return { series: applyFredObservationLimit(result.series, limit) };
  } catch {
    return { series: undefined };
  }
}
