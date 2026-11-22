<script lang="ts">
  // The Pinselband, a working scrubber. Phone: thin and vertical at the right edge, newest at the top.
  // Desktop: a horizontal panorama under the header with year labels and a window at the current position.
  import { band } from "../lib/stores.svelte";
  import { fillMonths, dabs, forest, clouds, years } from "../lib/band";
  import { theme } from "../lib/state.svelte";
  import { technique } from "../lib/theme";
  import { monthShort, num } from "../lib/format";
  let { vertical }: { vertical: boolean } = $props();
  const filled = $derived(fillMonths(band.months, vertical));
  // the months in the style's band technique (shared/styles.ts): dabs, a forest wall of trunks, clouds in a day sky
  const kind = $derived(technique(theme()).band);
  const paint = $derived(kind === "dabs" ? dabs(filled, vertical) : []);
  const trunks = $derived(kind === "forest" ? forest(filled, vertical) : []);
  const sky = $derived(kind === "clouds" ? clouds(filled, vertical) : []);
  const labels = $derived(years(filled));
  const N = $derived(filled.length);
  const at = $derived(Math.max(0, filled.findIndex(m => m.ym === band.current)));
  let drag = $state<number | null>(null);
  const idx = $derived(drag ?? at);
  const pos = $derived(N ? ((idx + 0.5) / N) * 100 : 0);
  const month = $derived(filled[idx]);
  let el: HTMLElement | undefined = $state();
  let lastJump = 0;

  function indexAt(e: PointerEvent) {
    const r = el!.getBoundingClientRect(), f = vertical ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
    return Math.min(N - 1, Math.max(0, Math.floor(f * N)));
  }
  function down(e: PointerEvent) { if (!N) return; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag = indexAt(e); jump(true); }
  function move(e: PointerEvent) { if (drag === null) return; drag = indexAt(e); jump(false); }
  function up() { if (drag === null) return; jump(true); drag = null; }
  function jump(force: boolean) {
    const now = performance.now();
    if (!force && now - lastJump < 90) return;
    lastJump = now;
    if (drag !== null && filled[drag]) band.jump?.(filled[drag].ym);
  }
  function key(e: KeyboardEvent) {
    const d = e.key === (vertical ? "ArrowDown" : "ArrowRight") ? 1 : e.key === (vertical ? "ArrowUp" : "ArrowLeft") ? -1 : 0;
    if (!d || !N) return;
    e.preventDefault();
    const next = Math.min(N - 1, Math.max(0, idx + d));
    band.jump?.(filled[next].ym); band.current = filled[next].ym;
  }
</script>

{#snippet painting()}
  {#if kind === "forest"}
    <svg class="forest" viewBox={vertical ? `0 0 40 ${N * 10}` : `0 0 ${N * 10} 40`} preserveAspectRatio="none" aria-hidden="true">
      {#each trunks as t (t.key)}<path d={t.d} fill={t.fill} /><path d={t.scratch} class="scratch" />{/each}
    </svg>
  {:else if kind === "clouds"}
    {#each sky as c (c.key)}<span class="cloud" style={c.style}></span>{/each}
  {:else}
    {#each paint as d (d.key)}<span class="dab" style={d.style}></span>{/each}
  {/if}
{/snippet}

{#if vertical}
  <div class="v" style="--pos:{pos}%">
    <div class="paint" bind:this={el} role="slider" tabindex="0" aria-orientation="vertical" aria-label="Pinselband: die ganze Bibliothek, oben {filled[0] ? monthShort(filled[0].ym) : ''}, unten {filled.at(-1) ? monthShort(filled.at(-1)!.ym) : ''}" aria-valuemin={0} aria-valuemax={Math.max(0, N - 1)} aria-valuenow={idx} aria-valuetext={month ? monthShort(month.ym) : ""} onkeydown={key}
      onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}>
      {@render painting()}
    </div>
    {#if month}
      <div class="mark" aria-hidden="true">
        <span class="bubble tnum">{monthShort(month.ym)}</span><span class="sun" data-sun></span>
      </div>
    {/if}
  </div>
{:else}
  <section class="h" aria-label="Pinselband, die ganze Bibliothek">
    <div class="strip" bind:this={el} role="slider" tabindex="0" aria-label="Pinselband von {filled[0] ? monthShort(filled[0].ym) : ''} bis {filled.at(-1) ? monthShort(filled.at(-1)!.ym) : ''}" aria-valuemin={0} aria-valuemax={Math.max(0, N - 1)} aria-valuenow={idx} aria-valuetext={month ? monthShort(month.ym) : ""} onkeydown={key}
      onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}>
      {@render painting()}
      {#if N}
        <span class="win" aria-hidden="true" style="left:clamp(-4px, calc({pos}% - 11px), calc(100% - 18px))"></span>
        <span class="dot" data-sun aria-hidden="true" style="left:clamp(2px, calc({pos}% - 5px), calc(100% - 8px))"></span>
      {/if}
    </div>
    <div class="years tnum" aria-hidden="true">
      {#each labels as y}<span style="flex:{y.n} 1 0">{y.y}</span>{/each}
    </div>
    {#if month}<p class="sr" aria-live="polite">{monthShort(month.ym)}, {num(month.n)} {band.unit}</p>{/if}
  </section>
{/if}

<style>
  .v { position: fixed; z-index: 8; right: 5px; top: max(120px, min(312px, 100vh - 532px)); bottom: calc(env(safe-area-inset-bottom) + 172px); width: 12px; pointer-events: none; }
  .paint { position: absolute; inset: 0; right: 0; pointer-events: auto; touch-action: none; cursor: pointer; }
  .paint::before { content: ""; position: absolute; top: -14px; bottom: -14px; right: -5px; width: 44px; }
  .mark { position: absolute; right: -4px; top: var(--pos); transform: translateY(-50%); display: flex; align-items: center; gap: 5px; pointer-events: none; }
  .bubble { white-space: nowrap; padding: 3px 9px; border-radius: 11px; background: var(--ink); color: var(--on-ink); font-size: 12px; font-weight: 650; }
  .sun { width: 18px; height: 18px; border-radius: 50%; background: var(--sun); box-shadow: 0 0 0 2.5px var(--ground); }
  .h { padding: 0 24px 6px; }
  .strip { position: relative; height: 40px; touch-action: none; cursor: pointer; }
  .win { position: absolute; top: -5px; width: 22px; height: 50px; border-radius: 8px; box-shadow: 0 0 0 2px var(--ink); pointer-events: none; }
  .dot { position: absolute; top: -12px; width: 10px; height: 10px; border-radius: 50%; background: var(--sun); box-shadow: 0 0 0 2px var(--ground); pointer-events: none; }
  /* Ernst: the forest wall stands on the band's lower edge; Magritte: the band is a strip of day sky */
  .forest { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
  .scratch { fill: none; stroke: var(--scratch); stroke-width: 1; stroke-opacity: .55; vector-effect: non-scaling-stroke; }
  .cloud { position: absolute; border-radius: 50% 50% 40% 40% / 70% 70% 30% 30%; background: var(--cloud); box-shadow: inset 0 -2px 0 var(--tint); transform: translate(-50%, -50%); }
  .cloud::before, .cloud::after { content: ""; position: absolute; border-radius: 50%; background: var(--cloud); }
  .cloud::before { width: 55%; height: 120%; left: 14%; top: -55%; }
  .cloud::after { width: 42%; height: 95%; left: 46%; top: -35%; }
  .v .cloud { transform: translateY(-50%); }
  :global(:root[data-theme=magritte]) .strip { background: var(--sky-band); }
  :global(:root[data-theme=magritte]) .paint { background: var(--sky-band-v); border-radius: 2px; }
  :global(:root[data-theme=ernst]) .win, :global(:root[data-theme=magritte]) .win { border-radius: 0; }
  :global(:root[data-theme=magritte]) .win { box-shadow: 0 0 0 1.5px var(--ink), 0 0 0 4px var(--surface), 0 0 0 5px var(--ink); }
  .years { display: flex; padding-top: 4px; font-size: 11.5px; color: var(--muted); }
  .years span { border-left: 1px solid var(--rule); padding-left: 4px; overflow: hidden; white-space: nowrap; }
</style>
