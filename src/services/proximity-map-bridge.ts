// Decouples the Proximity Sandbox from DeckGLMap. The widget/engine push
// the render snapshot here; the map subscribes once and rebuilds layers
// when the snapshot changes. Keeps DeckGLMap from importing the widget
// (and the widget from importing the map).

import type { ProximityAssetSet, ProximityAlert, ProximityThreat } from '@/services/proximity-engine';

export interface ProximityRenderState {
  sets: ProximityAssetSet[];
  alerts: ProximityAlert[];
  activeThreats: ProximityThreat[];
}

const EMPTY: ProximityRenderState = { sets: [], alerts: [], activeThreats: [] };

let current: ProximityRenderState = EMPTY;
const listeners = new Set<(s: ProximityRenderState) => void>();

export function publishProximityRenderState(next: ProximityRenderState): void {
  current = next;
  for (const fn of listeners) {
    try { fn(current); } catch (err) { console.warn('[proximity-bridge] listener failed', err); }
  }
}

export function getProximityRenderState(): ProximityRenderState {
  return current;
}

export function subscribeProximityRenderState(fn: (s: ProximityRenderState) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}