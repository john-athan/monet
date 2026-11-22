// The four lights follow the local clock. The dark scheme forces the night; the header button overrides by hand.
import type { Light } from "../../shared/types";
export type { Light };
export type LightMode = "auto" | Light;
import { LIGHTS } from "../../shared/styles";
export { LIGHTS };
export const LIGHT_NAME: Record<Light, string> = { morgen: "Morgen", mittag: "Mittag", abend: "Abend", nacht: "Nacht" };
export const LIGHT_HOURS: Record<Light, string> = { morgen: "6 bis 10 Uhr", mittag: "10 bis 17 Uhr", abend: "17 bis 21 Uhr", nacht: "21 bis 6 Uhr" };

/** morgen 6-10, mittag 10-17, abend 17-21, nacht 21-6; a dark colour scheme is always the night. */
export function lightFor(hour: number, dark = false): Light {
  if (dark) return "nacht";
  return hour >= 6 && hour < 10 ? "morgen" : hour >= 10 && hour < 17 ? "mittag" : hour >= 17 && hour < 21 ? "abend" : "nacht";
}
/** The button cycles automatic, morgen, mittag, abend, nacht, and back to automatic. */
export function nextMode(m: LightMode): LightMode {
  const order: LightMode[] = ["auto", ...LIGHTS];
  return order[(order.indexOf(m) + 1) % order.length];
}
export const parseMode = (s: string | null): LightMode => (s === "morgen" || s === "mittag" || s === "abend" || s === "nacht" ? s : "auto");

/** The ground behind a photo in the viewer: a deep shade of one of the house colours, chosen by the photo's own hue.
 *  Greys and dark pictures stand on the night blue. */
const GROUNDS: [hue: number, ground: string][] = [
  [350, "#45242C"], // atelier, rose and red
  [22, "#43251A"],  // abend, orange and brown
  [48, "#3E3214"],  // esszimmer, ochre and yellow
  [115, "#1F3524"], // garten, green
  [182, "#173A3E"], // teich, teal
  [225, "#1A1E44"], // the night, blue
  [275, "#2C2346"], // seerosen am abend, violet
];
export const NIGHT_GROUND = "#1A1E44";
export function groundFor(hex: string | null | undefined): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return NIGHT_GROUND;
  const n = parseInt(m[1], 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), c = max - min;
  if (c < .06 || max < .08) return NIGHT_GROUND;
  const h = (max === r ? ((g - b) / c + 6) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4) * 60;
  const dist = (a: number) => Math.min(Math.abs(a - h), 360 - Math.abs(a - h));
  return GROUNDS.reduce((best, x) => (dist(x[0]) < dist(best[0]) ? x : best))[1];
}
