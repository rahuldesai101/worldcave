/**
 * Direct EIA v2 API fallback used when the Railway seed cache is empty.
 * Mirrors the series IDs and shapes produced by scripts/seed-economy.mjs so
 * the existing handlers can serve real data without the seed workers.
 *
 * Requires EIA_API_KEY (free: https://www.eia.gov/opendata/register.php).
 * Results are cached in-process for 6h to stay well under EIA's rate limit.
 */

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const UA = 'worldmonitor-edge/1.0';

interface CacheEntry<T> { value: T; expires: number }
const memCache = new Map<string, CacheEntry<unknown>>();

async function eiaCached<T>(key: string, fetcher: () => Promise<T>): Promise<T | null> {
  const apiKey = process.env.EIA_API_KEY;
  if (!apiKey) return null;
  const hit = memCache.get(key) as CacheEntry<T> | undefined;
  if (hit && hit.expires > Date.now()) return hit.value;
  try {
    const value = await fetcher();
    memCache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
    return value;
  } catch (err) {
    console.warn(`[eia-fallback:${key}]`, (err as Error).message);
    return null;
  }
}

async function eiaFetch(path: string, params: Record<string, string | string[]>): Promise<any> {
  const apiKey = process.env.EIA_API_KEY!;
  const sp = new URLSearchParams();
  sp.set('api_key', apiKey);
  sp.set('frequency', 'weekly');
  sp.set('data[]', 'value');
  sp.set('sort[0][column]', 'period');
  sp.set('sort[0][direction]', 'desc');
  sp.set('length', '9');
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((vv) => sp.append(k, vv));
    else sp.set(k, v);
  }
  const resp = await fetch(`https://api.eia.gov${path}?${sp}`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`EIA HTTP ${resp.status}`);
  return resp.json();
}

export interface EiaWeek { period: string; value: number }

function parseRows(rows: any[]): EiaWeek[] {
  const out: EiaWeek[] = [];
  for (const row of rows ?? []) {
    const v = row?.value != null ? parseFloat(String(row.value)) : NaN;
    if (!Number.isFinite(v)) continue;
    const period = typeof row?.period === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.period) ? row.period : '';
    if (!period) continue;
    out.push({ period, value: +v.toFixed(3) });
  }
  return out;
}

export function fetchEiaCrudeInventories() {
  return eiaCached('crude', async () => {
    const data = await eiaFetch('/v2/petroleum/stoc/wstk/data/', { 'facets[series][]': 'WCRSTUS1' });
    const rows = parseRows(data?.response?.data ?? []).slice(0, 9);
    const weeks = rows.slice(0, 8).map((w, i) => ({
      period: w.period,
      stocksMb: w.value,
      weeklyChangeMb: rows[i + 1] ? +(w.value - rows[i + 1]!.value).toFixed(3) : null,
    }));
    return { weeks, latestPeriod: weeks[0]?.period ?? '' };
  });
}

export function fetchEiaNatGasStorage() {
  return eiaCached('natgas', async () => {
    const data = await eiaFetch('/v2/natural-gas/stor/wkly/data/', { 'facets[series][]': 'NW2_EPG0_SWO_R48_BCF' });
    const rows = parseRows(data?.response?.data ?? []).slice(0, 9);
    const weeks = rows.slice(0, 8).map((w, i) => ({
      period: w.period,
      storBcf: w.value,
      weeklyChangeBcf: rows[i + 1] ? +(w.value - rows[i + 1]!.value).toFixed(3) : null,
    }));
    return { weeks, latestPeriod: weeks[0]?.period ?? '' };
  });
}

export function fetchEiaSpr() {
  return eiaCached('spr', async () => {
    const data = await eiaFetch('/v2/petroleum/stoc/wstk/data/', { 'facets[series][]': 'WCSSTUS1' });
    const rows = parseRows(data?.response?.data ?? []).slice(0, 9);
    const weeks = rows.map((w) => ({ period: w.period, barrels: w.value }));
    const latest = weeks[0];
    const prev = weeks[1];
    const prev4 = weeks[4];
    return {
      latestPeriod: latest?.period ?? '',
      barrels: latest?.barrels ?? 0,
      changeWoW: prev && latest ? +(latest.barrels - prev.barrels).toFixed(3) : null,
      changeWoW4: prev4 && latest ? +(latest.barrels - prev4.barrels).toFixed(3) : null,
      weeks: weeks.slice(0, 8),
    };
  });
}

export function fetchEiaRefineryInputs() {
  return eiaCached('refinery', async () => {
    const data = await eiaFetch('/v2/petroleum/pnp/wiup/data/', {
      'facets[series][]': 'WCRRIUS2',
      'facets[duoarea][]': 'NUS',
    });
    const rows = parseRows(data?.response?.data ?? []).slice(0, 9);
    const latest = rows[0];
    return {
      latestPeriod: latest?.period ?? '',
      inputsMbblpd: latest?.value ?? 0,
      weeks: rows.slice(0, 8).map((w) => ({ period: w.period, inputsMbblpd: w.value })),
    };
  });
}