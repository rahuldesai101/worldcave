## Goal

Make the Proximity Sandbox a fully working feature on top of the live DeckGL map — not just a sidebar over sample data. Users can paste JSON/GeoJSON (in addition to file import), see their assets and danger-zone radii rendered as map layers, see clear icons where a live threat falls inside any zone, browse an in-widget alert history timeline, export their sets, and keep it smooth with hundreds of assets/threats on mobile and desktop.

## Scope (what changes)

### 1. Paste JSON/GeoJSON in the Import flow
`src/components/ProximitySandboxWidget.ts`
- Replace single "Import JSON/GeoJSON" button with a small dialog: file picker + a textarea to paste raw JSON / GeoJSON / CSV-like `lat,lon,label` rows.
- Reuse the existing `parseAssetsJson` parser; add a tolerant lines-parser fallback for `lat,lon[,label[,radiusKm]]`.
- Validate, show inline error, accept on success.

### 2. Map rendering of assets + danger zones
`src/components/DeckGLMap.ts`, new `src/services/proximity-map-bridge.ts`
- Add three new deck.gl layers built inside `buildLayers()`:
  - `proximity-zones` PolygonLayer: filled translucent circle (geodesic) per asset using its effective radius, colored by set color.
  - `proximity-assets` ScatterplotLayer: asset pins (set color, white stroke).
  - `proximity-threat-hits` IconLayer: a distinct alert glyph (pulsing triangle-on-shield SVG) at each live threat that is currently inside any zone — colored by severity.
- A small bridge module exposes `getProximityRenderState()` and a subscription so the map rebuilds layers when sets/alerts change without coupling DeckGLMap to the widget.
- Layers are skipped entirely when there are zero enabled assets (zero perf cost when unused).

### 3. Live cross-referencing already exists — wire it through
`src/services/proximity-engine.ts`
- Engine already polls `__worldcaveState` every 4 s. Expose `getActiveThreats()` (threats that triggered an alert) so the map bridge can plot only "inside-zone" markers.
- Replace per-tick full O(N×M) loop with: bbox prefilter (already there) + spatial bucketing of threats into a 1°-grid Map so each asset only checks its own + neighbor buckets. Keeps mobile responsive with thousands of threats.

### 4. Alert history timeline (in-widget)
`src/services/proximity-engine.ts`, `ProximitySandboxWidget.ts`
- Engine tracks `entered` / `left` events: diff `activeKeys` between ticks; push `{ ts, action, assetLabel, threatTitle, severity, category, distanceKm }` into a ring buffer (capped 500, persisted to `localStorage` under `wm:rpas:history:v1`).
- New "History" tab in the widget renders the timeline grouped by day, with enter/leave chips, severity dots, and a "Clear history" action.

### 5. Export (download)
`ProximitySandboxWidget.ts`
- Per-set 3-dot menu: "Export JSON" and "Export GeoJSON" — Blob + object URL download.
- Top-level "Export all" in the Assets tab header to bundle every set as a single GeoJSON FeatureCollection (assets as Point features with `properties.radiusKm`, `properties.set`).

### 6. Performance
- Engine: bbox + grid bucket (above), throttle minimum interval kept at 1.5 s, history diff uses `Set` ops.
- Map: PolygonLayer for zones uses pre-computed 48-vertex geodesic polygons cached per `(asset.id, radiusKm)` so re-renders don't recompute; cache invalidated on set/asset/radius change. Skip layer build entirely when widget produces empty render state.
- Icons sourced from a single inline SVG sprite atlas (deck.gl IconLayer) — no per-marker DOM nodes.

## Technical details

```text
ProximitySandboxWidget ── UI/import/export/history view
       │  (subscribe)
       ▼
ProximityEngine ── poll(__worldcaveState) → alerts + history events
       │  (publish render state)
       ▼
proximity-map-bridge ── { sets, alerts } observable
       │
       ▼
DeckGLMap.buildLayers() ── adds zones + assets + threat-hit icons
```

- New file: `src/services/proximity-map-bridge.ts` — tiny pub/sub + geodesic circle cache.
- New utility: `src/utils/geo-circle.ts` — `circlePolygon(lat, lon, km, vertices=48)` returning `[lon,lat][]` for PolygonLayer (cached by caller).
- Threat-hit icon: one PNG sprite generated at runtime from inline SVG via canvas (no asset import needed).
- Engine API additions: `getActiveThreats()`, `getHistory()`, `clearHistory()`, `addPastedAssets(text)` (thin wrapper around the parser).
- Widget tabs become: **Alerts · History · Assets · Settings**.
- No schema changes. No backend changes. History stays local-only (privacy parity with coordinates default).

## Out of scope

- Sharing/embedding asset sets across users.
- Per-asset custom icons.
- Push/email notifications (separate effort).
- Migrating coordinates off Clerk/Cloud (already handled by existing sync toggle).

## Verification

- Typecheck (`npm run typecheck`) passes.
- Paste a small GeoJSON FeatureCollection → set appears, dots + filled circles render on the map.
- Toggle a set off → its layers disappear within 1 tick.
- Force a fake threat near an asset (via console: push into `__worldcaveState.intelligenceCache.earthquakes`) → threat-hit icon appears and alert + history entry fire.
- Export JSON/GeoJSON downloads and re-imports cleanly.
- 500-asset stress set (script-generated) stays under ~8 ms per tick on desktop, no jank on mobile viewport.
