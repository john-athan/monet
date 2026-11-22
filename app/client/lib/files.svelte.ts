// Files beside the photos: the three lists (Dokumente, Tabellen, Präsentationen), the folders of the Ablage, and what a
// person does with them. The contract is docs/files.md.
import type { DocKind, DocList, DocSummary, FolderOut, FolderSummary, MoveIn } from "../../shared/types";
import { api, post } from "./api";

/** Each kind with its page, German name, the room it is painted in and its icon. */
export const KINDS = {
  doc: { path: "/dokumente", title: "Dokumente", one: "Dokument", room: "--esszimmer", icon: "dokumente" },
  sheet: { path: "/tabellen", title: "Tabellen", one: "Tabelle", room: "--garten", icon: "tabellen" },
  slides: { path: "/praesentationen", title: "Präsentationen", one: "Präsentation", room: "--seerosen", icon: "praesentationen" },
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
export function docList(kind: DocKind) {
  const s = $state({ docs: [] as DocSummary[], next: null as string | null, loading: false, loaded: false, error: "", q: "" });
  let seq = 0;
  async function fetchPage(cursor: string | null) {
    const my = ++seq;
    s.loading = true; s.error = "";
    try {
      const r = await api<DocList>(`/api/docs?kind=${kind}&limit=48${s.q ? `&q=${encodeURIComponent(s.q)}` : ""}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
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
