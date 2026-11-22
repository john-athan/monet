<script lang="ts">
  // One photo in a grid. A link to the viewer; in selection mode (or with Shift/Cmd) it toggles the selection instead.
  import type { ItemSummary } from "../../shared/types";
  import { go, sel, selectToggle, selectRange, within, member } from "../lib/state.svelte";
  import { duration, shortDate, word, durationWords } from "../lib/format";
  import Pic from "./Pic.svelte";
  import Icon from "./Icon.svelte";
  import { seen } from "../lib/motion";
  import { ground } from "../lib/ground";
  let { item, sizes = "33vw", square = false, mark = true, first = false }: { item: ItemSummary; sizes?: string; square?: boolean; mark?: boolean; first?: boolean } = $props();
  const on = $derived(sel.ids.has(item.id));
  // a photo of someone else (a search over the household) opens in their library, in their style
  const href = $derived(within(`/foto/${item.id}`, item.owner ?? undefined));
  const whose = $derived(item.owner ? member(item.owner)?.name ?? null : null);
  $effect(() => { seen.set(item.id, { r: item.w > 0 && item.h > 0 ? item.w / item.h : 0, color: item.color }); });
  const label = $derived((item.kind === "video" ? `Video, ${durationWords(item.durationMs ?? 0)}` : item.burst ? `${word(item.burst.count, false).replace(/^./, c => c.toUpperCase())} Aufnahmen in Folge` : "Foto") + ", " + shortDate(item.takenAt) + (whose ? `, von ${whose}` : "") + (on ? ", ausgewählt" : ""));
  function click(e: MouseEvent) {
    if (e.button !== 0 || e.altKey) return;
    if (e.shiftKey && (sel.on || sel.anchor !== null)) { e.preventDefault(); selectRange(item.id); return; }
    if (e.metaKey || e.ctrlKey) { e.preventDefault(); selectToggle(item.id); return; }
    e.preventDefault();
    if (sel.on) { selectToggle(item.id); return; }
    ground(item.id); // start painting the viewer's ground while the click becomes a page
    go(href, false, undefined, true);
  }
  // a video plays itself, muted, while the mouse rests on it; the file is only fetched once the mouse is there
  let hover = $state(false), live = $state(false);
  const preview = $derived(hover && item.kind === "video" && !sel.on);
  $effect(() => { if (!preview) live = false; });
  function key(e: KeyboardEvent) { if (e.key === " " && sel.on) { e.preventDefault(); selectToggle(item.id); } }
</script>
<a class="tile" class:on class:sel={sel.on} {href} data-item data-id={item.id} aria-label={label} onclick={click} onkeydown={key} onpointerenter={e => { if (e.pointerType === "mouse") hover = true; }} onpointerleave={() => (hover = false)} style="background:{item.color}">
  <Pic id={item.id} w={item.w} h={item.h} color={item.color} {sizes} {square} eager={first} />
  {#if preview}<video class="peek" class:live src="/media/{item.id}/o" muted autoplay loop playsinline disablepictureinpicture aria-hidden="true" tabindex="-1" onplaying={() => (live = true)}></video>{/if}
  {#if item.burst}<span class="badge l tnum"><Icon name="folge" size={12} sw={2.2} />{item.burst.count}</span>{/if}
  {#if whose}<span class="badge who">{whose}</span>{/if}
  {#if item.kind === "video"}<span class="badge r tnum"><Icon name="play" size={10} />{duration(item.durationMs ?? 0)}</span>{/if}
  {#if mark}
    <button type="button" class="check" tabindex="-1" aria-label={on ? "Auswahl aufheben" : "Auswählen"} aria-pressed={on} onclick={e => { e.preventDefault(); e.stopPropagation(); e.shiftKey ? selectRange(item.id) : selectToggle(item.id); }}>
      {#if on}<Icon name="check" size={13} sw={3} />{/if}
    </button>
  {/if}
</a>
<style>
  .tile { position: relative; display: block; width: 100%; height: 100%; overflow: hidden; }
  .tile:hover { filter: brightness(1.05) saturate(1.05); }
  /* Tupfer: chosen, the photo steps back into a mat of its own colour (the tile's background), a sun-coloured rim
     is painted round it and a dab of paint lands on the check */
  .tile :global(img) { transition: transform .3s cubic-bezier(.3,1.45,.5,1), border-radius .3s ease; }
  .tile.on :global(img) { transform: scale(.88); border-radius: 5px; }
  .tile::after { content: ""; position: absolute; inset: 0; box-shadow: inset 0 0 0 0 var(--sun); pointer-events: none; transition: box-shadow .2s ease; }
  .tile.on::after { box-shadow: inset 0 0 0 3px var(--sun); }
  .tile.on .check { animation: dab .347s cubic-bezier(.3,1.5,.5,1); }
  .tile.on .check::before { content: ""; position: absolute; inset: 0; border-radius: 42% 58% 61% 39% / 55% 38% 62% 45%; background: var(--sun); animation: splash .4s cubic-bezier(.2,.7,.3,1) both; pointer-events: none; z-index: -1; }
  .tile.on .check { isolation: isolate; }
  .tile.sel:not(.on) .check { animation: bud .213s ease-out; }
  @keyframes dab { 0% { transform: scale(.3) rotate(-30deg); border-radius: 38% 62% 54% 46% / 58% 42% 58% 42%; } 60% { transform: scale(1.18) rotate(6deg); border-radius: 55% 45% 40% 60% / 45% 58% 42% 55%; } 100% { transform: none; border-radius: 50%; } }
  @keyframes splash { from { transform: scale(.6) rotate(0); opacity: .6; } to { transform: scale(2.6) rotate(40deg); opacity: 0; } }
  @keyframes bud { from { transform: scale(.4); opacity: 0; } }
  .peek { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity .2s ease; pointer-events: none; }
  .peek.live { opacity: 1; }
  .badge { position: absolute; bottom: 5px; display: inline-flex; align-items: center; gap: 3px; padding: 2px 6px 2px 4px; border-radius: 9px; background: var(--veil); color: #FBF8F2; font-size: 11px; font-weight: 650; }
  .badge.l { left: 5px; } .badge.r { right: 5px; }
  .badge.who { top: 5px; right: 5px; bottom: auto; padding: 2px 7px; }
  .check { position: absolute; left: 8px; top: 8px; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 50%; display: grid; place-items: center; background: rgb(34 48 94 / .25); color: #fff; box-shadow: 0 0 0 1.5px #FBF8F2; opacity: 0; }
  .check::after { content: ""; position: absolute; inset: -11px; }
  .tile:hover .check, .tile:focus-visible .check { opacity: 1; }
  .tile.sel .check { opacity: 1; }
  .tile.on .check { opacity: 1; background: var(--sun); }
  @media (hover: none) { .tile .check { display: none; } .tile.sel .check { display: grid; } }
</style>
