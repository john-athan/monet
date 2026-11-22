// Files beside the photos: the three lists (Dokumente, Tabellen, Präsentationen), the folders of the Ablage, and what a
// person does with them. The contract is docs/files.md.
import type { DocKind, DocList, DocSummary, FolderOut, FolderSummary, MoveIn } from "../../shared/types";
import { api, post } from "./api";

/** Each kind with its page, German name, the room it is painted in and its icon. */
export const KINDS = {
  doc: { path: "/dokumente", title: "Dokumente", one: "Dokument", room: "--esszimmer", icon: "dokumente" },
  sheet: { path: "/tabellen", title: "Tabellen", one: "Tabelle", room: "--garten", icon: "tabellen" },
  slides: { path: "/praesentationen", title: "Präsentationen", one: "Präsentation", room: "--seerosen", icon: "praesentationen" },
  book: { path: "/buecher", title: "Bücher", one: "Buch", room: "--atelier", icon: "buecher" },
  audio: { path: "/audio", title: "Audio", one: "Titel", room: "--teich", icon: "audio" },
  // no list of its own: other files live in the Ablage
  other: { path: "/ablage", title: "Dateien", one: "Datei", room: "--water", icon: "ablage" },
} as const satisfies Record<DocKind, { path: string; title: string; one: string; room: string; icon: string }>;

const SIGNS: Record<string, string> = { numbers: "NUM", markdown: "MD" };
/** The short label of a format for placeholders: "pdf" -> "PDF", "numbers" -> "NUM". */
export const fileSign = (format: string) => SIGNS[format.toLowerCase()] ?? format.toUpperCase().slice(0, 5);

const dfMonth = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });
const dfDay = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", year: "numeric" });
/** "November 2026" */
export const monthLabel = (ms: number) => dfMonth.format(ms);
/** "22. Nov. 2026" */
export const dayLabel = (ms: number) => dfDay.format(ms);
/** The cover of a file (404 while it is still being rendered). */
export const coverUrl = (id: number) => `/media/doc/${id}/c`;

/** Runs `fn` when an upload brought something in (upload.svelte.ts says so every few seconds and at the end). Call it while a component starts. */
export function onUploaded(fn: () => void) {
  $effect(() => { addEventListener("monet-uploaded", fn); return () => removeEventListener("monet-uploaded", fn); });
}

/** One list of files by kind, newest first, paged by `next`. A new `q` or `reload` starts again; an answer that
 * arrives after another one was asked for is dropped. */
export function docList(kind: DocKind, limit = 48) {
  const s = $state({ docs: [] as DocSummary[], next: null as string | null, loading: false, loaded: false, error: "", q: "" });
  let seq = 0;
  async function fetchPage(cursor: string | null) {
    const my = ++seq;
    s.loading = true; s.error = "";
    try {
      const r = await api<DocList>(`/api/docs?kind=${kind}&limit=${limit}${s.q ? `&q=${encodeURIComponent(s.q)}` : ""}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (my !== seq) return;
      s.docs = cursor ? [...s.docs, ...r.docs.filter(d => !s.docs.some(o => o.id === d.id))] : r.docs;
      s.next = r.next; s.loaded = true;
    } catch (e: any) { if (my === seq) s.error = e.message; }
    finally { if (my === seq) s.loading = false; }
  }
  return {
    s,
    /** the first page again, for the current q; what is on screen stays until the answer is there */
    reload: () => fetchPage(null),
    more: () => { if (!s.loading && s.next) return fetchPage(s.next); },
    search(q: string) { s.q = q; return fetchPage(null); },
  };
}

/** A folder with what is in it (null: the top of the Ablage). */
export const loadFolder = (id: number | null) => api<FolderOut>(`/api/folders/${id ?? 0}`);
export const createFolder = (name: string, parentId: number | null) => post<FolderSummary>("/api/folders", { name, parentId });
export const renameFolder = (id: number, name: string) => api(`/api/folders/${id}`, { method: "PATCH", json: { name } });
/** Only an empty folder can go; the server says so otherwise. */
export const deleteFolder = (id: number) => api(`/api/folders/${id}`, { method: "DELETE" });
export const moveTo = (into: number | null, what: Omit<MoveIn, "into">) => post("/api/move", { into, ...what } satisfies MoveIn);
export const deleteDoc = (id: number) => api(`/api/docs/${id}`, { method: "DELETE" });
export const restoreDoc = (id: number) => post(`/api/docs/${id}/restore`);

/** Whether a book or track has a cover picture to ask for (w and h stay 0 until one was made). */
export const hasCover = (d: DocSummary) => d.state === "ok" && d.w > 0 && d.h > 0;

const collator = new Intl.Collator("de", { numeric: true, sensitivity: "base" });
/** Tracks in album order: track number first (none last), then title. */
export const byTrack = (a: DocSummary, b: DocSummary) => (a.track ?? 1e9) - (b.track ?? 1e9) || collator.compare(a.title, b.title);
export type Group = { key: string; label: string; sub: string; docs: DocSummary[] };
/** Books by author, A to Z, "Ohne Autor" last; a shelf is its books by title. */
export function byAuthor(docs: DocSummary[]): Group[] {
  const m = new Map<string, DocSummary[]>();
  for (const d of docs) { const k = d.by?.trim() ?? ""; (m.get(k) ?? m.set(k, []).get(k)!).push(d); }
  return [...m].map(([k, ds]) => ({ key: k, label: k || "Ohne Autor", sub: "", docs: ds.sort((a, b) => collator.compare(a.title, b.title)) }))
    .sort((a, b) => Number(a.key === "") - Number(b.key === "") || collator.compare(a.label, b.label));
}
/** Tracks by album (and its artist), albums A to Z, tracks without an album last as "Einzelne Titel". */
export function byAlbum(docs: DocSummary[]): Group[] {
  const m = new Map<string, DocSummary[]>();
  for (const d of docs) { const k = d.album?.trim() ? `${d.album.trim()}\u0000${d.by?.trim() ?? ""}` : ""; (m.get(k) ?? m.set(k, []).get(k)!).push(d); }
  return [...m].map(([k, ds]) => {
    const [album = "", artist = ""] = k.split("\u0000");
    const artists = new Set(ds.map(d => d.by?.trim() ?? ""));
    return { key: k, label: album || "Einzelne Titel", sub: album ? (artists.size > 1 && !artist ? "Verschiedene" : artist) : "", docs: ds.sort(album ? byTrack : (a, b) => collator.compare(a.title, b.title)) };
  }).sort((a, b) => Number(a.key === "") - Number(b.key === "") || collator.compare(a.label, b.label));
}
/** The album a track belongs to, in track order (a track without album: just itself). One request per page of 200. */
export async function albumOf(d: DocSummary): Promise<DocSummary[]> {
  if (!d.album) return [d];
  const out: DocSummary[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 10; i++) {
    const r: DocList = await api<DocList>(`/api/docs?kind=audio&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    out.push(...r.docs.filter(x => x.album === d.album && (x.by ?? "") === (d.by ?? "")));
    if (!r.next) break; cursor = r.next;
  }
  return out.length ? out.sort(byTrack) : [d];
}
