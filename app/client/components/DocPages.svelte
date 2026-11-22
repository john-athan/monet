<script lang="ts">
  // The pages of a document stacked top to bottom. Every box has its proportions before its picture exists, and a
  // picture is only requested when its page is near the screen (and has stayed there a moment).
  import { SvelteMap, SvelteSet } from "svelte/reactivity";
  import type { DocDetail, FindHit } from "../../shared/types";
  import PageText from "./PageText.svelte";
  // marks: the hits of the viewer's search; focus: the current one, scrolled to (docs/together.md)
  let { detail, marks = [], focus = null }: { detail: DocDetail; marks?: FindHit[]; focus?: FindHit | null } = $props();
  type B = [number, number, number, number];
  const byPage = $derived.by(() => { const m = new Map<number, B[][]>(); for (const h of marks) if ("page" in h) (m.get(h.page) ?? m.set(h.page, []).get(h.page)!).push(h.boxes); return m; });
  let scroller: HTMLElement | undefined = $state();
  $effect(() => {
    if (!focus || !("page" in focus) || !scroller) return;
    const f = focus;
    wanted.add(f.page);
    const el = scroller.querySelector<HTMLElement>(`.page[data-n="${f.page}"]`);
    if (!el) return;
    const y = Math.min(...f.boxes.map(b => b[1]));
    scroller.scrollTo({ top: el.offsetTop + y * el.offsetHeight - scroller.clientHeight / 3, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  });

  const count = $derived(Math.max(1, detail.pages ?? 1));
  const base = $derived(detail.w > 0 && detail.h > 0 ? detail.w / detail.h : 1 / 1.414);
  // pages that turned out to have another shape than the first one
  const shape = new SvelteMap<number, number>();
  const wanted = new SvelteSet<number>();
  const loaded = new Set<number>();
  let current = $state(1);

  // a generous margin above and below; the delay keeps a fast drag over the scrollbar from requesting every page it passes
  function near(root: HTMLElement) {
    const timers = new Map<number, ReturnType<typeof setTimeout>>();
    const io = new IntersectionObserver(es => {
      for (const e of es) {
        const n = Number((e.target as HTMLElement).dataset.n);
        if (e.isIntersecting) {
          if (!wanted.has(n) && !timers.has(n)) timers.set(n, setTimeout(() => { timers.delete(n); wanted.add(n); }, 120));
        } else {
          clearTimeout(timers.get(n)); timers.delete(n);
          // far away and not arrived yet: drop the request
          if (!loaded.has(n)) wanted.delete(n);
        }
      }
    }, { root, rootMargin: "1600px 0px" });
    return { io, stop: () => { io.disconnect(); for (const t of timers.values()) clearTimeout(t); } };
  }
  // the page across the middle of the screen is the current one
  function middle(root: HTMLElement) {
    const io = new IntersectionObserver(es => {
      for (const e of es) if (e.isIntersecting) current = Number((e.target as HTMLElement).dataset.n);
    }, { root, rootMargin: "-50% 0px -49% 0px" });
    return io;
  }
  function watch(el: HTMLElement) {
    const root = el.closest<HTMLElement>(".scroll")!;
    const a = near(root), b = middle(root);
    el.querySelectorAll(".page").forEach(p => { a.io.observe(p); b.observe(p); });
    return () => { a.stop(); b.disconnect(); };
  }
  function loadedImg(n: number, e: Event) {
    loaded.add(n);
    const im = e.currentTarget as HTMLImageElement;
    if (im.naturalWidth && im.naturalHeight) {
      const r = im.naturalWidth / im.naturalHeight;
      if (Math.abs(r - base) / base > .01) shape.set(n, r);
    }
  }
</script>

<div class="scroll" bind:this={scroller}>
  <div class="pages" {@attach watch}>
    {#each { length: count } as _, k (k)}
      {@const n = k + 1}
      <figure>
        <div class="page" data-n={n} style:aspect-ratio={shape.get(n) ?? base}>
          {#if wanted.has(n)}
            <img src="/media/doc/{detail.id}/p/{n}" alt="Seite {n} von {count}" loading="lazy" decoding="async" onload={e => loadedImg(n, e)} />
            <PageText doc={detail.id} {n} ratio={shape.get(n) ?? base} marks={byPage.get(n) ?? []} focus={focus && "page" in focus && focus.page === n ? focus.boxes : null} />
          {/if}
        </div>
        <figcaption class="tnum">{n}</figcaption>
      </figure>
    {/each}
  </div>
  {#if count > 1}<p class="where tnum" role="status" aria-live="off">Seite {current} von {count}</p>{/if}
</div>

<style>
  .scroll { position: relative; flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; }
  .pages { box-sizing: border-box; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 18px 16px 80px; }
  figure { margin: 0; width: min(100%, 900px); }
  .page { position: relative; width: 100%; background: var(--surface-2); border-radius: 3px; overflow: hidden; box-shadow: 0 1px 2px rgb(0 0 0 / .14), 0 8px 26px rgb(0 0 0 / .12); }
  .page img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  figcaption { padding: 6px 0 12px; text-align: center; font-size: 12px; color: var(--muted); }
  .where { position: sticky; bottom: 14px; margin: -44px auto 0; width: max-content; padding: 6px 14px; border-radius: 16px; background: var(--glass); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); box-shadow: var(--shadow); font-size: 12.5px; font-weight: 600; color: var(--ink); pointer-events: none; }
  @media (max-width: 899px) { .pages { padding: 8px 0 80px; gap: 0; } .page { border-radius: 0; } }
</style>
