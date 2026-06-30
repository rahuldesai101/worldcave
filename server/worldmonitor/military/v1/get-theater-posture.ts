import type {
  ServerContext,
  GetTheaterPostureRequest,
  GetTheaterPostureResponse,
} from '../../../../src/generated/server/worldmonitor/military/v1/service_server';

import { getCachedJson } from '../../../_shared/redis';
import { callLlmTool } from '../../../_shared/llm';

const CACHE_KEY = 'theater-posture:sebuf:v1';
const STALE_CACHE_KEY = 'theater_posture:sebuf:stale:v1';
const BACKUP_CACHE_KEY = 'theater-posture:sebuf:backup:v1';

// In-process fallback cache populated by Groq when Redis seeds are missing.
// 6h TTL avoids hammering the LLM on every panel refresh.
const FALLBACK_TTL_MS = 6 * 60 * 60 * 1000;
let fallbackCache: { data: GetTheaterPostureResponse; at: number } | null = null;

const FALLBACK_THEATERS = [
  'Eastern Europe', 'Middle East', 'Indo-Pacific', 'South China Sea',
  'Korean Peninsula', 'Arctic', 'Sahel', 'Caribbean',
];

function staticTheaterFallback(): GetTheaterPostureResponse {
  const now = Date.now();
  return {
    theaters: FALLBACK_THEATERS.map((t) => ({
      theater: t,
      postureLevel: 'monitoring',
      activeFlights: 0,
      trackedVessels: 0,
      activeOperations: ['Routine monitoring'],
      assessedAt: now,
    })),
  };
}

async function generateTheaterPostureWithLlm(): Promise<GetTheaterPostureResponse | null> {
  try {
    const result = await callLlmTool({
      messages: [
        { role: 'system', content: 'You are a defense analyst. Return ONLY a JSON array (no prose) of theater posture objects.' },
        { role: 'user', content: `For each of these theaters: ${FALLBACK_THEATERS.join(', ')}, output an object with keys: theater (string), postureLevel (one of: routine, monitoring, elevated, heightened, surge), activeOperations (array of 1-3 short strings, current well-known operations or deployments). Return ONLY a JSON array.` },
      ],
      temperature: 0.3,
      maxTokens: 900,
      timeoutMs: 12_000,
    });
    if (!result?.content) return null;
    const m = result.content.match(/\[[\s\S]*\]/);
    if (!m) return null;
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const now = Date.now();
    return {
      theaters: arr.slice(0, 16).map((x: any) => ({
        theater: String(x.theater || ''),
        postureLevel: String(x.postureLevel || 'monitoring'),
        activeFlights: 0,
        trackedVessels: 0,
        activeOperations: Array.isArray(x.activeOperations) ? x.activeOperations.map((s: any) => String(s)).slice(0, 3) : [],
        assessedAt: now,
      })).filter((t) => t.theater),
    };
  } catch {
    return null;
  }
}

async function getFallbackPosture(): Promise<GetTheaterPostureResponse> {
  const now = Date.now();
  if (fallbackCache && now - fallbackCache.at < FALLBACK_TTL_MS) return fallbackCache.data;
  const generated = await generateTheaterPostureWithLlm();
  const data = generated && generated.theaters.length ? generated : staticTheaterFallback();
  fallbackCache = { data, at: now };
  return data;
}

// All theater posture assembly (OpenSky + Wingbits + classification)
// happens on Railway (ais-relay.cjs seedTheaterPosture loop + seed-military-flights.mjs).
// This handler reads pre-built data from Redis only.
// Gold standard: Vercel reads, Railway writes.

export async function getTheaterPosture(
  _ctx: ServerContext,
  _req: GetTheaterPostureRequest,
): Promise<GetTheaterPostureResponse> {
  try {
    const live = await getCachedJson(CACHE_KEY, true) as GetTheaterPostureResponse | null;
    if (live?.theaters?.length) return live;
  } catch { /* fall through to stale/backup */ }

  try {
    const stale = await getCachedJson(STALE_CACHE_KEY, true) as GetTheaterPostureResponse | null;
    if (stale?.theaters?.length) return stale;
  } catch { /* fall through to backup */ }

  try {
    const backup = await getCachedJson(BACKUP_CACHE_KEY, true) as GetTheaterPostureResponse | null;
    if (backup?.theaters?.length) return backup;
  } catch { /* empty */ }

  // Final fallback: LLM-generated posture (cached 6h in-process).
  return await getFallbackPosture();
}
