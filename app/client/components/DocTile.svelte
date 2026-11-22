<script lang="ts">
  // A file among the photos of a day (docs/together.md): its cover laid on the day's ground like a sheet of paper, the
  // sign of its format, its title. A stack is a small pile of sheets with the count; a click fans it out (`onopen`).
  // A file of an open stack carries `data-stack`, so the fold can find its sheets.
  import type { DocSummary } from "../../shared/types";
  import { go, within } from "../lib/state.svelte";
  import { coverUrl, fileSign, dayLabel, KINDS } from "../lib/files.svelte";
  import CoverArt from "./CoverArt.svelte";
  import Icon from "./Icon.svelte";
  let { doc, stackOf = null, onopen, onclose, square = false }: { doc: DocSummary; stackOf?: number | null; onopen?: () => void; onclose?: () => void; square?: boolean } = $props();
  const href = $derived(within(`/datei/${doc.id}`, doc.owner ?? undefined));
  const pile = $derived(!!doc.stack && stackOf == null);
  const own = $derived(doc.kind === "book" || doc.kind === "audio" || doc.kind === "other");
  let broken = $state(false);
  const pic = $derived(doc.state === "ok" && !broken && doc.w > 0 && doc.h > 0 && !own);
  const label = $derived(`${doc.title}, ${fileSign(doc.format)}, ${dayLabel(doc.takenAt)}` + (pile ? `, Stapel mit ${doc.stack!.count} Dateien` : ""));
  function click(e: MouseEvent) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (pile) onopen?.(); else go(href, false, undefined, true);
  }
</script>
<a class="dt" class:pile class:square {href} data-doc={doc.id} data-stack={stackOf ?? undefined} aria-label={label} onclick={click} style="--room:var({KINDS[doc.kind].room})">
  {#if pile}<span class="sheet s2" aria-hidden="true"></span><span class="sheet s1" aria-hidden="true"></span>{/if}
  <span class="paper">
    {#if own}<CoverArt {doc} />
    {:else if pic}<img src={coverUrl(doc.id)} alt="" loading="lazy" decoding="async" draggable="false" onerror={() => (broken = true)} />
    {:else}<span class="sign"><b>{fileSign(doc.format)}</b></span>{/if}
  </span>
  <span class="cap"><span class="t">{doc.title}</span></span>
  {#if pile}<span class="badge tnum"><Icon name="folge" size={12} sw={2.2} />{doc.stack!.count}</span>
  {:else}<span class="fmt">{fileSign(doc.format)}</span>{/if}
  {#if stackOf === doc.id && onclose}
    <button type="button" class="fold" aria-label="Stapel zusammenlegen" title="Zusammenlegen" onclick={e => { e.preventDefault(); e.stopPropagation(); onclose(); }}><Icon name="folge" size={14} sw={2.2} /></button>
  {/if}
</a>
<style>
  .dt { position: relative; display: block; width: 100%; height: 100%; overflow: hidden; background: color-mix(in srgb, var(--room) 14%, var(--surface-2)); }
  /* the files of an open stack share a deeper ground, so they read as one */
  .dt[data-stack] { background: color-mix(in srgb, var(--room) 30%, var(--surface-2)); }
  .dt:hover .paper { transform: translateY(-2px) rotate(-.4deg); }
  .paper { position: absolute; inset: 10px 12px 30px; display: block; overflow: hidden; border-radius: 3px; background: var(--surface); box-shadow: 0 1px 2px rgb(34 48 94 / .18), 0 6px 16px -8px rgb(34 48 94 / .35); transition: transform .25s cubic-bezier(.3,1.4,.5,1); }
  .square .paper { inset: 8px 10px 26px; }
  img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top; }
  .sign { position: absolute; inset: 0; display: grid; place-items: center; color: var(--muted); }
  .sign b { font-family: var(--font-display); font-size: 22px; font-weight: 400; }
  .sheet { position: absolute; inset: 10px 12px 30px; border-radius: 3px; background: var(--surface); box-shadow: 0 1px 2px rgb(34 48 94 / .2); }
  .square .sheet { inset: 8px 10px 26px; }
  .s1 { transform: rotate(3.2deg) translate(3px, -2px); }
  .s2 { transform: rotate(-4deg) translate(-4px, 1px); opacity: .8; }
  .pile .paper { transform: rotate(-.6deg); }
  .cap { position: absolute; left: 10px; right: 40px; bottom: 6px; display: block; }
  .t { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 650; color: var(--ink); }
  .fmt, .badge { position: absolute; right: 7px; bottom: 5px; font-size: 10.5px; font-weight: 700; letter-spacing: .03em; color: var(--muted); }
  .badge { display: inline-flex; align-items: center; gap: 3px; padding: 2px 6px 2px 4px; border-radius: 9px; background: var(--veil); color: #FBF8F2; letter-spacing: 0; }
  .fold { position: absolute; top: 6px; right: 6px; width: 28px; height: 28px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 14px; background: var(--veil); color: #FBF8F2; cursor: pointer; }
  .fold::after { content: ""; position: absolute; inset: -8px; }
</style>
