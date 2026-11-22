<script lang="ts">
  // The timeline as day sections. Only the days near the viewport are in the DOM; the rest is known by its height
  // (lib/layout.ts), so the page is as tall as the whole library and the scrollbar and the band stay honest.
  import type { TimelineDay } from "../../shared/types";
  import { layoutDays, dayAt, visibleRange, PHONE } from "../lib/layout";
  import { light } from "../lib/state.svelte";
  import Tile from "./Tile.svelte";
  let { days, wide, onpos, onend }: { days: TimelineDay[]; wide: boolean; onpos?: (date: string) => void; onend?: () => void } = $props();

  let host: HTMLElement | undefined = $state();
  let width = $state(0), y0 = $state(0), vh = $state(innerHeight), hostTop = $state(0);
  const lay = $derived(layoutDays(days, width, wide));
  const range = $derived(visibleRange(lay, y0 - hostTop, y0 - hostTop + vh, vh * 1.2));
  const shown = $derived(days.slice(range[0], range[1]).map((d, k) => ({ d, i: range[0] + k })));

  function measure() {
    if (!host) return;
    y0 = scrollY; vh = innerHeight; hostTop = host.getBoundingClientRect().top + scrollY;
  }
  let raf = 0;
  const onscroll = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; measure(); }); };
  $effect(() => {
    if (!host) return;
    const ro = new ResizeObserver(() => { width = host!.clientWidth; measure(); });
    ro.observe(host); width = host.clientWidth; measure();
    addEventListener("scroll", onscroll, { passive: true }); addEventListener("resize", onscroll); addEventListener("monet-measure", measure);
    return () => { ro.disconnect(); removeEventListener("scroll", onscroll); removeEventListener("resize", onscroll); removeEventListener("monet-measure", measure); };
  });
  // which day is at the top of the screen, and whether the end is near
  $effect(() => {
    if (!days.length) return;
    const i = dayAt(lay, y0 - hostTop + 60);
    if (i >= 0) onpos?.(days[i].date);
    if (y0 + vh * 2.5 > hostTop + lay.total) onend?.();
  });

  export function scrollToDay(i: number) { scrollTo({ top: hostTop + (lay.days[i]?.top ?? 0), behavior: "auto" }); }
  export const dayCount = () => days.length;
</script>

<div class="tl" class:wide bind:this={host} style="height:{lay.total}px">
  {#each shown as { d, i } (d.date)}
    {@const L = lay.days[i]}
    <section class="day" data-flip={d.date} aria-label={d.title} style="top:{L.top}px;height:{L.height}px">
      <div class="head" style="height:{wide ? 50 : PHONE.head}px">
        <h2 style="color:{light() === 'nacht' ? d.signNight : d.sign}">{d.title}</h2>
        {#if d.place}<span class="place">{d.place}</span>{/if}
      </div>
      {#if wide}
        {#each L.rows ?? [] as r}
          <div class="row" style="height:{r.h}px">
            {#each r.tiles as t (d.items[t.i].id)}<div style="width:{t.w}px;height:{r.h}px"><Tile item={d.items[t.i]} sizes="{Math.round(t.w)}px" first={i === 0} /></div>{/each}
          </div>
        {/each}
      {:else}
        <div class="grid" style="grid-auto-rows:{L.cell}px">
          {#each d.items as it, k (it.id)}<div><Tile item={it} square sizes="34vw" first={i === 0 && k < 6} /></div>{/each}
        </div>
      {/if}
    </section>
  {/each}
</div>

<style>
  .tl { position: relative; }
  .day { position: absolute; left: 0; right: 0; overflow: hidden; }
  .head { display: flex; align-items: baseline; gap: 8px; padding: 14px 14px 7px; }
  h2 { font-family: var(--font-body); font-size: 16px; font-weight: 700; line-height: 1.45; }
  .place { font-size: 13px; color: var(--muted); }
  .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 2px; }
  .grid > div { min-width: 0; min-height: 0; }
  .wide .head { padding: 12px 0 0; gap: 10px; }
  .wide h2 { font-family: var(--font-display); font-size: 26px; line-height: 1.1; font-weight: 400; }
  .wide .place { font-size: 14px; }
  .row { display: flex; gap: 4px; margin-bottom: 4px; }
  .row:last-child { margin-bottom: 0; }
  .row > div { flex: none; }
</style>
