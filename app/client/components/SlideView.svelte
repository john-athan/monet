<script lang="ts">
  // A presentation: the current slide large, all slides as a strip below. Keys and swipe change the slide, the number
  // lives in the URL hash (#3) so a reload keeps the place. No transitions, no autoplay.
  import { SvelteSet } from "svelte/reactivity";
  import type { DocDetail } from "../../shared/types";
  import Icon from "./Icon.svelte";
  let { detail }: { detail: DocDetail } = $props();

  const count = $derived(Math.max(1, detail.pages ?? 1));
  const ratio = $derived(detail.w > 0 && detail.h > 0 ? detail.w / detail.h : 16 / 9);
  const fromHash = () => { const n = parseInt(location.hash.slice(1), 10); return Number.isFinite(n) ? n : 1; };
  // svelte-ignore state_referenced_locally
  let cur = $state(Math.min(Math.max(1, fromHash()), Math.max(1, detail.pages ?? 1)));
  const clamp = (n: number) => Math.min(count, Math.max(1, n));
  function show(n: number) {
    n = clamp(n);
    if (n === cur) return;
    cur = n;
    history.replaceState(history.state, "", `${location.pathname}${location.search}#${n}`);
  }
  // keep the hash in step when a reload landed on a slide that does not exist
  $effect(() => { if (cur > count) show(count); });

  // the neighbours are fetched before they are asked for
  $effect(() => { for (const n of [cur + 1, cur - 1, cur + 2]) if (n >= 1 && n <= count) new Image().src = `/media/doc/${detail.id}/p/${n}`; });

  $effect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || document.querySelector("[aria-modal='true']") || (e.target as Element)?.closest("input, textarea, select, [contenteditable]")) return;
      const to: Record<string, number> = { ArrowLeft: cur - 1, PageUp: cur - 1, ArrowRight: cur + 1, PageDown: cur + 1, Home: 1, End: count };
      if (!(e.key in to)) return;
      e.preventDefault(); e.stopPropagation(); show(to[e.key]);
    };
    // capture: before the app's own arrow keys
    addEventListener("keydown", k, true); return () => removeEventListener("keydown", k, true);
  });

  // swipe with a finger, a pen is a swipe too; the mouse uses the buttons
  let sx = 0, sy = 0, swiping = false;
  const down = (e: PointerEvent) => { sx = e.clientX; sy = e.clientY; swiping = e.pointerType !== "mouse"; };
  const up = (e: PointerEvent) => {
    if (!swiping) return; swiping = false;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) show(cur + (dx < 0 ? 1 : -1));
  };

  // thumbnails: only those near the strip's visible part get their picture
  const near = new SvelteSet<number>();
  let strip: HTMLElement | undefined = $state();
  function thumbs(el: HTMLElement) {
    const io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { near.add(Number((e.target as HTMLElement).dataset.n)); io.unobserve(e.target); } }, { root: el, rootMargin: "0px 700px" });
    el.querySelectorAll("[data-n]").forEach(b => io.observe(b));
    return () => io.disconnect();
  }
  // the current thumbnail stays in view
  $effect(() => {
    cur;
    const el = strip?.querySelector<HTMLElement>(`[data-n="${cur}"]`);
    if (!el || !strip) return;
    const a = el.offsetLeft, b = a + el.offsetWidth;
    if (a < strip.scrollLeft || b > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = a - (strip.clientWidth - el.offsetWidth) / 2;
  });
</script>

<div class="slides" style:--r={ratio}>
  <div class="stage" role="presentation" onpointerdown={down} onpointerup={up}>
    <img class="slide" src="/media/doc/{detail.id}/p/{cur}" alt="Folie {cur} von {count}" decoding="async" draggable="false" />
    {#if cur > 1}<button type="button" class="nav l" aria-label="Vorherige Folie" onclick={() => show(cur - 1)}><Icon name="back" size={22} sw={2} /></button>{/if}
    {#if cur < count}<button type="button" class="nav r" aria-label="Nächste Folie" onclick={() => show(cur + 1)}><Icon name="chevron" size={22} sw={2} /></button>{/if}
  </div>
  <p class="where tnum" role="status">Folie {cur} von {count}</p>
  <div class="strip" bind:this={strip} {@attach thumbs} role="group" aria-label="Alle Folien">
    {#each { length: count } as _, k (k)}
      {@const n = k + 1}
      <button type="button" class="th" class:on={n === cur} data-n={n} aria-label="Folie {n} von {count}" aria-current={n === cur ? "true" : undefined} onclick={() => show(n)}>
        {#if near.has(n)}<img src="/media/doc/{detail.id}/t/{n}" alt="" loading="lazy" decoding="async" draggable="false" />{/if}
        <span class="no tnum">{n}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .slides { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .stage { position: relative; flex: 1; min-height: 0; container-type: size; display: grid; place-items: center; padding: 12px; touch-action: pan-y; }
  .slide { display: block; width: min(100cqw, 100cqh * var(--r)); aspect-ratio: var(--r); object-fit: contain; background: var(--surface-2); border-radius: 6px; box-shadow: 0 1px 2px rgb(0 0 0 / .14), 0 8px 26px rgb(0 0 0 / .12); user-select: none; }
  .nav { position: absolute; top: 50%; transform: translateY(-50%); width: 44px; height: 44px; border: 0; border-radius: 50%; display: none; place-items: center; background: var(--glass); color: var(--ink); box-shadow: var(--shadow); }
  .nav:hover { background: var(--surface-2); } .nav.l { left: 14px; } .nav.r { right: 14px; }
  @media (min-width: 900px) { .nav { display: grid; } }
  .where { text-align: center; font-size: 12.5px; color: var(--muted); padding: 2px 0 6px; }
  .strip { flex: none; display: flex; gap: 8px; overflow-x: auto; overflow-y: hidden; padding: 6px 12px calc(10px + env(safe-area-inset-bottom)); overscroll-behavior-x: contain; border-top: 1px solid var(--rule); background: var(--surface); }
  .th { position: relative; flex: none; height: 62px; aspect-ratio: var(--r); padding: 0; border: 0; border-radius: 6px; overflow: hidden; background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--rule); }
  .th img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; object-fit: cover; }
  .th.on { box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--water); }
  .no { position: absolute; left: 4px; bottom: 3px; min-width: 16px; padding: 0 4px; border-radius: 8px; background: var(--glass); font-size: 10.5px; font-weight: 650; line-height: 16px; color: var(--ink); }
  @media (min-width: 900px) { .th { height: 76px; } }
</style>
