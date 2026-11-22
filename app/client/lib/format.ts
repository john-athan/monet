// German dates, numbers and sizes.
const MONTHS = ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.", "Nov.", "Dez."];
const WORDS = ["null", "ein", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwölf"];
const NUMS = ["null", "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwölf"];

/** 52310 -> "52.310" */
export const num = (n: number) => Math.round(n).toLocaleString("de-DE");
/** one to twelve in words ("drei Fotos"), above as digits; `attr` gives "ein" for 1, else "eins". */
export const word = (n: number, attr = true) => n >= 0 && n <= 12 ? (attr ? WORDS : NUMS)[n] : num(n);
/** "2026-11" -> "Nov. 2026" */
export const monthShort = (ym: string) => { const [y, m] = ym.split("-"); return `${MONTHS[Number(m) - 1] ?? ""} ${y}`; };
export const bytes = (n: number) => {
  if (n < 1000) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"]; let i = -1, v = n;
  do { v /= 1000; i++; } while (v >= 1000 && i < u.length - 1);
  return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(".", ",").replace(/,0$/, "")} ${u[i]}`;
};
/** The photo's own wall clock: takenAt is UTC ms, tzMin the offset of the place it was taken. */
const wall = (ms: number, tz: number | null) => new Date(ms + (tz ?? 0) * 60000);
const dfDay = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const dfShort = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
export const fullDate = (ms: number, tz: number | null = null) => dfDay.format(wall(ms, tz ?? localOffset(ms)));
export const shortDate = (ms: number, tz: number | null = null) => dfShort.format(wall(ms, tz ?? localOffset(ms)));
export const clock = (ms: number, tz: number | null = null) => { const d = wall(ms, tz ?? localOffset(ms)); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };
const localOffset = (ms: number) => -new Date(ms).getTimezoneOffset();
export const duration = (ms: number) => { const s = Math.round(ms / 1000); return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
export const durationWords = (ms: number) => { const s = Math.round(ms / 1000); return s < 60 ? `${s} Sekunden` : `${Math.floor(s / 60)} Minuten`; };

/** "gerade eben", "vor 4 Minuten", "gestern", "vor 3 Tagen" */
export function ago(ms: number | null, now = Date.now()): string {
  if (!ms) return "noch nie";
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return "gerade eben";
  if (s < 3600) { const m = Math.round(s / 60); return m === 1 ? "vor einer Minute" : `vor ${word(m, false)} Minuten`; }
  if (s < 86400) { const h = Math.round(s / 3600); return h === 1 ? "vor einer Stunde" : `vor ${word(h, false)} Stunden`; }
  const d = Math.round(s / 86400);
  return d === 1 ? "gestern" : d < 60 ? `vor ${d} Tagen` : shortDate(ms);
}
export const count = (n: number, one: string, many: string) => `${num(n)} ${n === 1 ? one : many}`;
