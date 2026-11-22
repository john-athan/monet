// The date of a file (docs/together.md, "Dates"): when it was made, not when it was uploaded, so a folder of old
// letters lands on the timeline where the letters belong. Order: the file's own metadata, a date in its name, the
// first date in its text, the file's mtime, the upload. Pure except metaDate, which reads the file.
import { dateFromName } from "./exif";
import { entryMap, readText, withSource } from "./epub";
import { berlinWallToUtc, runText } from "./util";

export type DocDateSrc = "meta" | "name" | "text" | "mtime" | "upload";
const EARLIEST = 631152000_000; // 1990: anything before is a broken clock or a default

const plausible = (t: number | null | undefined, uploadedAt: number): t is number => t != null && Number.isFinite(t) && t > EARLIEST && t < uploadedAt + 86400_000;

/** An ISO date as metadata writes it: with a zone it is that instant, without one it is Berlin wall time. */
export function isoDate(s: string | null | undefined): number | null {
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?)?/.exec(s ?? "");
  if (!m) return null;
  const [y, mo, d, h, mi, se] = [+m[1], +m[2], +m[3], +(m[4] ?? 12), +(m[5] ?? 0), +(m[6] ?? 0)];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (!m[7]) return berlinWallToUtc(y, mo, d, h, mi, se);
  const z = m[7] === "Z" ? 0 : (m[7][0] === "-" ? -1 : 1) * (+m[7].slice(1, 3) * 60 + +m[7].slice(-2));
  return Date.UTC(y, mo - 1, d, h, mi, se) - z * 60000;
}

/** PDF "D:20210312102201+01'00'" (what pdfinfo prints without -isodates is locale text, so -isodates is used). */
export const pdfInfoDate = (out: string): number | null => isoDate(/^CreationDate:\s*(.+)$/m.exec(out)?.[1]);

const MONTH: Record<string, number> = {
  januar: 1, jan: 1, january: 1, februar: 2, feb: 2, february: 2, märz: 3, maerz: 3, mär: 3, march: 3, mar: 3, april: 4, apr: 4,
  mai: 5, may: 5, juni: 6, jun: 6, june: 6, juli: 7, jul: 7, july: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9,
  oktober: 10, okt: 10, october: 10, oct: 10, november: 11, nov: 11, dezember: 12, dez: 12, december: 12, dec: 12,
};
const valid = (y: number, mo: number, d: number) => mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && new Date(Date.UTC(y, mo - 1, d)).getUTCMonth() === mo - 1;
/** The first date written in the text (its first 4000 characters): 12.03.2021, 12. März 2021, 2021-03-12, March 12, 2021.
 *  A day without a time counts from noon, so no zone moves it to the neighbouring day. */
export function textDate(text: string | null | undefined, uploadedAt: number): number | null {
  const t = (text ?? "").slice(0, 4000);
  const found: { at: number; utc: number }[] = [];
  const add = (at: number, y: number, mo: number, d: number) => { if (valid(y, mo, d)) { const u = berlinWallToUtc(y, mo, d, 12); if (plausible(u, uploadedAt)) found.push({ at, utc: u }); } };
  for (const m of t.matchAll(/(?<![\d.])(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})(?!\d)/g)) add(m.index!, +m[3], +m[2], +m[1]);
  for (const m of t.matchAll(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g)) add(m.index!, +m[1], +m[2], +m[3]);
  for (const m of t.matchAll(/(?<!\d)(\d{1,2})\.?\s+([A-Za-zäÄ]{3,9})\.?\s+(\d{4})(?!\d)/g)) { const mo = MONTH[m[2].toLowerCase()]; if (mo) add(m.index!, +m[3], mo, +m[1]); }
  for (const m of t.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),\s+(\d{4})(?!\d)/g)) { const mo = MONTH[m[1].toLowerCase()]; if (mo) add(m.index!, +m[3], mo, +m[2]); }
  found.sort((a, b) => a.at - b.at);
  return found[0]?.utc ?? null;
}

/** The creation date the file carries itself: a PDF's CreationDate, Office's dcterms:created, ODF's meta:creation-date,
 *  an audio file's creation_time (`tags`, from ffprobe). Other formats, and a converted PDF (its date is the conversion), have none. */
export async function metaDate(format: string, path: string, tags?: Record<string, string>): Promise<number | null> {
  try {
    if (tags) return isoDate(tags.creation_time ?? tags.date ?? null);
    if (format === "pdf") return pdfInfoDate(await runText(["pdfinfo", "-isodates", path], 30_000));
    const entry = ["docx", "xlsx", "xlsm", "pptx"].includes(format) ? "docProps/core.xml" : ["odt", "ods", "odp"].includes(format) ? "meta.xml" : null;
    if (!entry) return null;
    const xml = withSource(path, src => { const map = entryMap(src); return map ? readText(src, map, entry) : null; });
    return isoDate(/<(?:dcterms:created|meta:creation-date)[^>]*>([^<]+)</.exec(xml ?? "")?.[1]);
  } catch { return null; }
}

export type DocDated = { takenAt: number; src: DocDateSrc };
/** The fallback chain. `modifiedAt` is the client's mtime (docs keep it as modified_at, upload time when it had none). */
export function chooseDocDate(o: { meta: number | null; name: string | null; text: string | null; modifiedAt: number; uploadedAt: number; kind: string }): DocDated {
  if (plausible(o.meta, o.uploadedAt)) return { takenAt: o.meta, src: "meta" };
  const n = o.name ? dateFromName(o.name)?.utc : null;
  if (plausible(n, o.uploadedAt)) return { takenAt: n, src: "name" };
  // a date in the text says when a letter or an invoice was written; in a book or a song it says nothing about this copy
  if (o.kind === "doc" || o.kind === "slides" || o.kind === "other") { const t = textDate(o.text, o.uploadedAt); if (t != null) return { takenAt: t, src: "text" }; }
  if (o.modifiedAt !== o.uploadedAt && plausible(o.modifiedAt, o.uploadedAt)) return { takenAt: o.modifiedAt, src: "mtime" };
  return { takenAt: o.uploadedAt, src: "upload" };
}
