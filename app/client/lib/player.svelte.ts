// The global audio player: one queue, one HTMLAudioElement for the whole app. It keeps playing while you move between
// pages; PlayerBar.svelte shows it, the lists and the viewer start it. The contract is docs/files.md (Audio).
import type { DocSummary } from "../../shared/types";
import { hasCover } from "./files.svelte";

export const player = $state({
  queue: [] as DocSummary[],
  /** index into queue, -1: nothing queued */
  index: -1,
  playing: false,
  /** seconds */
  pos: 0,
  /** seconds; from the file once it is known, else from the tags */
  dur: 0,
  error: "",
});

let el: HTMLAudioElement | null = null;
/** The track on the player (null: nothing is queued). */
export const current = (): DocSummary | null => player.queue[player.index] ?? null;
/** Whether this file is the track on the player. */
export const isCurrent = (id: number) => current()?.id === id;

function audio(): HTMLAudioElement {
  if (el) return el;
  const a = (el = new Audio());
  a.preload = "metadata";
  a.addEventListener("timeupdate", () => { player.pos = a.currentTime; });
  a.addEventListener("durationchange", () => { if (Number.isFinite(a.duration) && a.duration > 0) player.dur = a.duration; updatePosition(); });
  a.addEventListener("play", () => { player.playing = true; sync(); });
  a.addEventListener("pause", () => { player.playing = false; sync(); });
  a.addEventListener("ended", () => { if (player.index < player.queue.length - 1) next(); else { player.playing = false; player.pos = 0; a.currentTime = 0; sync(); } });
  a.addEventListener("error", () => { if (!current()) return; player.playing = false; player.error = "Dieser Titel lässt sich nicht abspielen."; sync(); });
  if ("mediaSession" in navigator) {
    const set = (k: MediaSessionAction, f: MediaSessionActionHandler) => { try { navigator.mediaSession.setActionHandler(k, f); } catch {} };
    set("play", () => resume()); set("pause", () => pause());
    set("previoustrack", () => prev()); set("nexttrack", () => next());
    set("seekto", d => { if (d.seekTime != null) seek(d.seekTime); });
  }
  return a;
}

function sync() {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.playbackState = !current() ? "none" : player.playing ? "playing" : "paused";
}
function updatePosition() {
  if (!("mediaSession" in navigator) || !player.dur || !el) return;
  try { navigator.mediaSession.setPositionState({ duration: player.dur, position: Math.min(el.currentTime, player.dur), playbackRate: el.playbackRate }); } catch {}
}
function announce(d: DocSummary) {
  if (!("mediaSession" in navigator)) return;
  const art = hasCover(d) ? [{ src: new URL(`/media/doc/${d.id}/c`, location.href).href, sizes: "480x480", type: "image/webp" }] : [];
  navigator.mediaSession.metadata = new MediaMetadata({ title: d.title, artist: d.by ?? "", album: d.album ?? "", artwork: art });
}

function load(i: number, start = true) {
  const d = player.queue[i]; if (!d) return;
  const a = audio();
  player.index = i; player.pos = 0; player.dur = (d.durationMs ?? 0) / 1000; player.error = "";
  a.src = `/media/doc/${d.id}/play`;
  announce(d);
  if (start) a.play().catch(() => { /* blocked or failed: the error event or the paused state says so */ });
}

/** Queue these tracks and play the one at `from`. */
export function play(queue: DocSummary[], from = 0) {
  if (!queue.length) return;
  player.queue = [...queue];
  load(Math.min(Math.max(0, from), queue.length - 1));
}
export function resume() { const a = audio(); if (current()) a.play().catch(() => {}); }
export function pause() { el?.pause(); }
export function toggle() { if (player.playing) pause(); else resume(); }
export function next() { if (player.index < player.queue.length - 1) load(player.index + 1); }
/** After the first seconds "previous" goes back to the start of the track, else to the track before. */
export function prev() {
  if (player.pos > 3 || player.index <= 0) seek(0); else load(player.index - 1);
}
export function seek(sec: number) {
  if (!el || !current()) return;
  el.currentTime = Math.max(0, player.dur ? Math.min(sec, player.dur) : sec);
  player.pos = el.currentTime; updatePosition();
}
/** Stop and forget the queue. */
export function close() {
  if (el) { el.pause(); el.removeAttribute("src"); el.load(); }
  Object.assign(player, { queue: [], index: -1, playing: false, pos: 0, dur: 0, error: "" });
  if ("mediaSession" in navigator) { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = "none"; }
}
