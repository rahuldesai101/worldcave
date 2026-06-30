import type {
  Forecast,
  ForecastServiceHandler,
  ServerContext,
  GetForecastsRequest,
  GetForecastsResponse,
} from '../../../../src/generated/server/worldmonitor/forecast/v1/service_server';
import { getRawJson } from '../../../_shared/redis';
import { callLlmTool } from '../../../_shared/llm';

const REDIS_KEY = 'forecast:predictions:v2';

const FALLBACK_TTL_MS = 6 * 60 * 60 * 1000;
let fallbackCache: { forecasts: Forecast[]; at: number } | null = null;

async function generateForecastsWithLlm(): Promise<Forecast[] | null> {
  try {
    const result = await callLlmTool({
      messages: [
        { role: 'system', content: 'You are a geopolitical and macro forecaster. Return ONLY a JSON array (no prose).' },
        { role: 'user', content: 'Output 8 short-horizon (30-90 day) forecasts spanning domains: geopolitics, military, economic, energy, climate, cyber. Each object must have keys: id (slug), domain, region, title (<=80 chars), scenario (1-2 sentences), probability (0-1), confidence (0-1), timeHorizon (e.g. "30d", "60d", "90d"), trend (rising|stable|falling). Return ONLY a JSON array.' },
      ],
      temperature: 0.4,
      maxTokens: 1500,
      timeoutMs: 15_000,
    });
    if (!result?.content) return null;
    const m = result.content.match(/\[[\s\S]*\]/);
    if (!m) return null;
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const now = Date.now();
    return arr.slice(0, 16).map((x: any, i: number): Forecast => ({
      id: String(x.id || `fc-${i}`),
      domain: String(x.domain || 'geopolitics'),
      region: String(x.region || 'Global'),
      title: String(x.title || ''),
      scenario: String(x.scenario || ''),
      feedSummary: '',
      probability: Math.max(0, Math.min(1, Number(x.probability) || 0.5)),
      confidence: Math.max(0, Math.min(1, Number(x.confidence) || 0.5)),
      timeHorizon: String(x.timeHorizon || '30d'),
      signals: [],
      cascades: [],
      trend: String(x.trend || 'stable'),
      priorProbability: 0,
      createdAt: now,
      updatedAt: now,
      simulationAdjustment: 0,
      simPathConfidence: 0,
      demotedBySimulation: false,
    })).filter((f) => f.title);
  } catch {
    return null;
  }
}

async function getFallbackForecasts(): Promise<Forecast[]> {
  const now = Date.now();
  if (fallbackCache && now - fallbackCache.at < FALLBACK_TTL_MS) return fallbackCache.forecasts;
  const generated = await generateForecastsWithLlm();
  const forecasts = generated ?? [];
  fallbackCache = { forecasts, at: now };
  return forecasts;
}

export const getForecasts: ForecastServiceHandler['getForecasts'] = async (
  _ctx: ServerContext,
  req: GetForecastsRequest,
): Promise<GetForecastsResponse> => {
  try {
    const data = await getRawJson(REDIS_KEY) as { predictions: Forecast[]; generatedAt: number } | null;
    if (!data?.predictions?.length) {
      const fb = await getFallbackForecasts();
      let forecasts = fb;
      if (req.domain) forecasts = forecasts.filter(f => f.domain === req.domain);
      if (req.region) forecasts = forecasts.filter(f => f.region.toLowerCase().includes(req.region.toLowerCase()));
      return { forecasts, generatedAt: Date.now(), degraded: false, stale: true, error: '' };
    }

    let forecasts = data.predictions;
    if (req.domain) forecasts = forecasts.filter(f => f.domain === req.domain);
    if (req.region) forecasts = forecasts.filter(f => f.region.toLowerCase().includes(req.region.toLowerCase()));

    return { forecasts, generatedAt: data.generatedAt || 0, degraded: false, stale: false, error: '' };
  } catch (err) {
    console.error('[forecast] getRawJson failed:', err instanceof Error ? err.message : String(err));
    const fb = await getFallbackForecasts();
    let forecasts = fb;
    if (req.domain) forecasts = forecasts.filter(f => f.domain === req.domain);
    if (req.region) forecasts = forecasts.filter(f => f.region.toLowerCase().includes(req.region.toLowerCase()));
    return { forecasts, generatedAt: Date.now(), degraded: forecasts.length === 0, stale: true, error: forecasts.length === 0 ? 'forecast_backend_unavailable' : '' };
  }
};
