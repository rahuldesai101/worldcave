// Geodesic circle polygon for danger-zone rendering on the DeckGL map.
// Returned as a closed ring of [lon, lat] vertices suitable for
// PolygonLayer's `getPolygon` accessor. Cached internally by (lat,lon,km,n)
// because per-asset rebuilds otherwise dominate layer-rebuild cost.

const EARTH_KM = 6371;
const cache = new Map<string, [number, number][]>();

export function circlePolygon(
  lat: number,
  lon: number,
  radiusKm: number,
  vertices = 48,
): [number, number][] {
  const key = `${lat.toFixed(4)}|${lon.toFixed(4)}|${radiusKm}|${vertices}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const d = radiusKm / EARTH_KM;
  const ring: [number, number][] = [];
  for (let i = 0; i <= vertices; i++) {
    const brng = (i / vertices) * 2 * Math.PI;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng),
    );
    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
        Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
      );
    ring.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  if (cache.size > 4000) cache.clear();
  cache.set(key, ring);
  return ring;
}

export function clearCirclePolygonCache(): void {
  cache.clear();
}