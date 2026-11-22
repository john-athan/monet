<script lang="ts">
  // A file as a card: the cover (or, while it is being made or failed, the sign of its format), the title, format and date.
  import type { DocSummary } from "../../shared/types";
  import { within } from "../lib/state.svelte";
  import { KINDS, coverUrl, dayLabel, fileSign } from "../lib/files.svelte";
  import { duration } from "../lib/format";
  import Link from "./Link.svelte";
  import CoverArt from "./CoverArt.svelte";
  import Pick from "./Pick.svelte";
  import Icon from "./Icon.svelte";
  // a stack (docs/together.md) is a small pile with its count; a click fans it out (`onopen`), its files carry `stackOf`
  let { doc, selectable = false, selected = false, ontoggle, stackOf = null, onopen, onclose }: { doc: DocSummary; selectable?: boolean; selected?: boolean; ontoggle?: () => void;
    stackOf?: number | null; onopen?: () => void; onclose?: () => void } = $props();
  const pile = $derived(!!doc.stack && stackOf == null && !!onopen);
  function click(e: MouseEvent) {
    if (!pile || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault(); e.stopPropagation(); onopen!();
  }
  // a file of someone else (a search over the household) opens in their library
  const href = $derived(within(`/datei/${doc.id}`, doc.owner ?? undefined));
  const fallback = $derived(doc.kind === "doc" ? 3 / 4 : 4 / 3);
  // books stand 2:3 on the shelf and tracks are square whatever the picture is, so the grid never jumps; the rest follows its first page
  const own = $derived(doc.kind === "book" || doc.kind === "audio" || doc.kind === "other");
  const ratio = $derived(doc.kind === "book" ? 2 / 3 : own ? 1 : doc.w > 0 && doc.h > 0 ? Math.min(2.2, Math.max(0.45, doc.w / doc.h)) : fallback);
  // the second line: a book its author, a track its artist and length, the rest format and date
  const line = $derived(doc.kind === "book" ? doc.by || "Buch" : doc.kind === "audio" ? [doc.by, doc.durationMs ? duration(doc.durationMs) : ""].filter(Boolean).join(" · ") || fileSign(doc.format) : `${fileSign(doc.format)} · ${dayLabel(doc.modifiedAt)}`);
  let broken = $state(false);
  const shown = $derived(doc.state === "ok" && !broken);
  const room = $derived(KINDS[doc.kind].room);
</script>
<div class="card" class:on={selected} class:pile data-doc={doc.id} data-stack={stackOf ?? undefined} onclickcapture={click}>
  <Link {href} raw class="a" aria-label="{doc.title}, {fileSign(doc.format)}, {dayLabel(doc.modifiedAt)}{pile ? `, Stapel mit ${doc.stack!.count} Dateien` : ''}" tabindex={selectable ? -1 : undefined}>
    <span class="pic" style="aspect-ratio:{ratio}">
      {#if pile}<span class="badge tnum"><Icon name="folge" size={12} sw={2.2} />{doc.stack!.count}</span>{/if}
      {#if own}<CoverArt {doc} />
      {:else if shown}<img src={coverUrl(doc.id)} width={doc.w > 0 ? doc.w : 3} height={doc.h > 0 ? doc.h : 4} alt="" loading="lazy" decoding="async" draggable="false" onerror={() => (broken = true)} />
      {:else}
        <span class="sign"><b>{fileSign(doc.format)}</b>{#if doc.state === "pending"}<span>Wird aufbereitet</span>{/if}</span>
        <span aria-hidden="true" class="dab" style="background:var({room})"></span>
      {/if}
    </span>
    <span class="t">{doc.title}</span>
    <span class="s tnum">{line}</span>
  </Link>
  {#if selectable}<Pick on={selected} ontoggle={() => ontoggle?.()} label={doc.title} />{/if}
  {#if stackOf === doc.id && onclose}<button type="button" class="fold" aria-label="Stapel zusammenlegen" title="Zusammenlegen" onclick={onclose}><Icon name="folge" size={14} sw={2.2} /></button>{/if}
</div>
<style>
  .card { position: relative; min-width: 0; border-radius: 12px; }
  /* a pile: two sheets peek out behind the cover, up and to the right */
  .pile .pic { box-shadow: inset 0 0 0 1px var(--rule), 5px -5px 0 -1px var(--surface), 5px -5px 0 0 var(--rule), 10px -10px 0 -2px var(--surface-2), 10px -10px 0 -1px var(--rule); }
  .badge { position: absolute; z-index: 2; right: 6px; bottom: 6px; display: inline-flex; align-items: center; gap: 3px; padding: 2px 6px 2px 4px; border-radius: 9px; background: var(--veil); color: #FBF8F2; font-size: 11px; font-weight: 650; }
  .fold { position: absolute; z-index: 2; top: 6px; right: 6px; width: 30px; height: 30px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 15px; background: var(--veil); color: #FBF8F2; cursor: pointer; }
  .card :global(.a) { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .pic { position: relative; display: block; width: 100%; border-radius: 10px; overflow: hidden; background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--rule); }
  .card:hover .pic { filter: brightness(1.04) saturate(1.05); }
  img { display: block; width: 100%; height: 100%; object-fit: cover; background: var(--surface); }
  .sign { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; color: var(--muted); }
  .sign b { font-family: var(--font-display); font-size: 26px; font-weight: 400; letter-spacing: .02em; }
  .sign span { font-size: 11.5px; }
  .dab { position: absolute; left: 22%; right: 22%; bottom: 14%; height: 6px; border-radius: 3px; opacity: .55; transform: rotate(-3deg); }
  .t { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; font-weight: 600; font-size: 14px; line-height: 1.25; }
  .s { font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
