<script lang="ts">
  // The photo in the viewer, zoomable to its last pixel. The base is the 2048 px copy; past that, tiles of the
  // pyramid (server/zoom.ts) for exactly the part on screen. The original can be laid over it: by hand ("Original"),
  // or by itself on an HDR screen when the photo is HDR, so the browser shows it in HDR.
  //   pinch, Ctrl/trackpad wheel or Safari's gesture: zoom; drag or two-finger scroll: move; double-click or -tap:
  //   fit <-> 1:1; + - 0 and arrows from the page (zoomBy, reset, panBy). Fitted, a sideways swipe calls onswipe.
  import { api } from "../lib/api";
  import { afterMotion } from "../lib/motion";
  import { clamp, zoomAt, levelFor, tilesFor, maxScale, oneToOne, type View, type Box, type Pyramid, type Tile } from "../lib/zoom";
  // Faces: a frame over each detected face (x, y, w, h as parts of the picture), shown while the pointer is over the
  // picture and for the face that is `hot` (hovered here or in the details). A tap or click on a frame calls onface.
  type Info = Pyramid & { ready: boolean; hdr: boolean; mime: string; bytes: number };
  type Face = { id: number; x: number; y: number; w: number; h: number; label: string };
  let { id, ratio, alt, imgW, onswipe, onoriginalfail, faces = [], onface, hot = $bindable(null), zoomed = $bindable(false), hdr = $bindable(false), original = $bindable(false), info = $bindable(null) }:
    { id: number; ratio: number; alt: string; imgW: number; onswipe?: (dir: 1 | -1) => void; onoriginalfail?: () => void; faces?: Face[]; onface?: (id: number) => void; hot?: number | null; zoomed?: boolean; hdr?: boolean; original?: boolean; info?: Info | null } = $props();

  let surf: HTMLDivElement | undefined = $state(), frame: HTMLDivElement | undefined = $state();
  let v = $state<View>({ s: 1, x: 0, y: 0 }), anim = $state(false);
  let box = $state<Box>({ fx: 0, fy: 0, fw: 1, fh: 1, W: 1, H: 1 });
  const dpr = () => devicePixelRatio || 1;
  const fullW = $derived(info?.w ?? imgW);
  const sMax = $derived(maxScale(box, fullW, dpr()));
  $effect(() => { zoomed = v.s > 1.01; });

  function measure() {
    if (!surf || !frame) return;
    box = { fx: frame.offsetLeft, fy: frame.offsetTop, fw: frame.offsetWidth || 1, fh: frame.offsetHeight || 1, W: surf.clientWidth, H: surf.clientHeight };
    v = clamp(v, box, sMax);
  }
  $effect(() => {
    if (!surf) return;
    const ro = new ResizeObserver(measure); ro.observe(surf); if (frame) ro.observe(frame);
    return () => ro.disconnect();
  });
  // where the picture really lies in the frame (object-fit: contain): the face frames are laid over that, not over
  // the frame, so a size in the details that does not match the picture cannot shift them
  let natural = $state(0);
  const pic = $derived.by(() => {
    const fr = box.fw / box.fh;
    if (!natural || !fr) return { l: 0, t: 0, w: 100, h: 100 };
    return natural > fr ? { l: 0, w: 100, h: fr / natural * 100, t: (100 - fr / natural * 100) / 2 } : { t: 0, h: 100, w: natural / fr * 100, l: (100 - natural / fr * 100) / 2 };
  });
  // also when the picture came from the cache before the handler was there
  const measurePic = (im: HTMLImageElement) => {
    const read = () => { if (im.naturalWidth) natural = im.naturalWidth / im.naturalHeight; };
    read(); im.addEventListener("load", read); return () => im.removeEventListener("load", read);
  };
  const set = (n: View, animate = false) => { anim = animate; v = clamp(n, box, sMax); };

  // ---- what the page can ask for
  export function zoomBy(k: number) { set(zoomAt(v, v.s * k, box.W / 2, box.H / 2, box), true); }
  export function reset() { set({ s: 1, x: 0, y: 0 }, true); }
  export function panBy(dx: number, dy: number) { set({ ...v, x: v.x + dx, y: v.y + dy }, true); }

  // ---- the pyramid: asked for when the photo opens (the server starts cutting), asked again while it is not ready
  let poll: ReturnType<typeof setTimeout> | undefined;
  async function load() {
    try {
      const r = await api<Info>(`/api/items/${id}/zoom`);
      info = r; hdr = r.hdr;
      if (!r.ready && zoomed) poll = setTimeout(load, 900);
    } catch {}
  }
  $effect(() => { load(); return () => clearTimeout(poll); });
  $effect(() => { if (zoomed && info && !info.ready) { clearTimeout(poll); poll = setTimeout(load, 300); } });

  // ---- tiles for what is on screen, at the level the screen needs (the 2048 copy is the base)
  const baseW = $derived(fullW * Math.min(1, 2048 / Math.max(fullW, fullW / (ratio || 1))));
  let tiles = $state<Tile[]>([]);
  let tileTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const p = info, view = v, b = box, orig = original;
    clearTimeout(tileTimer);
    if (!p?.ready || orig) { tiles = []; return; }
    // while the fingers move, the tiles follow a little later; the base keeps the picture whole meanwhile
    tileTimer = setTimeout(() => { tiles = tilesFor(p, levelFor(p, b, view.s, dpr(), baseW), view, b); }, 90);
  });

  // ---- the original over the base: by hand, or on an HDR screen for an HDR photo
  // It never takes part in a transition: decoded off the page once the motion is over (an HDR original with its gain
  // map is heavy), then that very element is put in and fades in.
  let origOk = $state(false), origEl = $state<HTMLImageElement | null>(null);
  $effect(() => {
    if (!original) { origEl = null; origOk = false; return; }
    let live = true;
    (async () => {
      await afterMotion();
      const im = new Image(); im.decoding = "async"; im.alt = ""; im.draggable = false; im.className = "orig"; im.src = `/media/${id}/o`;
      try { await im.decode(); } catch { if (live) { original = false; onoriginalfail?.(); } return; }
      if (!live) return;
      await afterMotion();
      if (live) origEl = im;
    })();
    return () => { live = false; };
  });
  const put = (host: HTMLElement) => {
    const im = origEl;
    if (!im) return;
    host.append(im);
    requestAnimationFrame(() => requestAnimationFrame(() => { origOk = true; }));
    return () => im.remove();
  };
  const hdrScreen = matchMedia("(dynamic-range: high)").matches;
  const saveData = (navigator as any).connection?.saveData === true;
  let auto = false; // once per photo, so switching it off by hand stays off
  $effect(() => {
    if (auto || !info || !hdrScreen || saveData || !info.hdr) return;
    auto = true;
    // a phone decodes the whole original at once: only up to 24 megapixels there
    if (innerWidth < 900 && info.w * info.h > 24e6) return;
    original = true;
  });

  // ---- gestures
  const pts = new Map<number, { x: number; y: number }>();
  let start: { v: View; d: number; mx: number; my: number } | null = null;
  let last = { x: 0, y: 0, t: 0 }, vel = { x: 0, y: 0 }, swipe = { x: 0, y: 0, t: 0 }, tap = { t: 0, x: 0, y: 0 }, coast = 0;
  const local = (e: { clientX: number; clientY: number }) => { const r = surf!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  let lastType = "mouse";
  function down(e: PointerEvent) {
    lastType = e.pointerType;
    if ((e.target as Element).closest("button:not(.fb), a, video")) return;
    cancelAnimationFrame(coast); anim = false;
    surf!.setPointerCapture(e.pointerId);
    const p = local(e); pts.set(e.pointerId, p);
    if (pts.size === 1) { swipe = { ...p, t: e.timeStamp }; last = { ...p, t: e.timeStamp }; vel = { x: 0, y: 0 }; }
    begin();
  }
  function begin() {
    const ps = [...pts.values()];
    const mx = ps.reduce((a, p) => a + p.x, 0) / ps.length, my = ps.reduce((a, p) => a + p.y, 0) / ps.length;
    const d = ps.length > 1 ? Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) : 0;
    start = { v: { ...v }, d, mx, my };
  }
  function move(e: PointerEvent) {
    if (!pts.has(e.pointerId) || !start) return;
    const p = local(e); pts.set(e.pointerId, p);
    const ps = [...pts.values()];
    if (ps.length > 1) {
      const mx = (ps[0].x + ps[1].x) / 2, my = (ps[0].y + ps[1].y) / 2, d = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
      const s = Math.min(sMax, Math.max(1, start.v.s * d / (start.d || d)));
      const z = zoomAt(start.v, s, start.mx, start.my, box);
      set({ s, x: z.x + mx - start.mx, y: z.y + my - start.my });
      return;
    }
    if (v.s <= 1.01) return; // fitted: the page scrolls, a swipe is decided on release
    const dt = Math.max(1, e.timeStamp - last.t);
    vel = { x: .8 * vel.x + .2 * ((p.x - last.x) / dt), y: .8 * vel.y + .2 * ((p.y - last.y) / dt) }; last = { ...p, t: e.timeStamp };
    set({ s: start.v.s, x: start.v.x + p.x - start.mx, y: start.v.y + p.y - start.my });
  }
  function up(e: PointerEvent) {
    if (!pts.has(e.pointerId)) return;
    const p = local(e); pts.delete(e.pointerId);
    if (pts.size) { begin(); return; } // one finger left: it moves on from here
    start = null;
    const dx = p.x - swipe.x, dy = p.y - swipe.y, quick = e.timeStamp - swipe.t < 600;
    if (Math.hypot(dx, dy) < 6) { const fb = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>(".fb"); if (fb?.dataset.face) { onface?.(Number(fb.dataset.face)); return; } }
    if (v.s <= 1.01) {
      if (e.pointerType !== "mouse" && quick && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { onswipe?.(dx < 0 ? 1 : -1); return; }
    } else if (Math.hypot(vel.x, vel.y) > .15) glide();
    // a second tap close to the first: fit <-> 1:1
    if (e.pointerType !== "mouse" && Math.hypot(dx, dy) < 10) {
      if (e.timeStamp - tap.t < 320 && Math.hypot(p.x - tap.x, p.y - tap.y) < 40) { toggle(p.x, p.y); tap.t = 0; } else tap = { t: e.timeStamp, x: p.x, y: p.y };
    }
  }
  function glide() {
    let t0 = performance.now();
    const step = (t: number) => {
      const dt = Math.min(32, t - t0); t0 = t;
      vel = { x: vel.x * Math.pow(.995, dt), y: vel.y * Math.pow(.995, dt) };
      const n = clamp({ s: v.s, x: v.x + vel.x * dt, y: v.y + vel.y * dt }, box, sMax);
      if (n.x === v.x && n.y === v.y) return; v = n;
      if (Math.hypot(vel.x, vel.y) > .02) coast = requestAnimationFrame(step);
    };
    coast = requestAnimationFrame(step);
  }
  function toggle(px: number, py: number) {
    if (v.s > 1.05) { reset(); return; }
    set(zoomAt(v, Math.min(sMax, Math.max(2.5, oneToOne(box, fullW, dpr()))), px, py, box), true);
  }
  // wheel: a pinch on the trackpad (ctrlKey) or a mouse wheel zooms; a two-finger scroll moves the zoomed picture
  $effect(() => {
    if (!surf) return;
    const el = surf;
    const wheel = (e: WheelEvent) => {
      const p = local(e), px = e.deltaMode ? 30 : 1;
      const mouse = e.deltaMode !== 0 || (Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50 && e.deltaX === 0);
      if (e.ctrlKey || mouse) { e.preventDefault(); anim = false; set(zoomAt(v, v.s * Math.exp(-e.deltaY * px * (e.ctrlKey ? .01 : .0022)), p.x, p.y, box)); return; }
      if (v.s > 1.01) { e.preventDefault(); anim = false; set({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }); }
    };
    let g0 = 1;
    const gs = (e: any) => { e.preventDefault(); g0 = v.s; };
    const gc = (e: any) => { e.preventDefault(); const p = local(e); anim = false; set(zoomAt(v, g0 * e.scale, p.x, p.y, box)); };
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("gesturestart", gs); el.addEventListener("gesturechange", gc);
    return () => { el.removeEventListener("wheel", wheel); el.removeEventListener("gesturestart", gs); el.removeEventListener("gesturechange", gc); };
  });
  // the mouse only: after a double tap the browser sends a dblclick too, and the tap has already toggled
  const dbl = (e: MouseEvent) => { if (lastType !== "mouse" || (e.target as Element).closest("button, a")) return; const p = local(e); toggle(p.x, p.y); };
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="surf" bind:this={surf} class:zoomed onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} ondblclick={dbl}>
  <div class="frame" class:fit={ratio > 0} class:anim data-stage bind:this={frame} style:--r={ratio || null}
    style:transform="translate({v.x}px, {v.y}px) scale({v.s})" style:background-image="url(/media/{id}/m)">
    <img class="base" src="/media/{id}/l" srcset="/media/{id}/m 720w, /media/{id}/l 2048w" sizes="(min-width: 900px) calc(100vw - 320px), 100vw" {alt} draggable="false" {@attach measurePic} />
    {#each tiles as t (t.key)}
      <img class="tile" src="/media/{id}/z/{t.level}/{t.col}_{t.row}" alt="" draggable="false" style:left="{t.left}%" style:top="{t.top}%" style:width="{t.width}%" style:height="{t.height}%" />
    {/each}
    {#if origEl}<div class="origbox" class:ok={origOk} data-original {@attach put}></div>{/if}
    {#if faces.length}<div class="faceon" style:left="{pic.l}%" style:top="{pic.t}%" style:width="{pic.w}%" style:height="{pic.h}%">
    {#each faces as f (f.id)}
      <!-- the pointer path is the tap in up(); a click from the keyboard (detail 0) comes here -->
      <button type="button" class="fb" class:hot={hot === f.id} data-face={f.id} aria-label={f.label || "Gesicht"} style:--s={v.s}
        style:left="{f.x * 100}%" style:top="{f.y * 100}%" style:width="{f.w * 100}%" style:height="{f.h * 100}%"
        onpointerenter={() => (hot = f.id)} onpointerleave={() => { if (hot === f.id) hot = null; }} onfocus={() => (hot = f.id)} onblur={() => { if (hot === f.id) hot = null; }}
        onclick={e => { if (e.detail === 0) onface?.(f.id); }}>{#if f.label}<span class="nm">{f.label}</span>{/if}</button>
    {/each}
    </div>{/if}
  </div>
</div>

<style>
  .surf { position: absolute; inset: 0; display: grid; place-items: center; overflow: hidden; touch-action: pan-y; user-select: none; -webkit-user-select: none; }
  .surf.zoomed { touch-action: none; cursor: grab; } .surf.zoomed:active { cursor: grabbing; }
  .frame { position: relative; width: 100%; height: 100%; transform-origin: 0 0; background: center / contain no-repeat; will-change: transform; }
  /* exactly as large as the picture, so the tile can grow into it and the tiles land on it */
  .frame.fit { width: min(100cqw, calc(100cqh * var(--r))); height: auto; aspect-ratio: var(--r); }
  .frame.anim { transition: transform .32s cubic-bezier(.2,.8,.2,1); }
  .frame img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; display: block; }
  .frame .tile { inset: auto; object-fit: fill; }
  /* the frames grow with the picture; the line and the name keep their size on screen */
  .faceon { position: absolute; pointer-events: none; } .faceon .fb { pointer-events: auto; }
  .fb { position: absolute; padding: 0; border: calc(2px / var(--s, 1)) solid #fff; border-radius: calc(8px / var(--s, 1)); background: transparent; box-shadow: 0 0 0 calc(1px / var(--s, 1)) rgb(0 0 0 / .35); opacity: 0; cursor: pointer; }
  @media (hover: hover) { .surf:hover .fb { opacity: .7; } }
  .fb.hot, .fb:focus-visible { opacity: 1; border-color: var(--sun); outline: none; }
  .nm { position: absolute; left: 50%; top: 100%; transform: translate(-50%, 0) scale(calc(1 / var(--s, 1))); transform-origin: 50% 0; margin-top: calc(6px / var(--s, 1)); padding: 3px 9px; border-radius: 11px; background: var(--veil); color: #fff; font-size: 13px; font-weight: 650; white-space: nowrap; backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); display: none; }
  .fb.hot .nm, .fb:focus-visible .nm { display: block; }
  .origbox { position: absolute; inset: 0; opacity: 0; transition: opacity .3s ease; }
  .origbox.ok { opacity: 1; }
  .origbox :global(img) { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; display: block; dynamic-range-limit: no-limit; }
</style>
