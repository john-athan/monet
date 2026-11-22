<script lang="ts">
  // The cover of a book, a track or any other file, filling its parent (the parent sets the box and its proportions, so
  // nothing moves when the picture arrives). Without a cover: a book is drawn with its title and author, a track gets a
  // note, any other file the sign of its format. Text only ever goes into text nodes.
  import type { DocSummary } from "../../shared/types";
  import { KINDS, coverUrl, fileSign, hasCover } from "../lib/files.svelte";
  import Icon from "./Icon.svelte";
  let { doc, eager = false }: { doc: Pick<DocSummary, "id" | "kind" | "title" | "by" | "format" | "state" | "w" | "h">; eager?: boolean } = $props();
  let broken = $state(false);
  const ROOMS = ["--teich", "--esszimmer", "--seerosen", "--garten", "--atelier", "--water"];
  // the same book always gets the same colour
  const room = $derived(doc.kind === "book" || doc.kind === "audio" ? ROOMS[[...doc.title].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % ROOMS.length] : KINDS[doc.kind].room);
  const pic = $derived(doc.kind !== "other" && hasCover(doc as DocSummary) && !broken);
</script>
<span class="cv" style="--room:var({room})">
  {#if pic}
    <img src={coverUrl(doc.id)} width={doc.w} height={doc.h} alt="" loading={eager ? "eager" : "lazy"} decoding="async" draggable="false" onerror={() => (broken = true)} />
  {:else if doc.kind === "book"}
    <span class="book" aria-hidden="true">
      <span class="bt">{doc.title}</span>
      {#if doc.by}<span class="ba">{doc.by}</span>{/if}
      {#if doc.state === "pending"}<span class="bp">Wird aufbereitet</span>{/if}
    </span>
  {:else if doc.kind === "audio"}
    <span class="note" aria-hidden="true"><Icon name="audio" size={48} sw={1.4} /></span>
  {:else}
    <span class="sign" aria-hidden="true"><b>{fileSign(doc.format)}</b>{#if doc.state === "pending"}<span>Wird aufbereitet</span>{/if}</span>
    <span aria-hidden="true" class="dab" style="background:var({room})"></span>
  {/if}
</span>
<style>
  .cv { position: relative; display: block; width: 100%; height: 100%; overflow: hidden; container-type: inline-size; background: var(--surface-2); }
  img { display: block; width: 100%; height: 100%; object-fit: cover; background: var(--surface); }
  /* a drawn book: a cloth cover in the colour of a room, a spine on the left, the title in Didot */
  .book { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: space-between; gap: 6cqw; padding: 12cqw 9cqw 11cqw 17cqw; color: var(--ink);
    background: linear-gradient(90deg, color-mix(in oklab, var(--room) 70%, var(--ink) 12%) 0 7cqw, color-mix(in oklab, var(--room) 40%, transparent) 7cqw 8.5cqw, transparent 8.5cqw), color-mix(in oklab, var(--room) 34%, var(--surface)); }
  .bt { font-family: var(--font-display); font-size: clamp(11px, 11cqw, 26px); line-height: 1.12; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 5; line-clamp: 5; overflow: hidden; overflow-wrap: anywhere; }
  .ba { font-size: clamp(9px, 7cqw, 15px); line-height: 1.2; opacity: .8; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; }
  .bp { font-size: clamp(9px, 6cqw, 12px); opacity: .7; }
  .note { position: absolute; inset: 0; display: grid; place-items: center; color: var(--ink); background: color-mix(in oklab, var(--room) 28%, var(--surface)); }
  .note :global(svg) { width: 34cqw; height: 34cqw; opacity: .75; }
  .sign { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; color: var(--muted); }
  .sign b { font-family: var(--font-display); font-size: clamp(15px, 18cqw, 30px); font-weight: 400; letter-spacing: .02em; }
  .sign span { font-size: 11.5px; }
  .dab { position: absolute; left: 22%; right: 22%; bottom: 14%; height: 6px; border-radius: 3px; opacity: .55; transform: rotate(-3deg); }
</style>
