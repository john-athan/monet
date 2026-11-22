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

const dfDay = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", year: "numeric" });
/** "22. Nov. 2026" */
export const dayLabel = (ms: number) => dfDay.format(ms);
/** The cover of a file (404 while it is still being rendered). */
export const coverUrl = (id: number) => `/media/doc/${id}/c`;

/** Runs `fn` when an upload brought something in (upload.svelte.ts says so every few seconds and at the end). Call it while a component starts. */
export function onUploaded(fn: () => void) {
  $effect(() => { addEventListener("monet-uploaded", fn); return () => removeEventListener("monet-uploaded", fn); });
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
