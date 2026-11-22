<script lang="ts">
  // One photo. Phone per Phone-Foto: the picture on top, the sheet with the details below. Desktop: picture left, details right.
  import Known from "../components/Known.svelte";
  import type { ItemDetail } from "../../shared/types";
  import { api, post } from "../lib/api";
  import { app, backOr, go, toast, view, house, within } from "../lib/state.svelte";
  import { people, loadPeople, loadLists } from "../lib/stores.svelte";
  import { deleteItems, download, gone, setFavorite, share } from "../lib/actions.svelte";
  import { fullDate, clock, bytes, word, duration } from "../lib/format";
  import Icon from "../components/Icon.svelte";
  import Sheet from "../components/Sheet.svelte";
  import AlbumSheet from "../components/AlbumSheet.svelte";
  import Loading from "../components/Loading.svelte";
  import Link from "../components/Link.svelte";
  import { bloom, seen } from "../lib/motion";
  import { groundFor } from "../lib/light";
  import { ground, groundOf } from "../lib/ground";
  import Zoom from "../components/Zoom.svelte";
  let { id }: { id: number } = $props();

  let d = $state<ItemDetail | null>(null), error = $state("");
  // another person's photo: look, share, download; favourites, names, stacks, albums and the bin stay theirs
  const mine = $derived(!d || !house.me || d.owner === house.me);
  let more = $state(false), album = $state(false), naming = $state<{ faceId: number; personId: number } | null>(null), nameOpen = $state(false), nameText = $state("");
  let strip = $state<number[]>([]);
  let fav = $state(false);

  $effect(() => {
    const my = id; d = null; error = "";
    api<ItemDetail>(`/api/items/${my}`).then(r => {
      if (my !== id) return;
      d = r; fav = r.favorite;
      // the burst keeps its order while you hop around inside it
      if (r.burst.length) strip = [...new Set([r.id, ...r.burst.map(b => b.id)])].sort((a, b) => a - b); else strip = [];
    }).catch(e => { if (my === id) error = e.message; });
    loadPeople();
  });

  // neighbours in the list the photo was opened from
  const at = $derived(view.ids.indexOf(id));
  const prev = $derived(at > 0 ? view.ids[at - 1] : null), next = $derived(at >= 0 && at < view.ids.length - 1 ? view.ids[at + 1] : null);
  const step = (to: number | null) => { if (to !== null) go(`/foto/${to}`, true, to === next ? "next" : "prev"); };
  $effect(() => { for (const n of [prev, next]) if (n !== null) { new Image().src = `/media/${n}/l`; ground(n); } });
  // zoom: the picture, its tiles and the original (components/Zoom.svelte)
  let zoomer: Zoom | undefined = $state(), zoomed = $state(false), hdr = $state(false), original = $state(false), zinfo = $state<any>(null);
  let wantOriginal = false;
  function toggleOriginal() {
    more = false; wantOriginal = !original; original = !original;
  }
  const originalFailed = () => { if (wantOriginal) toast("Dieser Browser kann das Original nicht anzeigen. Zu sehen ist die Kopie in voller Auflösung."); wantOriginal = false; };
  $effect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || document.querySelector("[aria-modal='true']") || (e.target as Element)?.closest("input, textarea, [role=separator]")) return;
      // + - 0 zoom; zoomed in, the arrows move the picture and Escape fits it again (before the page goes back)
      if (e.key === "+" || e.key === "=") { e.preventDefault(); e.stopPropagation(); zoomer?.zoomBy(1.6); return; }
      if (e.key === "-") { e.preventDefault(); e.stopPropagation(); zoomer?.zoomBy(1 / 1.6); return; }
      if (e.key === "0") { e.preventDefault(); e.stopPropagation(); zoomer?.reset(); return; }
      if (zoomed) {
        const d: Record<string, [number, number]> = { ArrowLeft: [120, 0], ArrowRight: [-120, 0], ArrowUp: [0, 120], ArrowDown: [0, -120] };
        if (d[e.key]) { e.preventDefault(); e.stopPropagation(); zoomer?.panBy(...d[e.key]); return; }
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); zoomer?.reset(); return; }
        return;
      }
      if (e.key === "ArrowLeft") { e.preventDefault(); step(prev); }
      if (e.key === "ArrowRight") { e.preventDefault(); step(next); }
    };
    // capture: before the app's own keys (Escape would go back)
    addEventListener("keydown", k, true); return () => removeEventListener("keydown", k, true);
  });
  // swipe on the picture
  let sx = 0, sy = 0, dragging = false;
  const down = (e: PointerEvent) => { sx = e.clientX; sy = e.clientY; dragging = e.pointerType !== "mouse"; };
  const up = (e: PointerEvent) => {
    if (!dragging) return; dragging = false;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? next : prev);
  };

  // ---- the details can be resized: on the phone the sheet is dragged between three heights, on the desktop the panel's
  // left edge is dragged. Both are window splitters (arrow keys too) and remember their size.
  type Size = "gross" | "mittel" | "klein";
  const SIZE_NAME: Record<Size, string> = { gross: "groß", mittel: "mittel", klein: "klein" };
  const stored = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
  const store = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} };
  let size = $state<Size>((["gross", "mittel", "klein"] as const).find(s => s === stored("monet-sheet")) ?? "mittel");
  let vh = $state(innerHeight), vw = $state(innerWidth);
  $effect(() => { const r = () => { vh = innerHeight; vw = innerWidth; }; addEventListener("resize", r); return () => removeEventListener("resize", r); });
  const snaps = $derived<Record<Size, number>>({ gross: 96, mittel: 356, klein: Math.max(356, vh - 132) });
  let dragTop = $state<number | null>(null);
  const sheetTop = $derived(dragTop ?? snaps[size]);
  const setSize = (s: Size) => { size = s; store("monet-sheet", s); };
  const ORDER: Size[] = ["gross", "mittel", "klein"];
  let g0 = 0, t0 = 0, lastY = 0, lastT = 0, vel = 0, moved = false;
  function grabDown(e: PointerEvent) {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    g0 = lastY = e.clientY; t0 = sheetTop; lastT = e.timeStamp; vel = 0; moved = false; dragTop = sheetTop;
  }
  function grabMove(e: PointerEvent) {
    if (dragTop === null) return;
    if (Math.abs(e.clientY - g0) > 4) moved = true;
    const dt = Math.max(1, e.timeStamp - lastT); vel = .7 * vel + .3 * ((e.clientY - lastY) / dt); lastY = e.clientY; lastT = e.timeStamp;
    dragTop = Math.min(vh - 110, Math.max(80, t0 + e.clientY - g0));
  }
  function grabUp() {
    if (dragTop === null) return;
    const at = dragTop + vel * 160; dragTop = null;
    if (!moved) { setSize(size === "mittel" ? "gross" : "mittel"); return; }
    setSize(ORDER.reduce((a, b) => (Math.abs(snaps[b] - at) < Math.abs(snaps[a] - at) ? b : a)));
  }
  function grabKey(e: KeyboardEvent) {
    const i = ORDER.indexOf(size);
    if (e.key === "ArrowUp" && i > 0) { e.preventDefault(); setSize(ORDER[i - 1]); }
    if (e.key === "ArrowDown" && i < 2) { e.preventDefault(); setSize(ORDER[i + 1]); }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSize(size === "mittel" ? "gross" : "mittel"); }
  }
  // desktop: the panel's width
  let panel = $state(Number(stored("monet-panel")) || 400), resizing = $state(false);
  const maxPanel = $derived(Math.max(320, Math.min(720, vw * .6)));
  const panelW = $derived(Math.min(maxPanel, Math.max(320, panel)));
  function edgeDown(e: PointerEvent) { (e.currentTarget as Element).setPointerCapture(e.pointerId); resizing = true; }
  function edgeMove(e: PointerEvent) { if (resizing) panel = Math.min(maxPanel, Math.max(320, vw - e.clientX)); }
  function edgeUp() { if (!resizing) return; resizing = false; store("monet-panel", String(Math.round(panelW))); }
  function edgeKey(e: KeyboardEvent) {
    const d = e.key === "ArrowLeft" ? 24 : e.key === "ArrowRight" ? -24 : 0;
    if (d) { e.preventDefault(); e.stopPropagation(); panel = Math.min(maxPanel, Math.max(320, panelW + d)); store("monet-panel", String(Math.round(panel))); }
  }

  const back = () => backOr("/");
  async function toggleFav(e: MouseEvent) { fav = !fav; if (fav) bloom(e.currentTarget as Element); try { await setFavorite(id, fav); } catch (e: any) { fav = !fav; toast(e.message); } }
  function remove() {
    const to = next ?? prev;
    // the photo sinks into the pond and the next one comes up in its place
    deleteItems([id], () => { to !== null ? go(`/foto/${to}`, true, "sink") : back(); });
    more = false;
  }
  $effect(() => { if (gone.has(id) && !(next ?? prev)) { /* deleted from elsewhere */ } });

  const unnamed = (f: ItemDetail["faces"][number]) => !f.name;
  // the face under the pointer, in the picture or in the details: both show it
  let hot = $state<number | null>(null);
  $effect(() => { id; hot = null; });
  const frames = $derived(d ? d.faces.map(f => ({ id: f.id, x: f.x, y: f.y, w: f.w, h: f.h, label: f.name ?? (mine ? "Benennen" : "") })) : []);
  function onface(faceId: number) {
    const f = d?.faces.find(x => x.id === faceId); if (!f || !d) return;
    if (f.name) go(within(`/personen/${f.personId}`, d.owner), false, undefined, true);
    else if (mine) startNaming(f);
  }
  const hover = (f: { id: number }) => ({ onpointerenter: () => (hot = f.id), onpointerleave: () => { if (hot === f.id) hot = null; }, onfocus: () => (hot = f.id), onblur: () => { if (hot === f.id) hot = null; } });
  function startNaming(f: ItemDetail["faces"][number]) { if (f.personId === null) { toast("Dieses Gesicht ist noch keiner Gruppe zugeordnet."); return; } naming = { faceId: f.id, personId: f.personId }; nameText = ""; nameOpen = true; }
  async function saveName(e: Event) {
    e.preventDefault(); const n = nameText.trim(); if (!n || !naming) return;
    try { await post(`/api/people/${naming.personId}`, { name: n }); nameOpen = false; await refresh(); loadPeople(true); loadLists(); toast(`${n} ist benannt.`); } catch (err: any) { toast(err.message); }
  }
  async function assign(personId: number) {
    if (!naming) return;
    try { await post(`/api/faces/${naming.faceId}`, { personId }); nameOpen = false; await refresh(); loadPeople(true); } catch (err: any) { toast(err.message); }
  }
  async function refresh() { d = await api<ItemDetail>(`/api/items/${id}`); }
  // similar takes are stacked by the server; when it guessed wrong, this photo leaves the stack for good
  async function single() {
    try { await post(`/api/items/${id}/unstack`); strip = []; await refresh(); loadLists(); toast("Das Foto wird jetzt einzeln gezeigt."); } catch (e: any) { toast(e.message); }
  }

  const exif = $derived.by(() => {
    if (!d) return "";
    const e = d.exif, f = (n: number) => String(n).replace(".", ",");
    return [e.camera, e.exposure ? `${e.exposure} s` : "", e.fnumber ? `f/${f(e.fnumber)}` : "", e.iso ? `ISO ${e.iso}` : "", e.focal ? `${f(e.focal)} mm` : ""].filter(Boolean).join(", ");
  });
  const origin = $derived(d ? ({ takeout: "Aus Google Fotos übernommen", android: "Vom Telefon hochgeladen", mac: "Vom Mac hochgeladen", web: "Im Browser hochgeladen" } as const)[d.source] : "");
  const backed = $derived(d ? (d.backup.secondCopyAt ? "Auf deinem Server und am Mac" : "Auf deinem Server") : "");
  const alt = $derived(d ? `${d.kind === "video" ? "Video" : "Foto"} vom ${fullDate(d.takenAt, d.tzMin)}${d.place ? ", " + d.place.name : ""}` : "Foto");
  // the picture's own proportions, known from the grid before the details arrive, so it can open out of its tile
  const ratio = $derived(d && d.w > 0 && d.h > 0 ? d.w / d.h : seen.get(id)?.r ?? 0);
  // the ground is one of the house colours, the one nearest to the picture's own
  const base = $derived(groundFor(d?.color ?? seen.get(id)?.color));
  const stripWord = $derived(strip.length ? word(strip.length, false).replace(/^./, c => c.toUpperCase()) : "");
</script>

{#snippet orbs()}
  {#if mine}<button type="button" class="orb" aria-label={fav ? "Favorit entfernen" : "Als Favorit markieren"} aria-pressed={fav} onclick={toggleFav}><Icon name="herz" size={21} sw={1.9} /></button>{/if}
  <button type="button" class="orb" aria-label="Teilen" onclick={() => share([id])}><Icon name="teilen" size={21} sw={1.9} /></button>
  <button type="button" class="orb" aria-label="Weitere Aktionen" onclick={() => (more = true)}><Icon name="mehr" size={21} /></button>
{/snippet}

{#snippet info()}
  {#if d}
    <div class="t">
      <h1>{fullDate(d.takenAt, d.tzMin)}</h1>
      <p class="tnum m">{clock(d.takenAt, d.tzMin)}{d.place ? ` in ${d.place.name}` : ""}{d.kind === "video" && d.durationMs ? `, ${duration(d.durationMs)}` : ""}</p>
    </div>
    {#if d.faces.length}
      <section aria-label="Personen auf dem Foto" class="faces">
        {#each d.faces as f (f.id)}
          {#if unnamed(f) && !mine}
            <span class="face" class:hot={hot === f.id} {...hover(f)}><span class="ring dashed"><img src="/media/face/{f.id}" alt="" width="52" height="52" /></span></span>
          {:else if unnamed(f)}
            <button type="button" class="face q" class:hot={hot === f.id} {...hover(f)} onclick={() => startNaming(f)}><span class="ring dashed"><img src="/media/face/{f.id}" alt="" width="52" height="52" /><b aria-hidden="true">?</b></span>Benennen</button>
          {:else}
            <Link href={within(`/personen/${f.personId}`, d.owner)} raw class={hot === f.id ? "face hot" : "face"} {...hover(f)}><span class="ring"><img src="/media/face/{f.id}" alt="" width="52" height="52" /></span>{f.name}</Link>
          {/if}
        {/each}
      </section>
    {/if}
    {#if strip.length > 1}
      <section aria-label="Aufnahmen in Folge" class="burst">
        <p class="m small">{stripWord} Aufnahmen in Folge. Gezeigt wird die schärfste.</p>
        <div class="bs">
          {#each strip as b, i (b)}
            <button type="button" aria-label="Aufnahme {i + 1} von {strip.length}{b === id ? ', angezeigt' : ''}" aria-pressed={b === id} onclick={() => go(`/foto/${b}`, true, b > id ? "next" : "prev")}><img src="/media/{b}/s" alt="" width="50" height="50" /></button>
          {/each}
        </div>
        {#if mine}<button type="button" class="single" onclick={single}>Als einzelnes Foto zeigen</button>{/if}
      </section>
    {/if}
    {#if d.labels.length}
      <div class="tags" aria-label="Erkannt">{#each d.labels as l}<Link href="/suche?q={encodeURIComponent(l.label)}">{l.label}</Link>{/each}</div>
    {/if}
    <dl class="tnum">
      {#if exif}<dt>Kamera</dt><dd>{exif}</dd>{/if}
      <dt>Datei</dt><dd>{d.origName ? d.origName + ", " : ""}{bytes(d.bytes)}</dd>
      {#if d.kind === "photo" && d.w && d.h}<dt>Original</dt><dd>{d.w.toLocaleString("de-DE")} × {d.h.toLocaleString("de-DE")} Pixel, {(d.mime.split("/")[1] ?? "").toUpperCase()}{hdr ? ", HDR" : ""}</dd>{/if}
      <dt>Gesichert</dt><dd class="ok"><Icon name="check" size={15} sw={2.4} />{backed}</dd>
      <dt>Herkunft</dt><dd>{origin}</dd>
    </dl>
  {:else if error}<p class="m" role="alert">{error}</p>
  {:else}<Loading />{/if}
{/snippet}

<div class="foto" class:wide={app.wide} class:dragging={dragTop !== null || resizing} style:--stage={base} style:--top="{sheetTop}px" style:--panel="{panelW}px">
  <div class="stage" role="presentation" onpointerdown={d?.kind === "video" ? down : undefined} onpointerup={d?.kind === "video" ? up : undefined}>
    {#key id}<canvas class="ground" data-ground={id} aria-hidden="true" {@attach groundOf(id)}></canvas>{/key}
    {#if d?.kind === "video"}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video data-stage class:fit={ratio > 0} style:--r={ratio || null} controls autoplay playsinline poster="/media/{id}/l" src="/media/{id}/o" aria-label={alt}></video>
    {:else}
      <Zoom bind:this={zoomer} bind:zoomed bind:hdr bind:original bind:info={zinfo} {id} {ratio} {alt} imgW={d?.w ?? 0} faces={frames} {onface} bind:hot onswipe={dir => step(dir > 0 ? next : prev)} onoriginalfail={originalFailed} />
    {/if}
    <div class="topbar">
      <button type="button" class="orb" aria-label="Zurück" onclick={back}><Icon name="back" size={22} sw={2} /></button>
      <span class="sp"></span>
      {#if original && hdr}<span class="badge" title="Das Original wird in HDR gezeigt">HDR</span>{/if}
      {#if !app.wide}{@render orbs()}{/if}
    </div>
    {#if app.wide}
      {#if prev !== null}<button type="button" class="orb nav l" aria-label="Vorheriges Foto" onclick={() => step(prev)}><Icon name="back" size={22} sw={2} /></button>{/if}
      {#if next !== null}<button type="button" class="orb nav r" aria-label="Nächstes Foto" onclick={() => step(next)}><Icon name="chevron" size={22} sw={2} /></button>{/if}
    {/if}
  </div>
  <article data-vt="sheet">
    {#if app.wide}<div class="actions">{@render orbs()}</div>{:else}
      <!-- a focusable separator is the ARIA window splitter, an interactive widget -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div class="grip" role="separator" tabindex="0" aria-orientation="horizontal" aria-label="Größe der Angaben: {SIZE_NAME[size]}. Ziehen, tippen oder Pfeiltasten."
        aria-valuemin={0} aria-valuemax={2} aria-valuenow={2 - ORDER.indexOf(size)} aria-valuetext={SIZE_NAME[size]}
        onpointerdown={grabDown} onpointermove={grabMove} onpointerup={grabUp} onpointercancel={grabUp} onkeydown={grabKey}><span class="grab"></span></div>
    {/if}
    {@render info()}
  </article>
  {#if app.wide}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div class="edge" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Breite der Angaben" aria-valuemin={320} aria-valuemax={Math.round(maxPanel)} aria-valuenow={Math.round(panelW)}
      onpointerdown={edgeDown} onpointermove={edgeMove} onpointerup={edgeUp} onpointercancel={edgeUp} onkeydown={edgeKey} ondblclick={() => { panel = 400; store("monet-panel", "400"); }}></div>
  {/if}
</div>

<Sheet bind:open={more} label="Weitere Aktionen">
  {#if mine}<button type="button" class="act" onclick={() => { more = false; album = true; }}><Icon name="album" size={20} sw={1.9} />Zum Album hinzufügen</button>{/if}
  {#if d?.kind === "photo"}<button type="button" class="act" onclick={toggleOriginal}><Icon name="original" size={20} sw={1.9} />{original ? "Kopie zeigen" : hdr ? "Original in HDR zeigen" : "Original zeigen"}</button>{/if}
  <button type="button" class="act" onclick={() => { more = false; download([id]); }}><Icon name="laden" size={20} sw={1.9} />Herunterladen</button>
  {#if mine}<button type="button" class="act" onclick={remove}><Icon name="papierkorb" size={20} sw={1.9} />Löschen</button>{/if}
</Sheet>
<AlbumSheet bind:open={album} ids={[id]} />
<Sheet bind:open={nameOpen} label="Person benennen">
  <h2 class="sh">Wer ist das?</h2>
  {#if naming}<img class="big" src="/media/face/{naming.faceId}" alt="" width="88" height="88" />{/if}
  <form onsubmit={saveName}>
    <label>Name<input type="text" bind:value={nameText} placeholder="z. B. Tante Vroni" /></label>
    <button type="submit" class="pri" disabled={!nameText.trim()}>Benennen</button>
  </form>
  {#if people.p?.named.length}
    <p class="m small">Oder ist es jemand, den du schon benannt hast?</p>
    <Known named={people.p.named.slice(0, 10)} onpick={n => assign(n.id)} />
  {/if}
</Sheet>

<style>
  .foto { position: relative; display: flow-root; min-height: 100dvh; background: var(--stage, var(--deep)); transition: background-color .4s ease; }
  .stage { position: absolute; left: 0; right: 0; top: 0; height: calc(var(--top, 356px) + 36px); transition: height .45s cubic-bezier(.2,.8,.2,1); display: grid; place-items: center; touch-action: pan-y; container-type: size; }
  .stage img, .stage video { width: 100%; height: 100%; object-fit: contain; display: block; background: center / contain no-repeat; }
  /* the photo's colours as an out-of-focus impression; the single house colour of .foto stands under it */
  .stage { overflow: hidden; }
  .ground { position: absolute; inset: -60px; width: calc(100% + 120px); height: calc(100% + 120px); filter: blur(14px) saturate(1.1) brightness(var(--ground-light, .66)); opacity: 0; transition: opacity .5s ease; pointer-events: none; }
  .ground:global([data-painted]) { opacity: 1; }
  :global(:root[data-light=nacht]) .ground { --ground-light: .48; }
  .stage > :not(.ground) { position: relative; }
  .stage > .topbar, .stage > .nav { position: absolute; }
  /* exactly as large as the picture, so the tile can grow into it */
  .stage .fit { width: min(100cqw, calc(100cqh * var(--r))); height: auto; aspect-ratio: var(--r); }
  .topbar { position: absolute; left: 12px; right: 12px; top: calc(16px + env(safe-area-inset-top)); display: flex; align-items: center; gap: 8px; }
  .sp { flex: 1; }
  .orb { width: 44px; height: 44px; border: 0; border-radius: 50%; display: grid; place-items: center; background: var(--veil); color: #fff; backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); flex: none; }
  .orb:hover { background: rgb(26 30 68 / .7); }
  .orb[aria-pressed=true] { color: var(--sun); }
  .badge { height: 26px; padding: 0 9px; display: inline-flex; align-items: center; border-radius: 13px; background: var(--veil); color: #fff; font-size: 11.5px; font-weight: 750; letter-spacing: .06em; backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
  .orb[aria-pressed=true] :global(svg) { fill: currentColor; }
  article { position: relative; margin-top: var(--top, 356px); min-height: calc(100dvh - var(--top, 356px)); transition: margin-top .45s cubic-bezier(.2,.8,.2,1); padding: 10px 20px 28px; border-radius: 22px 22px 0 0; background: var(--surface); box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 16px; }
  .grip { align-self: stretch; margin: -10px -20px -8px; height: 30px; display: grid; place-items: center; touch-action: none; cursor: grab; border-radius: 22px 22px 0 0; }
  .grip:active { cursor: grabbing; } .grip:hover .grab, .grip:focus-visible .grab { background: var(--muted); }
  .grab { display: block; width: 36px; height: 5px; border-radius: 3px; background: var(--surface-3); }
  .dragging .stage, .dragging article { transition: none; }
  .edge { position: absolute; top: 0; bottom: 0; right: calc(var(--panel) - 6px); width: 12px; cursor: col-resize; touch-action: none; z-index: 2; }
  .edge::after { content: ""; position: absolute; left: 5px; top: 0; bottom: 0; width: 2px; background: transparent; transition: background .2s; }
  .edge:hover::after, .edge:focus-visible::after, .dragging .edge::after { background: var(--water); }
  h1 { font-size: 27px; line-height: 1.15; } .m { color: var(--muted); } .t .m { font-size: 14px; } .small { font-size: 13px; }
  .t { display: flex; flex-direction: column; gap: 2px; }
  .faces { display: flex; flex-wrap: wrap; gap: 14px; }
  .faces :global(.face), .face { display: flex; flex-direction: column; align-items: center; gap: 5px; width: 60px; border: 0; background: transparent; padding: 0; font-size: 13px; font-weight: 600; text-align: center; }
  .ring { position: relative; width: 52px; height: 52px; border-radius: 50%; overflow: hidden; display: block; }
  .ring img { width: 52px; height: 52px; object-fit: cover; display: block; }
  .faces :global(.face:hover .ring), .faces :global(.face.hot .ring) { box-shadow: 0 0 0 2px var(--water); }
  .faces :global(.face.hot .dashed) { border-style: solid; }
  .q { color: var(--sun-ink); font-weight: 650; }
  .dashed { overflow: visible; box-shadow: none; border: 1.5px dashed var(--sun-ink); padding: 2px; }
  .dashed img { border-radius: 50%; width: 46px; height: 46px; opacity: .55; }
  .dashed b { position: absolute; inset: 0; display: grid; place-items: center; font-family: var(--font-display); font-weight: 400; font-size: 22px; }
  .burst { display: flex; flex-direction: column; gap: 8px; }
  .single { align-self: flex-start; min-height: 44px; padding: 0; border: 0; background: none; color: var(--water); font-weight: 600; cursor: pointer; }
  .single:hover { text-decoration: underline; } .bs { display: flex; gap: 6px; flex-wrap: wrap; }
  .bs button { width: 50px; height: 50px; padding: 0; border: 0; border-radius: 9px; overflow: hidden; box-shadow: inset 0 0 0 1px rgb(34 48 94 / .12); position: relative; }
  .bs button img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .bs button[aria-pressed=true] { box-shadow: 0 0 0 2.5px var(--surface), 0 0 0 4.5px var(--sun); }
  .tags { display: flex; flex-wrap: wrap; gap: 6px; }
  .tags :global(a) { height: 32px; padding: 0 11px; display: inline-flex; align-items: center; border-radius: 16px; background: var(--surface-2); font-size: 13px; font-weight: 600; }
  .tags :global(a:hover) { background: var(--surface-3); }
  dl { display: grid; grid-template-columns: 84px minmax(0, 1fr); row-gap: 5px; column-gap: 10px; font-size: 13.5px; padding-top: 12px; border-top: 1px solid var(--rule); margin: 0; }
  dt { color: var(--muted); } dd { margin: 0; overflow-wrap: anywhere; } .ok { display: flex; align-items: center; gap: 5px; } .ok :global(svg) { color: var(--water); flex: none; }
  .act { width: 100%; min-height: 52px; display: flex; align-items: center; gap: 12px; padding: 0 12px; border: 0; border-radius: 14px; background: transparent; text-align: left; font-weight: 600; }
  .act:hover { background: var(--surface-2); }
  .sh { font-size: 28px; line-height: 1.05; } .big { width: 88px; height: 88px; border-radius: 50%; object-fit: cover; align-self: flex-start; }
  form { display: flex; flex-direction: column; gap: 10px; } label { display: flex; flex-direction: column; gap: 5px; font-size: 13px; font-weight: 650; }
  form input { height: 46px; padding: 0 14px; border: 0; border-radius: 12px; background: var(--surface-2); font-size: 16px; font-weight: 400; }
  .pri { height: 46px; border: 0; border-radius: 23px; background: var(--ink); color: var(--on-ink); font-weight: 650; } .pri:disabled { opacity: .45; }

  .foto.wide { display: grid; grid-template-columns: minmax(0, 1fr) var(--panel, 400px); min-height: 100dvh; height: 100dvh; }
  .wide .stage { position: relative; height: 100dvh; transition: none; }
  .wide article { transition: none; margin: 0; min-height: 0; height: 100dvh; overflow: auto; border-radius: 0; padding: 20px 24px 28px; }
  .wide .actions { display: flex; gap: 8px; justify-content: flex-end; }
  .wide .actions .orb { background: var(--surface-2); color: var(--ink); backdrop-filter: none; } .wide .actions .orb:hover { background: var(--surface-3); }
  .wide .actions .orb[aria-pressed=true] { color: var(--sun-ink); }
  .nav { position: absolute; top: 50%; transform: translateY(-50%); } .nav.l { left: 14px; } .nav.r { right: 14px; }
</style>
