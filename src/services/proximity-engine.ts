// Reactive Proximity Alarm Sandbox — detection engine.
//
// Cross-references user-imported private assets against live threat feeds
// already loaded into the shared AppContext (exposed at
// `window.__worldcaveState`). Coordinates stay on the client; only metadata
// + opt-in coordinate sync ever travel to Lovable Cloud.

import { supabase } from '@/integrations/supabase/client';
import { haversineKm } from '@/utils/distance';
import { publishProximityRenderState } from '@/services/proximity-map-bridge';

export interface ProximityAsset {
  id: string;
  label: string;
  lat: number;
  lon: number;
  radiusKmOverride?: number;
}

export interface ProximityAssetSet {
  id: string;
  name: string;
  color: string;
  defaultRadiusKm: number;
  enabled: boolean;
  assets: ProximityAsset[];
  updatedAt: number;
}

export type ThreatCategory =
  | 'conflicts' | 'hotspots' | 'natural' | 'outages'
  | 'sanctions' | 'iranAttacks' | 'weather' | 'earthquakes'
  | 'military' | 'cyber' | 'other';

export interface ProximityThreat {
  id: string;
  category: ThreatCategory;
  title: string;
  lat: number;
  lon: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  ts?: number;
}

export interface ProximityAlert {
  key: string;            // assetId__threatId
  asset: ProximityAsset;
  set: ProximityAssetSet;
  threat: ProximityThreat;
  distanceKm: number;
  effectiveRadiusKm: number;
  firstSeen: number;
}

export interface ProximityPrefs {
  defaultRadiusKm: number;
  enabledCategories: ThreatCategory[];
  severityThreshold: 'low' | 'medium' | 'high';
  audiblePing: boolean;
  syncCoordinates: boolean;
}

const SETS_KEY = 'wm:rpas:sets:v1';
const PREFS_KEY = 'wm:rpas:prefs:v1';
const SEEN_KEY = 'wm:rpas:seen:v1';
const HISTORY_KEY = 'wm:rpas:history:v1';
const HISTORY_CAP = 500;

export interface ProximityHistoryEvent {
  ts: number;
  action: 'entered' | 'left';
  assetId: string;
  assetLabel: string;
  setId: string;
  setName: string;
  setColor: string;
  threatId: string;
  threatTitle: string;
  category: ThreatCategory;
  severity: ProximityThreat['severity'];
  distanceKm: number;
  effectiveRadiusKm: number;
}

export const DEFAULT_PREFS: ProximityPrefs = {
  defaultRadiusKm: 50,
  enabledCategories: ['conflicts', 'hotspots', 'natural', 'outages', 'sanctions', 'iranAttacks', 'weather', 'earthquakes', 'military', 'cyber'],
  severityThreshold: 'low',
  audiblePing: false,
  syncCoordinates: false,
};

const SEVERITY_RANK: Record<ProximityThreat['severity'], number> = { low: 0, medium: 1, high: 2, critical: 3 };
const THRESHOLD_RANK: Record<ProximityPrefs['severityThreshold'], number> = { low: 0, medium: 1, high: 2 };

/* ───────────────── storage ───────────────── */

export function loadLocalSets(): ProximityAssetSet[] {
  try {
    const raw = localStorage.getItem(SETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
export function saveLocalSets(sets: ProximityAssetSet[]): void {
  try { localStorage.setItem(SETS_KEY, JSON.stringify(sets)); } catch { /* ignore */ }
}
export function loadLocalPrefs(): ProximityPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch { return { ...DEFAULT_PREFS }; }
}
export function saveLocalPrefs(prefs: ProximityPrefs): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}
function loadSeen(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); } catch { return {}; }
}
function saveSeen(seen: Record<string, number>): void {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch { /* ignore */ }
}
function loadHistory(): ProximityHistoryEvent[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-HISTORY_CAP) : [];
  } catch { return []; }
}
function saveHistory(history: ProximityHistoryEvent[]): void {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-HISTORY_CAP))); } catch { /* ignore */ }
}

/* ───────────────── cloud sync (best-effort) ───────────────── */

export async function pushCloudPrefs(userId: string, prefs: ProximityPrefs): Promise<void> {
  if (!userId) return;
  try {
    await supabase.from('proximity_preferences' as never).upsert({
      user_id: userId,
      default_radius_km: prefs.defaultRadiusKm,
      enabled_categories: prefs.enabledCategories as unknown,
      severity_threshold: prefs.severityThreshold,
      audible_ping: prefs.audiblePing,
      sync_coordinates: prefs.syncCoordinates,
      updated_at: new Date().toISOString(),
    } as never, { onConflict: 'user_id' });
  } catch (err) { console.warn('[rpas] prefs push failed', err); }
}

export async function pullCloudPrefs(userId: string): Promise<ProximityPrefs | null> {
  if (!userId) return null;
  try {
    const { data, error } = await supabase
      .from('proximity_preferences' as never)
      .select('*').eq('user_id', userId).maybeSingle();
    if (error || !data) return null;
    const d = data as unknown as Record<string, unknown>;
    return {
      defaultRadiusKm: Number(d.default_radius_km) || DEFAULT_PREFS.defaultRadiusKm,
      enabledCategories: (Array.isArray(d.enabled_categories) ? d.enabled_categories : DEFAULT_PREFS.enabledCategories) as ThreatCategory[],
      severityThreshold: (d.severity_threshold as ProximityPrefs['severityThreshold']) || DEFAULT_PREFS.severityThreshold,
      audiblePing: Boolean(d.audible_ping),
      syncCoordinates: Boolean(d.sync_coordinates),
    };
  } catch { return null; }
}

export async function pushCloudSet(userId: string, set: ProximityAssetSet, includeCoords: boolean): Promise<void> {
  if (!userId) return;
  try {
    await supabase.from('proximity_asset_sets' as never).upsert({
      id: set.id,
      user_id: userId,
      name: set.name,
      color: set.color,
      default_radius_km: set.defaultRadiusKm,
      asset_count: set.assets.length,
      private_assets: includeCoords ? (set.assets as unknown) : null,
      updated_at: new Date().toISOString(),
    } as never, { onConflict: 'id' });
  } catch (err) { console.warn('[rpas] set push failed', err); }
}

export async function deleteCloudSet(userId: string, id: string): Promise<void> {
  if (!userId) return;
  try {
    await supabase.from('proximity_asset_sets' as never).delete().eq('id', id).eq('user_id', userId);
  } catch (err) { console.warn('[rpas] set delete failed', err); }
}

export async function pullCloudSets(userId: string): Promise<ProximityAssetSet[]> {
  if (!userId) return [];
  try {
    const { data, error } = await supabase
      .from('proximity_asset_sets' as never)
      .select('*').eq('user_id', userId);
    if (error || !data) return [];
    return (data as unknown as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      color: String(r.color) || '#22d3ee',
      defaultRadiusKm: Number(r.default_radius_km) || 50,
      assets: Array.isArray(r.private_assets) ? r.private_assets as ProximityAsset[] : [],
      enabled: true,
      updatedAt: new Date(String(r.updated_at)).getTime() || Date.now(),
    }));
  } catch { return []; }
}

/* ───────────────── threat extraction ───────────────── */

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : (typeof v === 'string' ? parseFloat(v) : NaN);
  return Number.isFinite(n) ? n : null;
}

function pushIfGeo(out: ProximityThreat[], obj: unknown, base: Partial<ProximityThreat>): void {
  if (!obj || typeof obj !== 'object') return;
  const o = obj as Record<string, unknown>;
  const lat = num(o.lat ?? o.latitude);
  const lon = num(o.lon ?? o.lng ?? o.longitude);
  if (lat === null || lon === null) return;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return;
  const id = String(base.id ?? o.id ?? `${lat.toFixed(3)},${lon.toFixed(3)}`);
  const title = base.title ?? String(o.title ?? o.name ?? o.label ?? 'Event');
  out.push({
    id, lat, lon, title,
    category: base.category ?? 'other',
    severity: base.severity ?? 'medium',
    ts: base.ts,
  });
}

function severityFromLevel(level: unknown): ProximityThreat['severity'] {
  const s = String(level || '').toLowerCase();
  if (s === 'critical') return 'critical';
  if (s === 'high') return 'high';
  if (s === 'medium' || s === 'moderate') return 'medium';
  return 'low';
}

export function collectThreats(): ProximityThreat[] {
  const ctx = (window as unknown as { __worldcaveState?: Record<string, unknown> }).__worldcaveState;
  if (!ctx) return [];
  const out: ProximityThreat[] = [];
  const cache = (ctx.intelligenceCache || {}) as Record<string, unknown>;

  // Clustered events
  const clusters = ctx.latestClusters as unknown[] | undefined;
  if (Array.isArray(clusters)) {
    for (const c of clusters) {
      const cc = c as Record<string, unknown>;
      const threat = cc.threat as { level?: string; category?: string } | undefined;
      pushIfGeo(out, c, {
        id: `cluster:${cc.id}`,
        title: String(cc.primaryTitle ?? 'Cluster'),
        category: threat?.category === 'conflict' || threat?.category === 'military' || threat?.category === 'terrorism'
          ? 'conflicts'
          : (threat?.category === 'disaster' || threat?.category === 'environmental') ? 'natural'
          : (threat?.category === 'cyber') ? 'cyber'
          : 'hotspots',
        severity: severityFromLevel(threat?.level),
        ts: cc.lastUpdated instanceof Date ? cc.lastUpdated.getTime() : undefined,
      });
    }
  }

  // Earthquakes
  const quakes = cache.earthquakes as unknown[] | undefined;
  if (Array.isArray(quakes)) for (const q of quakes) {
    const qq = q as Record<string, unknown>;
    const mag = num(qq.magnitude ?? qq.mag) ?? 0;
    pushIfGeo(out, q, {
      id: `quake:${qq.id}`,
      title: `M${mag.toFixed(1)} earthquake${qq.place ? ` · ${qq.place}` : ''}`,
      category: 'earthquakes',
      severity: mag >= 6.5 ? 'critical' : mag >= 5.5 ? 'high' : mag >= 4.5 ? 'medium' : 'low',
    });
  }

  // Outages
  const outages = cache.outages as unknown[] | undefined;
  if (Array.isArray(outages)) for (const o of outages) {
    pushIfGeo(out, o, {
      id: `outage:${(o as Record<string, unknown>).id}`,
      title: String((o as Record<string, unknown>).title ?? 'Internet outage'),
      category: 'outages', severity: 'medium',
    });
  }

  // Protests / unrest
  const protests = (cache.protests as { events?: unknown[] } | undefined)?.events;
  if (Array.isArray(protests)) for (const p of protests) {
    pushIfGeo(out, p, {
      id: `protest:${(p as Record<string, unknown>).id}`,
      title: String((p as Record<string, unknown>).title ?? 'Civil unrest'),
      category: 'hotspots', severity: 'medium',
    });
  }

  // Iran events
  const iran = cache.iranEvents as unknown[] | undefined;
  if (Array.isArray(iran)) for (const e of iran) {
    pushIfGeo(out, e, {
      id: `iran:${(e as Record<string, unknown>).id}`,
      title: String((e as Record<string, unknown>).title ?? 'Iran/Israel event'),
      category: 'iranAttacks', severity: 'high',
    });
  }

  // Military
  const mil = cache.military as { flights?: unknown[]; vessels?: unknown[] } | undefined;
  if (mil) {
    if (Array.isArray(mil.flights)) for (const f of mil.flights) {
      pushIfGeo(out, f, {
        id: `mil-air:${(f as Record<string, unknown>).id ?? (f as Record<string, unknown>).hex}`,
        title: String((f as Record<string, unknown>).callsign ?? 'Military aircraft'),
        category: 'military', severity: 'low',
      });
    }
    if (Array.isArray(mil.vessels)) for (const v of mil.vessels) {
      pushIfGeo(out, v, {
        id: `mil-sea:${(v as Record<string, unknown>).id ?? (v as Record<string, unknown>).mmsi}`,
        title: String((v as Record<string, unknown>).name ?? 'Military vessel'),
        category: 'military', severity: 'low',
      });
    }
  }

  // Advisories (region-anchored, may lack precise coords — skip if no lat/lon)
  const advisories = cache.advisories as unknown[] | undefined;
  if (Array.isArray(advisories)) for (const a of advisories) {
    pushIfGeo(out, a, {
      id: `adv:${(a as Record<string, unknown>).id}`,
      title: String((a as Record<string, unknown>).title ?? 'Security advisory'),
      category: 'hotspots', severity: severityFromLevel((a as Record<string, unknown>).level),
    });
  }

  // Cyber threats
  const cyber = ctx.cyberThreatsCache as unknown[] | undefined;
  if (Array.isArray(cyber)) for (const c of cyber) {
    pushIfGeo(out, c, {
      id: `cyber:${(c as Record<string, unknown>).id}`,
      title: String((c as Record<string, unknown>).title ?? 'Cyber threat'),
      category: 'cyber', severity: 'medium',
    });
  }

  return out;
}

/* ───────────────── engine ───────────────── */

type EngineEvent = 'change';

export class ProximityEngine extends EventTarget {
  private sets: ProximityAssetSet[] = [];
  private prefs: ProximityPrefs = { ...DEFAULT_PREFS };
  private alerts: ProximityAlert[] = [];
  private seen: Record<string, number> = {};
  private timer: number | null = null;
  private lastRun = 0;
  private history: ProximityHistoryEvent[] = [];
  private activeKeys: Set<string> = new Set();
  private activeThreats: ProximityThreat[] = [];

  constructor() {
    super();
    this.sets = loadLocalSets();
    this.prefs = loadLocalPrefs();
    this.seen = loadSeen();
    this.history = loadHistory();
    this.activeKeys = new Set(Object.keys(this.seen));
  }

  start(): void {
    if (this.timer != null) return;
    this.timer = window.setInterval(() => this.refresh(), 4000);
    // First sweep slightly delayed to let data load.
    window.setTimeout(() => this.refresh(), 1500);
  }
  stop(): void {
    if (this.timer != null) { window.clearInterval(this.timer); this.timer = null; }
  }

  getSets(): ProximityAssetSet[] { return this.sets; }
  getPrefs(): ProximityPrefs { return this.prefs; }
  getAlerts(): ProximityAlert[] { return this.alerts; }
  getActiveThreats(): ProximityThreat[] { return this.activeThreats; }
  getHistory(): ProximityHistoryEvent[] { return this.history; }
  clearHistory(): void {
    this.history = [];
    saveHistory(this.history);
    this.dispatchEvent(new CustomEvent('change' as EngineEvent));
  }

  setSets(sets: ProximityAssetSet[]): void {
    this.sets = sets;
    saveLocalSets(sets);
    this.refresh();
    this.dispatchEvent(new CustomEvent('change' as EngineEvent));
  }
  setPrefs(prefs: ProximityPrefs): void {
    this.prefs = prefs;
    saveLocalPrefs(prefs);
    this.refresh();
    this.dispatchEvent(new CustomEvent('change' as EngineEvent));
  }

  refresh(): void {
    const now = Date.now();
    if (now - this.lastRun < 1500) return;
    this.lastRun = now;

    const threats = collectThreats().filter(t => this.prefs.enabledCategories.includes(t.category)
      && SEVERITY_RANK[t.severity] >= THRESHOLD_RANK[this.prefs.severityThreshold]);

    // Spatial bucketing — keeps per-asset checks O(neighbours) instead of
    // O(threats) when users have hundreds of assets and thousands of events.
    const grid = new Map<string, ProximityThreat[]>();
    for (const t of threats) {
      const gk = `${Math.floor(t.lat)},${Math.floor(t.lon)}`;
      const bucket = grid.get(gk);
      if (bucket) bucket.push(t); else grid.set(gk, [t]);
    }

    const next: ProximityAlert[] = [];
    const hitThreats = new Map<string, ProximityThreat>();
    for (const set of this.sets) {
      if (!set.enabled) continue;
      for (const asset of set.assets) {
        const radius = asset.radiusKmOverride ?? set.defaultRadiusKm ?? this.prefs.defaultRadiusKm;
        const span = Math.max(1, Math.ceil(radius / 100));
        const baseLat = Math.floor(asset.lat);
        const baseLon = Math.floor(asset.lon);
        const candidates: ProximityThreat[] = [];
        for (let dLat = -span; dLat <= span; dLat++) {
          for (let dLon = -span; dLon <= span; dLon++) {
            const b = grid.get(`${baseLat + dLat},${baseLon + dLon}`);
            if (b) candidates.push(...b);
          }
        }
        for (const t of candidates) {
          const d = haversineKm(asset.lat, asset.lon, t.lat, t.lon);
          if (d <= radius) {
            const key = `${asset.id}__${t.id}`;
            const firstSeen = this.seen[key] ?? now;
            this.seen[key] = firstSeen;
            next.push({ key, asset, set, threat: t, distanceKm: d, effectiveRadiusKm: radius, firstSeen });
            hitThreats.set(t.id, t);
          }
        }
      }
    }
    next.sort((a, b) => a.distanceKm - b.distanceKm);

    // History — diff entered/left vs previous tick.
    const activeKeys = new Set(next.map(a => a.key));
    const byKey = new Map(next.map(a => [a.key, a]));
    let historyChanged = false;
    for (const k of activeKeys) {
      if (!this.activeKeys.has(k)) {
        const a = byKey.get(k)!;
        this.history.push({
          ts: now, action: 'entered',
          assetId: a.asset.id, assetLabel: a.asset.label,
          setId: a.set.id, setName: a.set.name, setColor: a.set.color,
          threatId: a.threat.id, threatTitle: a.threat.title,
          category: a.threat.category, severity: a.threat.severity,
          distanceKm: a.distanceKm, effectiveRadiusKm: a.effectiveRadiusKm,
        });
        historyChanged = true;
      }
    }
    for (const k of this.activeKeys) {
      if (!activeKeys.has(k)) {
        // Try to recover label/title from previous alerts cache for nicer history.
        const prev = this.alerts.find(a => a.key === k);
        if (prev) {
          this.history.push({
            ts: now, action: 'left',
            assetId: prev.asset.id, assetLabel: prev.asset.label,
            setId: prev.set.id, setName: prev.set.name, setColor: prev.set.color,
            threatId: prev.threat.id, threatTitle: prev.threat.title,
            category: prev.threat.category, severity: prev.threat.severity,
            distanceKm: prev.distanceKm, effectiveRadiusKm: prev.effectiveRadiusKm,
          });
          historyChanged = true;
        }
      }
    }
    if (historyChanged) {
      if (this.history.length > HISTORY_CAP) this.history = this.history.slice(-HISTORY_CAP);
      saveHistory(this.history);
    }
    this.activeKeys = activeKeys;

    // Prune seen entries older than 24h or no longer alerting
    for (const k of Object.keys(this.seen)) {
      if (!activeKeys.has(k) && now - (this.seen[k] ?? 0) > 86400000) delete this.seen[k];
    }
    saveSeen(this.seen);

    this.activeThreats = Array.from(hitThreats.values());
    const changed = next.length !== this.alerts.length
      || next.some((a, i) => a.key !== this.alerts[i]?.key);
    const newEntries = !changed ? 0 : next.filter(a => !this.alerts.find(x => x.key === a.key)).length;
    this.alerts = next;
    // Publish to map bridge every tick — set identity changes already trigger
    // change events; threat positions update independently so the map always
    // reflects the current snapshot.
    publishProximityRenderState({ sets: this.sets, alerts: this.alerts, activeThreats: this.activeThreats });
    if (changed) {
      this.dispatchEvent(new CustomEvent('change' as EngineEvent));
      if (this.prefs.audiblePing && newEntries > 0) this.playPing();
    } else if (historyChanged) {
      this.dispatchEvent(new CustomEvent('change' as EngineEvent));
    }
  }

  private playPing(): void {
    try {
      const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
        || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = 880; g.gain.value = 0.06;
      o.connect(g).connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.18);
      setTimeout(() => ctx.close(), 400);
    } catch { /* ignore */ }
  }
}

let _engine: ProximityEngine | null = null;
export function getProximityEngine(): ProximityEngine {
  if (!_engine) { _engine = new ProximityEngine(); _engine.start(); }
  return _engine;
}

/* ───────────────── import helpers (file + paste) ───────────────── */

function tolerantParseLines(text: string): ProximityAsset[] {
  const out: ProximityAsset[] = [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).filter(l => !l.startsWith('#'));
  for (const line of lines) {
    const parts = line.split(/[,;\t]+/).map(p => p.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const lat = Number(parts[0]);
    const lon = Number(parts[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const label = parts[2] || `Asset ${lat.toFixed(3)}, ${lon.toFixed(3)}`;
    const rad = parts[3] ? Number(parts[3]) : undefined;
    out.push({
      id: 'a_' + Math.random().toString(36).slice(2, 8),
      label, lat, lon,
      radiusKmOverride: Number.isFinite(rad) && rad! > 0 ? rad : undefined,
    });
  }
  return out;
}

export function parseProximityImport(text: string): ProximityAsset[] {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Nothing to import.');
  // Try JSON / GeoJSON first
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const data = JSON.parse(trimmed);
    const rows = Array.isArray(data)
      ? data
      : (Array.isArray((data as { assets?: unknown[] })?.assets)
        ? (data as { assets: unknown[] }).assets
        : (Array.isArray((data as { features?: unknown[] })?.features)
          ? (data as { features: unknown[] }).features
          : null));
    if (!rows) throw new Error('Expected JSON array, {assets:[]}, or GeoJSON FeatureCollection.');
    const out: ProximityAsset[] = [];
    for (const r of rows as Record<string, unknown>[]) {
      if (!r || typeof r !== 'object') continue;
      let lat: number | undefined, lon: number | undefined, label = 'Asset', rad: number | undefined;
      const geom = (r as { geometry?: { type?: string; coordinates?: unknown[] } }).geometry;
      if (r.type === 'Feature' && geom?.type === 'Point' && Array.isArray(geom.coordinates)) {
        lon = Number(geom.coordinates[0]); lat = Number(geom.coordinates[1]);
        const props = (r as { properties?: Record<string, unknown> }).properties ?? {};
        label = String(props.name ?? props.label ?? props.title ?? label);
        rad = Number(props.radiusKm ?? props.radius_km) || undefined;
      } else {
        lat = Number(r.lat ?? r.latitude);
        lon = Number(r.lon ?? r.lng ?? r.longitude);
        label = String(r.label ?? r.name ?? r.title ?? label);
        rad = Number(r.radiusKm ?? (r as Record<string, unknown>).radius_km) || undefined;
      }
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (lat! < -90 || lat! > 90 || lon! < -180 || lon! > 180) continue;
      out.push({
        id: 'a_' + Math.random().toString(36).slice(2, 8),
        label, lat: lat as number, lon: lon as number,
        radiusKmOverride: rad,
      });
    }
    if (!out.length) throw new Error('No valid coordinates found in JSON.');
    return out;
  }
  // Fallback: CSV-ish lat,lon[,label[,radiusKm]]
  const rows = tolerantParseLines(trimmed);
  if (!rows.length) throw new Error('Could not parse — paste JSON, GeoJSON, or lines of "lat,lon,label[,radiusKm]".');
  return rows;
}

/* ───────────────── export helpers ───────────────── */

export function setToGeoJSON(set: ProximityAssetSet): unknown {
  return {
    type: 'FeatureCollection',
    features: set.assets.map((a) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
      properties: {
        name: a.label,
        radiusKm: a.radiusKmOverride ?? set.defaultRadiusKm,
        set: set.name,
        setColor: set.color,
      },
    })),
  };
}

export function allSetsToGeoJSON(sets: ProximityAssetSet[]): unknown {
  return {
    type: 'FeatureCollection',
    features: sets.flatMap((s) =>
      s.assets.map((a) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
        properties: {
          name: a.label,
          radiusKm: a.radiusKmOverride ?? s.defaultRadiusKm,
          set: s.name,
          setColor: s.color,
        },
      })),
    ),
  };
}
