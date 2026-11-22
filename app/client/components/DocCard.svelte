<script lang="ts">
  // A file as a card: the cover (or, while it is being made or failed, the sign of its format), the title, format and date.
  import type { DocSummary } from "../../shared/types";
  import { within } from "../lib/state.svelte";
  import { KINDS, coverUrl, dayLabel, fileSign } from "../lib/files.svelte";
  import Link from "./Link.svelte";
  import Pick from "./Pick.svelte";
  let { doc, selectable = false, selected = false, ontoggle }: { doc: DocSummary; selectable?: boolean; selected?: boolean; ontoggle?: () => void } = $props();
  // a file of someone else (a search over the household) opens in their library
  const href = $derived(within(`/datei/${doc.id}`, doc.owner ?? undefined));
  const fallback = $derived(doc.kind === "doc" ? 3 / 4 : 4 / 3);
  const ratio = $derived(doc.w > 0 && doc.h > 0 ? Math.min(2.2, Math.max(0.45, doc.w / doc.h)) : fallback);
  let broken = $state(false);
  const shown = $derived(doc.state === "ok" && !broken);
  const room = $derived(KINDS[doc.kind].room);
</script>
<div class="card" class:on={selected}>
  <Link {href} raw class="a" aria-label="{doc.title}, {fileSign(doc.format)}, {dayLabel(doc.modifiedAt)}" tabindex={selectable ? -1 : undefined}>
    <span class="pic" style="aspect-ratio:{ratio}">
      {#if shown}<img src={coverUrl(doc.id)} width={doc.w > 0 ? doc.w : 3} height={doc.h > 0 ? doc.h : 4} alt="" loading="lazy" decoding="async" draggable="false" onerror={() => (broken = true)} />
      {:else}
        <span class="sign"><b>{fileSign(doc.format)}</b>{#if doc.state === "pending"}<span>Wird aufbereitet</span>{/if}</span>
        <span aria-hidden="true" class="dab" style="background:var({room})"></span>
      {/if}
    </span>
    <span class="t">{doc.title}</span>
    <span class="s tnum">{fileSign(doc.format)} · {dayLabel(doc.modifiedAt)}</span>
  </Link>
  {#if selectable}<Pick on={selected} ontoggle={() => ontoggle?.()} label={doc.title} />{/if}
</div>
<style>
  .card { position: relative; min-width: 0; border-radius: 12px; }
  .card :global(.a) { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .pic { position: relative; display: block; width: 100%; border-radius: 10px; overflow: hidden; background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--rule); }
  .card:hover .pic { filter: brightness(1.04) saturate(1.05); }
  img { display: block; width: 100%; height: 100%; object-fit: cover; background: var(--surface); }
  .sign { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; color: var(--muted); }
  .sign b { font-family: var(--font-display); font-size: 26px; font-weight: 400; letter-spacing: .02em; }
  .sign span { font-size: 11.5px; }
  .dab { position: absolute; left: 22%; right: 22%; bottom: 14%; height: 6px; border-radius: 3px; opacity: .55; transform: rotate(-3deg); }
  .t { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; font-weight: 600; font-size: 14px; line-height: 1.25; }
  .s { font-size: 12px; color: var(--muted); }
</style>
