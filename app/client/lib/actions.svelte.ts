// What a person can do with photos: share, download, delete (with undo), favourite, albums.
import { SvelteSet } from "svelte/reactivity";
import { api, post } from "./api";
import { toast, closeToast, selectEnd } from "./state.svelte";
import { sink, reflow } from "./motion";

/** Items deleted from the user's point of view: every list hides them at once. The request goes out after the undo window. */
export const gone = new SvelteSet<number>();
const UNDO_MS = 6000;
let pending: { ids: number[]; timer: ReturnType<typeof setTimeout> }[] = [];

async function commit(ids: number[], keepalive = false) {
  const failed: number[] = [];
  await Promise.all(ids.map(id => fetch(`/api/items/${id}`, { method: "DELETE", credentials: "same-origin", keepalive }).then(r => { if (!r.ok) failed.push(id); }).catch(() => { failed.push(id); })));
  if (failed.length) { for (const id of failed) gone.delete(id); toast(failed.length === 1 ? "Das Foto konnte nicht gelöscht werden." : `${failed.length} Fotos konnten nicht gelöscht werden.`); }
}
export function deleteItems(ids: number[], after?: () => void) {
  if (!ids.length) return;
  // the tiles sink into the pond first; then they leave the lists and the others drift together
  const water = sink(ids);
  let undone = false;
  water.done.then(() => { if (!undone) reflow(() => { for (const id of ids) gone.add(id); water.cancel(); }, [], water.at); });
  const entry = { ids, timer: setTimeout(() => { pending = pending.filter(p => p !== entry); commit(ids); }, UNDO_MS) };
  pending.push(entry);
  selectEnd();
  toast(ids.length === 1 ? "Foto gelöscht" : `${ids.length} Fotos gelöscht`, { ms: UNDO_MS, action: { label: "Rückgängig", run: () => {
    clearTimeout(entry.timer); pending = pending.filter(p => p !== entry); undone = true; water.cancel();
    // they come up out of the pond again
    if (ids.some(id => gone.has(id))) reflow(() => { for (const id of ids) gone.delete(id); }, ids);
  } } });
  after?.();
}
// closing the tab inside the undo window still deletes what the person deleted
addEventListener("pagehide", () => { for (const p of pending) { clearTimeout(p.timer); commit(p.ids, true); } pending = []; });

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/gif": "gif", "video/mp4": "mp4", "video/quicktime": "mov" };
export function download(ids: number[]) {
  ids.forEach((id, i) => setTimeout(() => {
    const a = document.createElement("a");
    a.href = `/media/${id}/o`; a.download = ""; document.body.append(a); a.click(); a.remove();
  }, i * 350));
  if (ids.length > 1) toast(`${ids.length} Fotos werden geladen`);
}
/** Web Share with the files when the browser can, else the files are downloaded. */
export async function share(ids: number[]) {
  try {
    toast("Wird vorbereitet", { ms: 8000 });
    const files = await Promise.all(ids.map(async id => {
      const r = await fetch(`/media/${id}/o`, { credentials: "same-origin" });
      if (!r.ok) throw new Error("load");
      const b = await r.blob();
      return new File([b], `monet-${id}.${EXT[b.type] ?? "jpg"}`, { type: b.type });
    }));
    closeToast();
    if (navigator.canShare?.({ files })) { await navigator.share({ files }); return; }
    download(ids);
  } catch (e: any) {
    closeToast();
    if (e?.name === "AbortError") return;
    toast("Teilen hat nicht geklappt. Die Fotos werden stattdessen geladen."); download(ids);
  }
}
export async function setFavorite(id: number, favorite: boolean) { await api(`/api/items/${id}`, { method: "PATCH", json: { favorite } }); }
export async function addToAlbum(albumId: number, ids: number[]) { await post(`/api/albums/${albumId}/items`, { ids }); }
export async function createAlbum(name: string): Promise<{ id: number }> { return post("/api/albums", { name }); }
/** The album goes, its photos stay in the library. */
export async function deleteAlbum(id: number) { await api(`/api/albums/${id}`, { method: "DELETE" }); }
