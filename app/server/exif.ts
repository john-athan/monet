// Reading dates and camera data. Photos: the text `vipsheader -a` prints. Videos: ffprobe JSON. File names: the
// patterns phones and apps use. Pure parsing here; the spawning is in ingest.ts.
import { berlinWallToUtc } from "./util";

export type Meta = {
  width: number | null; height: number | null;
  /** wall-clock time read from the file, with the zone offset in minutes when the file said it */
  taken: { utc: number; tzMin: number | null } | null;
  lat: number | null; lon: number | null; camera: string | null; exposure: string | null;
  fnumber: number | null; iso: number | null; focal: number | null; durationMs: number | null;
};
export const emptyMeta = (): Meta => ({ width: null, height: null, taken: null, lat: null, lon: null, camera: null, exposure: null, fnumber: null, iso: null, focal: null, durationMs: null });

const validYear = (y: number) => y >= 1990 && y <= new Date().getUTCFullYear() + 1;

/** vipsheader prints `key: raw (human, Type, N components, M bytes)` for EXIF fields; plain `key: value` otherwise. */
export function parseVipsHeader(text: string): { raw: Map<string, string>; fields: Map<string, string> } {
  const raw = new Map<string, string>(), fields = new Map<string, string>();
  for (const line of text.split("\n")) {
    const i = line.indexOf(": ");
    if (i < 1) continue;
    const k = line.slice(0, i), v = line.slice(i + 2);
    fields.set(k, v);
    const m = /^(.*?) \((.*), (?:ASCII|Byte|Short|Long|Rational|SRational|SShort|SLong|Undefined|Float|Double|SByte), \d+ components?, \d+ bytes?\)$/s.exec(v);
    raw.set(k, m ? m[1].trim() : v.trim());
  }
  return { raw, fields };
}
const rational = (s: string | undefined): number | null => {
  if (!s) return null;
  const m = /^(-?\d+)\/(\d+)$/.exec(s.trim());
  if (m) return +m[2] ? +m[1] / +m[2] : null;
  const n = Number(s); return Number.isFinite(n) ? n : null;
};
const dms = (s: string | undefined, ref: string | undefined): number | null => {
  if (!s) return null;
  const p = s.trim().split(/\s+/).map(rational);
  if (p.length < 3 || p.some(x => x == null)) return null;
  const v = p[0]! + p[1]! / 60 + p[2]! / 3600;
  return /^[SW]/i.test(ref ?? "") ? -v : v;
};
const offsetMin = (s: string | undefined): number | null => {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec((s ?? "").trim());
  return m ? (m[1] === "-" ? -1 : 1) * (+m[2] * 60 + +m[3]) : null;
};
/** "2019:08:06 18:01:21" plus an optional zone offset. No zone: the wall clock is read as Europe/Berlin. */
export function wallTime(s: string | undefined, tzMin: number | null): { utc: number; tzMin: number | null } | null {
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec((s ?? "").trim());
  if (!m || !validYear(+m[1]) || +m[2] < 1 || +m[2] > 12) return null;
  const [y, mo, d, h, mi, sec] = m.slice(1).map(Number);
  if (tzMin != null) return { utc: Date.UTC(y, mo - 1, d, h, mi, sec) - tzMin * 60000, tzMin };
  return { utc: berlinWallToUtc(y, mo, d, h, mi, sec), tzMin: null };
}

export function metaFromVips(text: string): Meta {
  const { raw, fields } = parseVipsHeader(text);
  const g = (k: string) => raw.get(k);
  const m = emptyMeta();
  let w = Number(fields.get("width")) || null, h = Number(fields.get("height")) || null;
  // JPEGs keep the sensor orientation in EXIF and libvips reports the stored size; HEIC is already rotated by the loader
  const orient = Number(fields.get("orientation") ?? 1);
  if (orient >= 5 && orient <= 8) [w, h] = [h, w];
  m.width = w; m.height = h;
  const dt = g("exif-ifd2-DateTimeOriginal") ?? g("exif-ifd2-DateTimeDigitized");
  const off = offsetMin(g("exif-ifd2-OffsetTimeOriginal") ?? g("exif-ifd2-OffsetTimeDigitized") ?? g("exif-ifd2-OffsetTime"));
  m.taken = wallTime(dt, off);
  m.lat = dms(g("exif-ifd3-GPSLatitude"), g("exif-ifd3-GPSLatitudeRef"));
  m.lon = dms(g("exif-ifd3-GPSLongitude"), g("exif-ifd3-GPSLongitudeRef"));
  if (m.lat != null && m.lon != null && m.lat === 0 && m.lon === 0) m.lat = m.lon = null; // null island is a camera with no fix
  const make = g("exif-ifd0-Make")?.trim(), model = g("exif-ifd0-Model")?.trim();
  // models usually repeat the make ("Apple iPhone 13 Pro" would otherwise read "Apple Apple iPhone...")
  m.camera = model ? (make && !model.toLowerCase().startsWith(make.toLowerCase()) ? `${make} ${model}` : model) : make || null;
  const ex = rational(g("exif-ifd2-ExposureTime"));
  m.exposure = ex == null || ex <= 0 ? null : ex >= 1 ? String(Math.round(ex * 10) / 10) : `1/${Math.round(1 / ex)}`;
  m.fnumber = rational(g("exif-ifd2-FNumber"));
  const iso = rational(g("exif-ifd2-ISOSpeedRatings") ?? g("exif-ifd2-PhotographicSensitivity"));
  m.iso = iso == null ? null : Math.round(iso);
  m.focal = rational(g("exif-ifd2-FocalLength"));
  return m;
}

/** ISO 6709 as phones write it into videos: "+48.1371+011.5754+517.2/". Null island is a phone with no fix, as for
 *  photos: Samsung writes "+00.0000+000.0000/" into a video recorded before GPS was found. */
export function parseIso6709(s: unknown): { lat: number; lon: number } | null {
  const m = /^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/.exec(String(s ?? ""));
  if (!m || (+m[1] === 0 && +m[2] === 0)) return null;
  return { lat: +m[1], lon: +m[2] };
}

export function metaFromFfprobe(j: any): Meta {
  const m = emptyMeta();
  const v = (j?.streams ?? []).find((s: any) => s.codec_type === "video");
  const tags = { ...(j?.format?.tags ?? {}) } as Record<string, string>;
  if (v) {
    const rot = Number(v.side_data_list?.find((x: any) => x.rotation != null)?.rotation ?? v.tags?.rotate ?? 0);
    const swap = Math.abs(rot) % 180 === 90;
    m.width = (swap ? v.height : v.width) ?? null; m.height = (swap ? v.width : v.height) ?? null;
  }
  const dur = Number(j?.format?.duration ?? v?.duration);
  m.durationMs = Number.isFinite(dur) ? Math.round(dur * 1000) : null;
  // Apple writes the local time with offset; others only creation_time in UTC
  const apple = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})([+-]\d{2}):?(\d{2})$/.exec(tags["com.apple.quicktime.creationdate"] ?? "");
  if (apple) m.taken = wallTime(apple[1], offsetMin(apple[2] + apple[3]));
  else if (tags.creation_time) { const t = Date.parse(tags.creation_time); if (validYear(new Date(t).getUTCFullYear())) m.taken = { utc: t, tzMin: null }; }
  const loc = parseIso6709(tags["com.apple.quicktime.location.ISO6709"] ?? tags.location);
  if (loc) { m.lat = loc.lat; m.lon = loc.lon; }
  const mk = tags["com.apple.quicktime.make"], md = tags["com.apple.quicktime.model"];
  m.camera = md ? (mk && !md.startsWith(mk) ? `${mk} ${md}` : md) : null;
  return m;
}

/** A date in the file name. Phone and app patterns:
 *  IMG_20190806_180121, 20201101_133230, Screenshot_20200107-220711, PXL_20150214_102000 (UTC!), IMG-20191128-WA0000
 *  (date only), "DALL_E 2022-10-06 23.25.37", dallemini_2022-8-5_20-49-7. Without a time the day counts from noon,
 *  so a zone shift cannot move it to the neighbouring day. */
export function dateFromName(name: string): { utc: number; hasTime: boolean } | null {
  const base = name.replace(/^.*[\\/]/, "");
  let y = 0, mo = 0, d = 0, h = 12, mi = 0, s = 0, hasTime = false;
  const sep = /(?<!\d)(\d{4})[-_.](\d{1,2})[-_.](\d{1,2})(?:[ _T-]+(\d{1,2})[-_.:](\d{1,2})[-_.:](\d{1,2}))?(?!\d)/.exec(base);
  const comp = /(?<!\d)(\d{4})(\d{2})(\d{2})(?:[_-]?(\d{2})(\d{2})(\d{2}))?(?!\d)/.exec(base);
  const m = comp ?? sep;
  if (!m) return null;
  [y, mo, d] = [+m[1], +m[2], +m[3]];
  if (m[4] != null) { [h, mi, s] = [+m[4], +m[5], +m[6]]; hasTime = true; }
  if (!validYear(y) || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCMonth() !== mo - 1) return null; // 31 February and friends
  // Pixel phones name their files in UTC; every other pattern is the phone's local time
  if (/^PXL_/i.test(base) && hasTime) return { utc: Date.UTC(y, mo - 1, d, h, mi, s), hasTime };
  return { utc: berlinWallToUtc(y, mo, d, h, mi, s), hasTime };
}
