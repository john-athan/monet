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
/** A district (GeoNames PPLX: Kreuzberg, Retiro, Times Square) names its city here: the most populous town within
 *  20 km that is no district itself. Moments are titled by city (docs/together.md). */
const cityOfDistrict = new Map<number, string>();
const cell = (lat: number, lon: number) => Math.floor(lat + 90) * 1000 + Math.floor(lon + 180);
let loaded = 0;

export function loadPlaces(path = GEONAMES) {
  grid.clear(); loaded = 0; cityOfDistrict.clear();
  const districts: City[] = [], pop = new Map<number, number>();
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
    if (c[7] === "PPLX") districts.push(city); else pop.set(city.id, +c[14] || 0);
    loaded++;
  }
  for (const d of districts) {
    let best: City | null = null, bp = -1;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const c of grid.get(cell(d.lat, d.lon) + dy * 1000 + dx) ?? []) {
      const p = pop.get(c.id);
      if (p != null && p > bp && km(d.lat, d.lon, c.lat, c.lon) <= 20) { bp = p; best = c; }
    }
    if (best) cityOfDistrict.set(d.id, best.name);
  }
  return loaded;
}

function km(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

/** The name a place is known by at the scale of a trip: its city when it is a district, else its own. */
export const cityName = (id: number, name: string) => cityOfDistrict.get(id) ?? name;

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
