// Offline reverse geocoding: GeoNames cities15000 held in memory behind a 1 degree grid. Nearest city within 30 km.
// GeoNames names are English ("Munich"), so a small table of German exonyms (names.ts) is applied when a place is loaded.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { db } from "./db";
import { DE_STATES, GERMAN_NAMES } from "./names";
export { countryName } from "./names";

export type City = { id: number; name: string; admin1: string | null; country: string; lat: number; lon: number };
const GEONAMES = process.env.MONET_GEONAMES ?? "data/geonames/cities15000.txt";
export const MAX_KM = 30;


const grid = new Map<number, City[]>();
const cell = (lat: number, lon: number) => Math.floor(lat + 90) * 1000 + Math.floor(lon + 180);
let loaded = 0;

export function loadPlaces(path = GEONAMES) {
  grid.clear(); loaded = 0;
  if (!existsSync(path)) { console.warn(`places: ${path} missing, items get no place`); return 0; }
  const admin = new Map<string, string>();
  const ap = join(dirname(path), "admin1CodesASCII.txt");
  if (existsSync(ap)) for (const l of readFileSync(ap, "utf8").split("\n")) { const c = l.split("\t"); if (c.length > 1) admin.set(c[0], c[1]); }
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const c = line.split("\t");
    if (c.length < 11) continue;
    const country = c[8], code = c[10];
    const city: City = {
      id: +c[0], name: GERMAN_NAMES[c[1]] ?? c[1], lat: +c[4], lon: +c[5], country,
      admin1: country === "DE" ? DE_STATES[code] ?? null : admin.get(`${country}.${code}`) ?? null,
    };
    const k = cell(city.lat, city.lon);
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(city);
    loaded++;
  }
  return loaded;
}

function km(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

/** Nearest city within MAX_KM, or null. Looks at the surrounding grid cells; 30 km is under 1 degree of latitude,
 *  and the longitude reach grows with 1/cos(lat) (capped, so the poles do not scan the world). */
export function nearestCity(lat: number, lon: number): City | null {
  if (!loaded || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const reach = Math.min(8, Math.ceil(1 / Math.max(0.1, Math.cos(lat * Math.PI / 180))));
  let best: City | null = null, bd = MAX_KM;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -reach; dx <= reach; dx++) {
    const la = Math.floor(lat + 90) + dy, lo = ((Math.floor(lon + 180) + dx) % 360 + 360) % 360;
    for (const c of grid.get(la * 1000 + lo) ?? []) { const d = km(lat, lon, c.lat, c.lon); if (d <= bd) { bd = d; best = c; } }
  }
  return best;
}

/** Finds the city for a position and makes sure it has a row in `place`. Returns the place id. */
export function placeIdFor(lat: number, lon: number): number | null {
  const c = nearestCity(lat, lon);
  if (!c) return null;
  db.query("INSERT INTO place (id, name, admin1, country, lat, lon) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, admin1 = excluded.admin1")
    .run(c.id, c.name, c.admin1, c.country, c.lat, c.lon);
  return c.id;
}
