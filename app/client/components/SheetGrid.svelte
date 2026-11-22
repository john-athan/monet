<script lang="ts">
  // A spreadsheet as a virtual grid: only the rows and columns on screen exist as elements, and only the windows of rows
  // the screen needs are fetched. Column letters and row numbers stay put while the cells scroll under them.
  import { SvelteMap } from "svelte/reactivity";
  import type { DocDetail, FindHit, SheetRows } from "../../shared/types";
  import { api } from "../lib/api";
  import { num } from "../lib/format";
  // marks: the cells the viewer's search found; focus: the current one, scrolled to (docs/together.md)
  let { detail, marks = [], focus = null }: { detail: DocDetail; marks?: FindHit[]; focus?: FindHit | null } = $props();

  const ROW = 28, HEAD = 28, ROWW = 56, WIN = 200, OVER = 6, MAXWIN = 40, PAR = 3;
  let cur = $state(0);
  const sheet = $derived(detail.sheets[cur] ?? { name: "", rows: 0, cols: 0, truncated: false });
  const rows = $derived(sheet.rows), cols = $derived(sheet.cols);

  // A, B, ... Z, AA, AB ...
  const colName = (i: number) => { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
  // German and English notation, with a sign, a currency or a percent mark
  const NUMBER = /^[-+]?[€$£]?\s?(?:\d+|\d{1,3}(?:[.,\s]\d{3})+)(?:[.,]\d+)?\s?[%€$£]?$/;
  const isNum = (v: string) => v.length < 28 && NUMBER.test(v);

  // ---- the windows of rows
  const cache = new SvelteMap<string, string[][]>();
  const inflight = new Set<string>();
  let failed = $state(false);
  const key = (s: number, w: number) => `${s}:${w}`;
  const cell = (r: number) => cache.get(key(cur, Math.floor(r / WIN)))?.[r % WIN];

  async function fetchWin(s: number, w: number) {
    const k = key(s, w);
    inflight.add(k);
    try {
      const r = await api<SheetRows>(`/api/docs/${detail.id}/sheet/${s}?from=${w * WIN}&n=${WIN}`);
      cache.set(k, r.rows);
      if (cache.size > MAXWIN) { // forget the windows farthest from where we are
        const here = Math.floor(first / WIN);
        const far = [...cache.keys()].sort((a, b) => Math.abs(Number(b.split(":")[1]) - here) - Math.abs(Number(a.split(":")[1]) - here))[0];
        if (far !== k) cache.delete(far);
      }
      failed = false;
    } catch { failed = true; }
    finally { inflight.delete(k); }
  }

  // ---- geometry
  let sc: HTMLDivElement | undefined = $state();
  let top = $state(0), left = $state(0), vw = $state(800), vh = $state(600);
  let widths = $state<number[][]>([]);
  const colW = $derived(widths[cur] ?? Array.from({ length: cols }, () => 100));
  const colX = $derived.by(() => { const x = new Array<number>(colW.length + 1); x[0] = 0; for (let i = 0; i < colW.length; i++) x[i + 1] = x[i] + colW[i]; return x; });
  const totalW = $derived(ROWW + colX[colW.length]), totalH = $derived(HEAD + rows * ROW);

  // widths from the first window: the longest of the first rows, in characters, clamped
  function measure(first: string[][]) {
    const w: number[] = [];
    for (let c = 0; c < cols; c++) {
      let m = colName(c).length;
      for (let r = 0; r < Math.min(first.length, 60); r++) m = Math.max(m, (first[r]?.[c] ?? "").length);
      w.push(Math.min(320, Math.max(60, Math.round(m * 7.4 + 22))));
    }
    widths[cur] = w;
  }

  const first = $derived(Math.max(0, Math.floor((top - HEAD) / ROW) - OVER));
  const last = $derived(Math.min(rows - 1, Math.ceil((top + vh - HEAD) / ROW) + OVER));
  const vis = $derived.by(() => {
    const a = left - ROWW - 200, b = left + vw - ROWW + 200;
    let c0 = 0; while (c0 < colW.length && colX[c0 + 1] < a) c0++;
    let c1 = c0; while (c1 < colW.length && colX[c1] < b) c1++;
    return { c0, c1: Math.max(c0, c1 - 1) };
  });
  const rowList = $derived(rows ? Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i) : []);
  const colList = $derived(colW.length ? Array.from({ length: vis.c1 - vis.c0 + 1 }, (_, i) => vis.c0 + i).filter(c => c < colW.length) : []);

  // fetch what the screen shows, nearest the middle first, a few at a time. Reads cache.size, so a window that
  // arrived frees a slot for the next one.
  function pump() {
    if (!rows) return;
    const s = cur, a = Math.floor(first / WIN), b = Math.floor(Math.max(first, last) / WIN), mid = (first + last) / 2 / WIN;
    const need: number[] = [];
    for (let w = a; w <= b; w++) if (!cache.has(key(s, w)) && !inflight.has(key(s, w))) need.push(w);
    // the first window also gives the column widths
    if (!cache.has(key(s, 0)) && !inflight.has(key(s, 0)) && !need.includes(0)) need.push(0);
    need.sort((x, y) => Math.abs(x - mid) - Math.abs(y - mid));
    for (const w of need) { if (inflight.size >= PAR) break; fetchWin(s, w); }
  }
  $effect(() => { cache.size; cur; first; last; pump(); });
  $effect(() => { const w0 = cache.get(key(cur, 0)); if (w0 && !widths[cur]) measure(w0); });

  let raf = 0;
  function onscroll() {
    if (raf || !sc) return;
    raf = requestAnimationFrame(() => { raf = 0; if (!sc) return; top = sc.scrollTop; left = sc.scrollLeft; });
  }
  function watchSize(el: HTMLElement) {
    const ro = new ResizeObserver(() => { vw = el.clientWidth; vh = el.clientHeight; top = el.scrollTop; left = el.scrollLeft; });
    ro.observe(el);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }
  function pick(i: number) {
    if (i === cur) return;
    cur = i; failed = false; top = 0; left = 0;
    sc?.scrollTo(0, 0);
  }
  function retry() { failed = false; pump(); }
  const hitKeys = $derived(new Set(marks.flatMap(h => ("sheet" in h && h.sheet === cur ? [`${h.row}:${h.col}`] : []))));
  const onKey = $derived(focus && "sheet" in focus && focus.sheet === cur ? `${focus.row}:${focus.col}` : "");
  $effect(() => {
    if (!focus || !("sheet" in focus)) return;
    const f = focus;
    if (f.sheet !== cur) pick(f.sheet);
    requestAnimationFrame(() => sc?.scrollTo({ top: Math.max(0, HEAD + f.row * ROW - vh / 3), left: Math.max(0, colX[f.col] ?? 0) - 40 }));
  });
</script>

<div class="sheetview">
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="grid" bind:this={sc} {@attach watchSize} onscroll={onscroll} tabindex="0" role="region" aria-label="Tabelle {sheet.name}">
    {#if !rows || !cols}
      <p class="empty">Dieses Blatt ist leer.</p>
    {:else}
      <div class="canvas" style:width="{totalW}px" style:height="{totalH}px">
        <div class="heads" style:width="{totalW}px" style:height="{HEAD}px">
          <span class="corner" style:width="{ROWW}px"></span>
          <div class="hrow" style:left="{ROWW + colX[colList[0] ?? 0]}px">
            {#each colList as c (c)}<span class="h" style:width="{colW[c]}px">{colName(c)}</span>{/each}
          </div>
        </div>
        <div class="nums" style:width="{ROWW}px" style:height="{totalH}px">
          {#each rowList as r (r)}<span class="n tnum" style:top="{HEAD + r * ROW}px">{r + 1}</span>{/each}
        </div>
        {#each rowList as r (r)}
          {@const data = cell(r)}
          <div class="r" style:top="{HEAD + r * ROW}px" style:left="{ROWW + colX[colList[0] ?? 0]}px">
            {#each colList as c (c)}
              {@const v = data?.[c] ?? ""}
              <span class="c" class:num={v !== "" && isNum(v)} class:hit={hitKeys.has(`${r}:${c}`)} class:on={onKey === `${r}:${c}`} style:width="{colW[c]}px" title={v || undefined}>{v}</span>
            {/each}
          </div>
        {/each}
      </div>
    {/if}
  </div>
  <div class="foot">
    {#if detail.sheets.length > 1}
      <div class="tabs" role="tablist" aria-label="Blätter">
        {#each detail.sheets as s, i}
          <button type="button" role="tab" class:on={i === cur} aria-selected={i === cur} onclick={() => pick(i)}>{s.name || `Blatt ${i + 1}`}</button>
        {/each}
      </div>
    {:else}<span class="tabs"></span>{/if}
    <span class="note tnum">
      {#if failed}<button type="button" class="again" onclick={retry}>Zeilen konnten nicht geladen werden. Nochmal versuchen</button>
      {:else if sheet.truncated}Zeigt die ersten {num(rows)} Zeilen
      {:else if rows}{num(rows)} {rows === 1 ? "Zeile" : "Zeilen"}, {num(cols)} {cols === 1 ? "Spalte" : "Spalten"}{/if}
    </span>
  </div>
</div>

<style>
  .sheetview { flex: 1; min-height: 0; display: flex; flex-direction: column; min-width: 0; }
  .grid { position: relative; flex: 1; min-height: 0; min-width: 0; overflow: auto; overscroll-behavior: contain; background: var(--surface); font-size: 13px; }
  .grid:focus-visible { outline-offset: -2px; }
  .canvas { position: relative; }
  .heads { position: sticky; top: 0; z-index: 3; margin-bottom: -28px; background: var(--surface-2); border-bottom: 1px solid var(--rule); box-sizing: border-box; }
  .corner { position: sticky; left: 0; z-index: 4; display: block; height: 100%; background: var(--surface-2); border-right: 1px solid var(--rule); box-sizing: border-box; }
  .hrow { position: absolute; top: 0; display: flex; height: 100%; }
  .h { flex: none; display: block; height: 100%; line-height: 27px; text-align: center; color: var(--muted); font-size: 12px; font-weight: 650; border-right: 1px solid var(--rule); box-sizing: border-box; }
  .nums { position: sticky; left: 0; z-index: 2; background: var(--surface-2); border-right: 1px solid var(--rule); box-sizing: border-box; }
  .n { position: absolute; left: 0; right: 0; height: 28px; line-height: 27px; text-align: center; color: var(--muted); font-size: 12px; border-bottom: 1px solid var(--rule); box-sizing: border-box; }
  .r { position: absolute; display: flex; height: 28px; }
  .c { flex: none; display: block; height: 100%; padding: 0 8px; line-height: 27px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-right: 1px solid var(--rule); border-bottom: 1px solid var(--rule); box-sizing: border-box; }
  .c.num { text-align: right; font-variant-numeric: tabular-nums; }
  .c.hit { background: rgb(255 214 0 / .3); }
  .c.on { background: rgb(255 140 0 / .45); box-shadow: inset 0 0 0 2px rgb(224 104 0); }
  .empty { padding: 28px 18px; color: var(--muted); }
  .foot { flex: none; display: flex; align-items: center; gap: 12px; min-height: 40px; padding: 0 8px calc(env(safe-area-inset-bottom)) 8px; border-top: 1px solid var(--rule); background: var(--surface); }
  .tabs { flex: 1; min-width: 0; display: flex; gap: 4px; overflow-x: auto; padding: 4px 0; }
  .tabs button { flex: none; max-width: 220px; height: 32px; padding: 0 14px; border: 0; border-radius: 16px; background: transparent; font-size: 13.5px; font-weight: 600; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tabs button:hover { background: var(--surface-2); }
  .tabs button.on { background: var(--water-soft); color: var(--ink); }
  .note { flex: none; font-size: 12.5px; color: var(--muted); }
  .again { border: 0; background: none; padding: 8px 4px; color: var(--water); font-weight: 600; font-size: 12.5px; }
</style>
