// Stacks of files (docs/together.md): which one is fanned out, and its files. The fanned-out stack lives in the query
// (?stapel=<id>), so the back button folds it again and a reload keeps it open.
import type { DocSummary } from "../../shared/types";
import { api } from "./api";
import { app, pushQuery, setQuery } from "./state.svelte";
import { fanOut, fold } from "./motion";

export const stacks = $state({ open: null as number | null, files: [] as DocSummary[] });
const wanted = () => { const v = Number(new URLSearchParams(app.query).get("stapel")); return Number.isInteger(v) && v > 0 ? v : null; };

/** A click on a pile: a new history entry, the effect below fans it out. */
export const openStack = (id: number) => pushQuery(`stapel=${id}`);
/** The fold button: back where the stack was opened by a click, else just drop it from the query. */
export const closeStack = () => (history.state?.step ? history.back() : setQuery(""));

let busy = 0;
/** Call from a page's $effect: follows the query, fanning out or folding with the motion of motion.ts. */
export function followStacks() {
  const w = wanted();
  if (w === stacks.open) return;
  const my = ++busy;
  if (stacks.open != null && w == null) { const top = stacks.open; void fold(top, () => { stacks.open = null; stacks.files = []; }); return; }
  if (w == null) return;
  api<DocSummary[]>(`/api/docs/${w}/stack`).then(files => {
    if (my !== busy) return;
    fanOut(w, () => { stacks.open = w; stacks.files = files; });
  }).catch(() => { if (my === busy) setQuery(""); });
}
/** The files to show in place of a pile: the open stack's files (marked with their stack), else the pile itself. */
export function withStack<T extends DocSummary>(docs: T[]): (T & { stackOf?: number })[] {
  const top = stacks.open;
  if (top == null || !docs.some(d => d.id === top)) return docs;
  return docs.flatMap(d => (d.id === top ? stacks.files.map(f => ({ ...(f as T), stackOf: top })) : [d]));
}
