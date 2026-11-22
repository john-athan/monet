<script lang="ts">
  // Die Karte: a painted map of the geotagged photos. Canvas 2D only, no tiles, no request but our own two files.
  // Sea and land are brush dabs on a grid anchored to the world (they stay put while you pan); the photos are
  // bouquets of dabs in their own colours. It only moves with the hand: no fly-to, no easing.
  import type { MapOut, ItemSummary, PlaceOut } from "../../shared/types";
  import { api, post } from "../lib/api";
  import { count } from "../lib/format";
  import { openLand, level, levelFor, toPoints, boundsOf, cluster, members, bouquetRadius, fitBox, europeBox, lift, clampView, zoomAt, panBy, worldSize, wx, wy, nearestPlace, place as freeSpot, type Land, type Points, type View, type Cluster, type Box } from "../lib/map";
  import { MAP, type Brush } from "../lib/map-paint";
  import { technique } from "../lib/theme";
  import Sheet from "./Sheet.svelte";
  import Grid from "./Grid.svelte";
  import Loading from "./Loading.svelte";
  let { places }: { places: PlaceOut[] | null } = $props();

  let wrap: HTMLDivElement | undefined = $state(), cv: HTMLCanvasElement | undefined = $state();
  let total = $state(-1);                          // photos on the map, -1 while loading
  let sheetOpen = $state(false), sheetTitle = $state(""), sheetCount = $state(0), sheetItems = $state<ItemSummary[] | null>(null), sheetError = $state("");
  const label = $derived(total < 0 ? "Karte" : total === 0 ? "Karte ohne Fotos" : `Karte mit ${count(total, "Foto", "Fotos")} an ${places?.length ?? 0} ${places?.length === 1 ? "Ort" : "Orten"}`);

  // plain state of the drawing, not reactive: the canvas redraws itself
  let W = 0, H = 0, dpr = 1, view: View = { cx: 0.5, cy: 0.4, z: 2 }, touched = false, fitted = false;
  let pts: Points | null = null, land: Land | null = null, next: Int32Array | undefined;
  let hits: { x: number; y: number; r: number; c: Cluster }[] = [];
  let selected: { x: number; y: number; n: number } | null = null;
  let pal: Record<string, string> = {}, font = "serif", look = "monet";
  let dirty = false, raf = 0;
  const lifted = new Map<string, string>();

  const readPalette = () => {
    if (!wrap) return;
    const s = getComputedStyle(wrap), g = (k: string) => s.getPropertyValue(k).trim();
    pal = { water: g("--k-water"), w1: g("--k-w1"), w2: g("--k-w2"), w3: g("--k-w3"), land: g("--k-land"), g1: g("--k-g1"), g2: g("--k-g2"), oc: g("--k-oc"), li: g("--k-li"), surf: g("--k-surf"), halo: g("--k-halo"), rim: g("--k-rim"), ink: g("--ink"), sun: g("--sun") };
    font = g("--font-caption") || g("--font-display") || "serif";
    look = document.documentElement.dataset.theme || "monet";
  };
  const redraw = () => { if (dirty) return; dirty = true; raf = requestAnimationFrame(() => { dirty = false; draw(); }); };

  function fit() {
    const b = pts && pts.n ? boundsOf(pts) : null;
    view = b ? fitBox(b, W, H) : fitBox(europeBox, W, H, 0.04, 6);
    fitted = true;
  }

  function landPath(): Path2D | null {
    if (!land) return null;
    const lv = level(land, levelFor(view.z, land.levels)), S = worldSize(view.z);
    const left = view.cx - W / 2 / S, top = view.cy - H / 2 / S, right = left + W / S, bottom = top + H / S, m = 24 / S;
    const p = new Path2D(), lo = -2000, hiX = W + 2000, hiY = H + 2000;
    for (let r = 0; r < lv.n; r++) {
      const b = r * 4;
      if (lv.box[b + 2] < left - m || lv.box[b] > right + m || lv.box[b + 3] < top - m || lv.box[b + 1] > bottom + m) continue;
      if (Math.max(lv.box[b + 2] - lv.box[b], lv.box[b + 3] - lv.box[b + 1]) * S < 1.2) continue;   // under a pixel: nothing to see, and 9000 of them cost 200 ms
      const a = lv.start[r], z = lv.start[r + 1];
      // The outline is a chain of quadratic curves through the midpoints of the segments: a coarse coast (Malta has
      // a few dozen points) reads as a painted edge, not as a polygon. A run of points that all lie beyond the same
      // edge of the canvas is replaced by its first and last point: the segment between them stays beyond that
      // edge too, so what is on the canvas does not change, and a continent's 300 000 points cost a few ms.
      let px = 0, py = 0, k = 0, mask = 0, pend = false, qx = 0, qy = 0;
      const emit = (x: number, y: number) => {
        x = x < lo ? lo : x > hiX ? hiX : x; y = y < lo ? lo : y > hiY ? hiY : y;   // far off-screen corners stay in range
        if (k === 0) p.moveTo(x, y);
        else if (k === 1) p.lineTo((px + x) / 2, (py + y) / 2);
        else p.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
        px = x; py = y; k++;
      };
      for (let i = a; i < z; i++) {
        const x = (lv.pts[2 * i] - left) * S, y = (lv.pts[2 * i + 1] - top) * S;
        const code = (x < -50 ? 1 : x > W + 50 ? 2 : 0) | (y < -50 ? 4 : y > H + 50 ? 8 : 0);
        if (code && mask & code && i < z - 1) { mask &= code; pend = true; qx = x; qy = y; continue; }
        if (pend) { emit(qx, qy); pend = false; }
        else if (k > 0 && Math.abs(x - px) < 0.5 && Math.abs(y - py) < 0.5 && i < z - 1) continue;  // sub-pixel steps change nothing
        mask = code;
        emit(x, y);
      }
      p.closePath();
    }
    return p;
  }

  function draw() {
    if (!cv || !W || !H) return;
    const t0 = performance.now();
    if (!fitted && (pts || total === 0)) fit();
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    // sea and land in the technique of the style on screen (lib/map-paint.ts)
    const brush: Brush = { ctx, dpr, W, H, view, pal }, paint = MAP[technique(look).map];
    paint.sea(brush);
    const lp = landPath();
    if (lp) paint.land(brush, lp);
    // the photos
    hits = [];
    const taken: Box[] = [];
    if (pts && pts.n) {
      const r = cluster(pts, view, W, H, 28, next); next = r.next;
      const cs = r.clusters.sort((a, b) => a.n - b.n);
      ctx.font = "650 11px system-ui, sans-serif"; ctx.textBaseline = "alphabetic";
      for (const c of cs) {
        if (c.sx < -40 || c.sx > W + 40 || c.sy < -40 || c.sy > H + 40) continue;
        const R = bouquetRadius(c.n), seed = pts.ids[c.head], mem = c.n > 1 ? members(c, next) : [c.head];
        const colour = (i: number) => { const raw = pts!.color[i < 0 ? c.head : mem[Math.min(mem.length - 1, i)]]; return lifted.get(raw) ?? (lifted.set(raw, lift(raw)), lifted.get(raw)!); };
        paint.photo(brush, c.sx, c.sy, R, c.n, seed, colour);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const box = { x0: c.sx - R - 3, y0: c.sy - R * 0.8 - 3, x1: c.sx + R + 3, y1: c.sy + R * 0.8 + 3 };
        if (c.n > 1) {
          const t = String(c.n), tw = ctx.measureText(t).width, tx = c.sx + R * 0.62 + 3, ty = c.sy + R * 0.8 + 12;
          ctx.lineJoin = "round"; ctx.lineWidth = 3.5; ctx.strokeStyle = pal.halo; ctx.strokeText(t, tx, ty);
          ctx.fillStyle = pal.ink; ctx.fillText(t, tx, ty);
          box.x1 = Math.max(box.x1, tx + tw + 2); box.y1 = Math.max(box.y1, ty + 3);
        }
        taken.push(box); hits.push({ x: c.sx, y: c.sy, r: Math.max(R + 4, 12), c });
      }
    }
    // the names, the bigger places first; one that would overlap something drawn is left out
    if (places) {
      ctx.lineJoin = "round"; ctx.textAlign = "center";
      for (const p of [...places].sort((a, b) => b.count - a.count)) {
        const x = (wx(p.lon) - (view.cx - W / 2 / worldSize(view.z))) * worldSize(view.z), y = (wy(p.lat) - (view.cy - H / 2 / worldSize(view.z))) * worldSize(view.z);
        if (x < -60 || x > W + 60 || y < -30 || y > H + 30) continue;
        const size = 14 + Math.min(5, Math.log2(p.count + 1));
        ctx.font = `${size}px ${font}`;
        const tw = ctx.measureText(p.name).width, hh = size + 2;
        const at = freeSpot([
          { x0: x - tw / 2 - 2, y0: y + 16, x1: x + tw / 2 + 2, y1: y + 16 + hh },
          { x0: x - tw / 2 - 2, y0: y - 16 - hh, x1: x + tw / 2 + 2, y1: y - 16 },
        ], taken);
        if (!at || at.x0 < 4 || at.x1 > W - 4 || at.y0 < 4 || at.y1 > H - 4) continue;
        taken.push(at);
        const ty = at.y1 - 4;
        ctx.lineWidth = 4; ctx.strokeStyle = pal.halo; ctx.strokeText(p.name, x, ty);
        ctx.fillStyle = pal.ink; ctx.fillText(p.name, x, ty);
      }
      ctx.textAlign = "start";
    }
    // the selected cluster
    if (selected) {
      const S = worldSize(view.z), sx = (selected.x - (view.cx - W / 2 / S)) * S, sy = (selected.y - (view.cy - H / 2 / S)) * S;
      const R = bouquetRadius(selected.n);
      paint.selection(brush, sx, sy, R);
    }
    cv.dataset.ms = (performance.now() - t0).toFixed(2); cv.dataset.n = String(hits.length); cv.dataset.view = `${view.cx.toFixed(6)},${view.cy.toFixed(6)},${view.z.toFixed(2)}`;
  }

  /* ---------- the hand ---------- */
  const ptr = new Map<number, { x: number; y: number }>();
  let start = { x: 0, y: 0 }, moved = false, lastTap = { t: 0, x: 0, y: 0 };
  const local = (e: { clientX: number; clientY: number }) => { const r = cv!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const set = (v: View) => { view = v; touched = true; redraw(); };
  function down(e: PointerEvent) {
    cv!.setPointerCapture(e.pointerId); ptr.set(e.pointerId, local(e));
    if (ptr.size === 1) { start = local(e); moved = false; } else moved = true;
  }
  function move(e: PointerEvent) {
    const old = ptr.get(e.pointerId); if (!old) return;
    const now = local(e);
    if (ptr.size === 2) {
      const o = [...ptr.entries()], a = o[0][0] === e.pointerId ? now : o[0][1], b = o[1][0] === e.pointerId ? now : o[1][1], q0 = o[0][1], q1 = o[1][1];
      const d0 = Math.hypot(q0.x - q1.x, q0.y - q1.y) || 1, d1 = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const m0 = { x: (q0.x + q1.x) / 2, y: (q0.y + q1.y) / 2 }, m1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      ptr.set(e.pointerId, now);
      set(panBy(zoomAt(view, Math.log2(d1 / d0), m0.x, m0.y, W, H), m1.x - m0.x, m1.y - m0.y, W, H));
      return;
    }
    ptr.set(e.pointerId, now);
    if (!moved && Math.hypot(now.x - start.x, now.y - start.y) > 5) moved = true;
    if (moved) set(panBy(view, now.x - old.x, now.y - old.y, W, H));
  }
  function up(e: PointerEvent) {
    const had = ptr.delete(e.pointerId);
    if (!had || ptr.size || moved) return;
    tap(local(e));
  }
  function tap(p: { x: number; y: number }) {
    let best: (typeof hits)[number] | null = null, bd = Infinity;
    for (const h of hits) { const d = Math.hypot(h.x - p.x, h.y - p.y); if (d <= h.r + 6 && d < bd) { bd = d; best = h; } }
    if (best) { lastTap.t = 0; open(best.c); return; }
    const t = performance.now();
    if (t - lastTap.t < 340 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30) { lastTap.t = 0; set(zoomAt(view, 1, p.x, p.y, W, H)); }
    else lastTap = { t, x: p.x, y: p.y };
  }
  function wheel(e: WheelEvent) {
    e.preventDefault();
    const p = local(e), k = e.deltaMode === 1 ? 16 : 1, dz = Math.max(-1, Math.min(1, (-e.deltaY * k) * (e.ctrlKey ? 0.01 : 0.002)));
    set(zoomAt(view, dz, p.x, p.y, W, H));
  }
  function key(e: KeyboardEvent) {
    const s = e.shiftKey ? 240 : 80;
    const d: Record<string, [number, number]> = { ArrowLeft: [s, 0], ArrowRight: [-s, 0], ArrowUp: [0, s], ArrowDown: [0, -s] };
    if (d[e.key]) { e.preventDefault(); set(panBy(view, d[e.key][0], d[e.key][1], W, H)); }
    else if (e.key === "+" || e.key === "=") { e.preventDefault(); set(zoomAt(view, 0.5, W / 2, H / 2, W, H)); }
    else if (e.key === "-" || e.key === "_") { e.preventDefault(); set(zoomAt(view, -0.5, W / 2, H / 2, W, H)); }
  }

  let ticket = 0;
  async function open(c: Cluster) {
    if (!pts) return;
    const idx = members(c, next!), ids = idx.map(i => pts!.ids[i]).sort((a, b) => b - a);
    const near = places?.length ? nearestPlace(places, c.x, c.y) : null;
    selected = { x: c.x, y: c.y, n: c.n }; redraw();
    sheetTitle = near?.name ?? "Karte"; sheetCount = ids.length; sheetItems = null; sheetError = ""; sheetOpen = true;
    const me = ++ticket;
    try {
      const items = await post<ItemSummary[]>("/api/map/items", { ids: ids.slice(0, 2000) });
      if (me === ticket) sheetItems = items.sort((a, b) => b.takenAt - a.takenAt);
    } catch (e: any) { if (me === ticket) sheetError = e.message; }
  }
  $effect(() => { if (!sheetOpen && selected) { selected = null; redraw(); } });

  /* ---------- data and lifecycle ---------- */
  $effect(() => {
    let dead = false;
    api<MapOut>("/api/map").then(m => { if (dead) return; pts = toPoints(m); total = m.ids.length; fitted = touched; redraw(); }).catch(() => { if (!dead) total = 0; });
    fetch("/geo/land.bin").then(r => (r.ok ? r.arrayBuffer() : Promise.reject())).then(b => { if (dead) return; land = openLand(b); redraw(); }).catch(() => {});
    return () => { dead = true; };
  });
  $effect(() => { places; redraw(); });
  $effect(() => {
    if (!wrap || !cv) return;
    const size = () => {
      const r = wrap!.getBoundingClientRect(); dpr = Math.min(3, window.devicePixelRatio || 1);
      const w = Math.round(r.width), h = Math.round(r.height);
      if (w === W && h === H && cv!.width === Math.round(w * dpr)) return;
      W = w; H = h; cv!.width = Math.round(W * dpr); cv!.height = Math.round(H * dpr);
      if (fitted && !touched) fitted = false;       // a view nobody moved follows the box
      else if (fitted) view = clampView(view, W, H);
      redraw();
    };
    const ro = new ResizeObserver(size); ro.observe(wrap);
    const light = () => { readPalette(); redraw(); };
    const mo = new MutationObserver(light); mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-light", "data-theme", "class"] });
    const mq = matchMedia("(prefers-color-scheme: dark)"); mq.addEventListener("change", light);
    cv.addEventListener("wheel", wheel, { passive: false });
    readPalette(); size();
    return () => { ro.disconnect(); mo.disconnect(); mq.removeEventListener("change", light); cv?.removeEventListener("wheel", wheel); cancelAnimationFrame(raf); dirty = false; };
  });
</script>
<div class="karte" bind:this={wrap}>
  <canvas bind:this={cv} role="img" aria-label={label} tabindex="0" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onkeydown={key}></canvas>
  {#if total === 0}<p class="leer">Noch keine Fotos mit Ort.</p>{/if}
</div>
<Sheet bind:open={sheetOpen} label={sheetTitle}>
  <div class="kopf"><h2>{sheetTitle}</h2><p class="tnum">{count(sheetCount, "Foto", "Fotos")}</p></div>
  {#if sheetError}<p role="alert">{sheetError}</p>{:else if !sheetItems}<Loading />{:else}<Grid items={sheetItems} />{/if}
</Sheet>
<style>
  .karte {
    position: relative; width: 100%; height: 100%; overflow: hidden; border-radius: 16px; background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--rule);
  }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; cursor: grab; border-radius: inherit; }
  canvas:active { cursor: grabbing; }
  canvas:focus-visible { outline: 2px solid var(--sun); outline-offset: -2px; }
  .leer { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); margin: 0; padding: 6px 14px; border-radius: 14px; background: var(--glass); color: var(--ink); font-family: var(--font-display); font-style: italic; font-size: 17px; white-space: nowrap; pointer-events: none; }
  .kopf { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .kopf h2 { margin: 0; font-family: var(--font-display); font-weight: 400; font-size: 26px; }
  .kopf p { margin: 0; color: var(--muted); font-size: 13px; }
</style>
