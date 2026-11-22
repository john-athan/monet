<script lang="ts">
  // One file, for viewing only. It fills the screen like a photo does; the header carries the title and what you can do
  // with the file, the body is one of the viewers: pages, slides, sheet, book, audio, text, or a download panel.
  import { untrack } from "svelte";
  import type { DocDetail, DocKind, FindHit, FindOut } from "../../shared/types";
  import { KINDS, fileSign } from "../lib/files.svelte";
  import { api, post } from "../lib/api";
  import { backOr, go, toast, house, app as appState } from "../lib/state.svelte";
  import { bytes, duration, fullDate, num } from "../lib/format";
  import Icon from "../components/Icon.svelte";
  import Link from "../components/Link.svelte";
  import Loading from "../components/Loading.svelte";
  import DocPages from "../components/DocPages.svelte";
  import SlideView from "../components/SlideView.svelte";
  import SheetGrid from "../components/SheetGrid.svelte";
  import TextView from "../components/TextView.svelte";
  import BookReader from "../components/BookReader.svelte";
  import AudioView from "../components/AudioView.svelte";
  import MoveSheet from "../components/MoveSheet.svelte";
  import { app } from "../lib/state.svelte";
  let { id }: { id: number } = $props();

  let d = $state<DocDetail | null>(null), error = $state("");
  let details = $state(false), moving = $state(false), asPages = $state(false);
  const mine = $derived(!!d && house.me > 0 && d.owner === house.me);
  const TEXT = ["txt", "md", "markdown", "tex"];
  const textual = $derived(!!d && d.kind === "doc" && TEXT.includes(d.format));
  const LIST = $derived(d ? (d.kind === "other" && d.folderId != null ? `/ablage/${d.folderId}` : KINDS[d.kind].path) : "/ablage");

  async function load(quiet = false) {
    const my = id;
    try {
      const r = await api<DocDetail>(`/api/docs/${my}`);
      if (my === id) d = r;
    } catch (e: any) { if (my === id && !quiet) error = e.message; }
  }
  // only the id starts a load: what api() reads on the way (whose library is open) must not load the file again
  $effect(() => { id; untrack(() => { d = null; error = ""; details = false; load(); }); });
  // while the pages are being made, ask again every 3 s
  $effect(() => {
    if (d?.state !== "pending") return;
    const t = setInterval(() => { if (!document.hidden) load(true); }, 3000);
    return () => clearInterval(t);
  });
  $effect(() => {
    if (!d) return;
    const before = document.title; document.title = `${d.title}, Monet`;
    return () => { document.title = before; };
  });

  /* ---- find in the file (docs/together.md, "Text on the page"): pages, slides and sheets ask the server, the text view
     searches its own text. ?finde=<words> (a mention, a search hit) opens at the first hit, and only when there is one. */
  const findable = $derived(!!d && d.state === "ok" && (d.kind === "doc" || d.kind === "slides" || d.kind === "sheet" || (d.kind === "other" && !!d.text)));
  const inText = $derived(!!d && ((textual && !asPages) || d.kind === "other"));
  let finding = $state(false), fq = $state(""), hits = $state<FindHit[]>([]), at = $state(0), textHits = $state(0), searched = $state(""), more = $state(false);
  let fin: HTMLInputElement | undefined = $state();
  const total = $derived(inText ? textHits : hits.length);
  const focusHit = $derived(!inText && finding && hits.length ? hits[Math.min(at, hits.length - 1)] : null);
  const wanted = () => new URLSearchParams(appState.query).get("finde")?.trim() ?? "";
  async function run(q: string) {
    if (!d) return;
    const my = d.id;
    searched = q; at = 0;
    if (inText) return; // the text view counts itself (onfound)
    if (!q) { hits = []; more = false; return; }
    try { const r = await api<FindOut>(`/api/docs/${my}/find?q=${encodeURIComponent(q)}`); if (my === d?.id && searched === q) { hits = r.hits; more = r.more; } }
    catch { hits = []; }
  }
  // typing waits a moment
  $effect(() => { const q = fq.trim(); if (!finding || q === searched) return; const t = setTimeout(() => run(q), 250); return () => clearTimeout(t); });
  // a mention: search once the file is there, open the bar only for a hit
  let opened = -1;
  $effect(() => {
    if (!d || !findable || opened === d.id) return;
    const q = wanted(); opened = d.id;
    if (!q) return;
    fq = q;
    if (inText) { searched = q; finding = true; return; } // the text view opens at its first hit; with none the bar says so
    void run(q).then(() => { if (hits.length) finding = true; });
  });
  function openFind() { finding = true; requestAnimationFrame(() => { fin?.focus(); fin?.select(); }); }
  function closeFind() { finding = false; fq = ""; searched = ""; hits = []; textHits = 0; }
  const step = (k: number) => { if (total) at = (at + k + total) % total; };
  // Cmd/Ctrl+F opens this find where the browser's own cannot see everything (pages not loaded yet, sheet rows not fetched)
  $effect(() => {
    if (!findable) return;
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "f") { e.preventDefault(); openFind(); } };
    addEventListener("keydown", k, true); return () => removeEventListener("keydown", k, true);
  });
  const findKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeFind(); }
    else if (e.key === "Enter") { e.preventDefault(); if (fq.trim() !== searched) run(fq.trim()); else step(e.shiftKey ? -1 : 1); }
  };

  // back: where you came from, else the list of its kind
  const back = () => backOr(LIST);

  async function remove() {
    if (!d || !mine) return;
    const my = id;
    try {
      await api(`/api/docs/${my}`, { method: "DELETE" });
      toast("Datei gelöscht", { ms: 8000, action: { label: "Rückgängig", run: () => { post(`/api/docs/${my}/restore`).then(() => toast("Die Datei ist wieder da.")).catch(e => toast(e.message)); } } });
      back();
    } catch (e: any) { toast(e.message); }
  }

  // Escape closes the details first, then goes back. In the capture phase, so the app's own key does not go back twice.
  $effect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || document.querySelector("[aria-modal='true']") || (e.target as Element)?.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault(); e.stopPropagation();
      if (details) details = false; else back();
    };
    addEventListener("keydown", k, true); return () => removeEventListener("keydown", k, true);
  });

  const KIND: Record<DocKind, string> = { doc: "Dokument", sheet: "Tabelle", slides: "Präsentation", book: "Buch", audio: "Audio", other: "Datei" };
  const amount = $derived.by(() => {
    if (!d) return "";
    if (d.kind === "sheet") return d.sheets.length ? `${num(d.sheets.length)} ${d.sheets.length === 1 ? "Blatt" : "Blätter"}` : "";
    if (d.kind === "audio" || d.kind === "other") return "";
    if (d.pages == null) return "";
    const one = d.kind === "slides" ? "Folie" : d.kind === "book" ? "Kapitel" : "Seite", many = d.kind === "slides" ? "Folien" : d.kind === "book" ? "Kapitel" : "Seiten";
    return `${num(d.pages)} ${d.pages === 1 ? one : many}`;
  });
</script>

<div class="datei" class:wide={app.wide}>
  <header>
    <button type="button" class="ib" aria-label="Zurück" onclick={back}><Icon name="back" size={22} sw={2} /></button>
    <h1 title={d?.title}>{d?.title ?? ""}</h1>
    <div class="acts">
      {#if d && textual && d.state === "ok"}
        <button type="button" class="pill" aria-pressed={asPages} onclick={() => (asPages = !asPages)}>{asPages ? "Als Text" : "Als Seiten"}</button>
      {/if}
      {#if findable}
        <button type="button" class="pill ib" aria-label="In der Datei suchen" aria-pressed={finding} onclick={() => (finding ? closeFind() : openFind())}><Icon name="suche" size={20} sw={1.9} /><span class="lbl">Suchen</span></button>
      {/if}
      {#if d}
        <a class="pill ib" href="/media/doc/{id}/o" download aria-label="Herunterladen"><Icon name="herunterladen" size={20} sw={1.9} /><span class="lbl">Herunterladen</span></a>
        {#if mine}
          <button type="button" class="pill ib" aria-label="In Ordner verschieben" onclick={() => (moving = true)}><Icon name="verschieben" size={20} sw={1.9} /><span class="lbl">In Ordner verschieben</span></button>
          <button type="button" class="pill ib" aria-label="Löschen" onclick={remove}><Icon name="papierkorb" size={20} sw={1.9} /><span class="lbl">Löschen</span></button>
        {/if}
        <button type="button" class="pill ib" aria-label="Details" aria-expanded={details} aria-controls="datei-details" onclick={() => (details = !details)}><Icon name="mehr" size={20} /><span class="lbl">Details</span></button>
      {/if}
    </div>
  </header>

  {#if finding}
    <div class="find" role="search" aria-label="In der Datei suchen">
      <input bind:this={fin} type="search" bind:value={fq} onkeydown={findKey} placeholder="In der Datei suchen" aria-label="Suchbegriff" />
      <span class="cnt tnum" role="status">{!searched ? "" : total ? `${num(Math.min(at, total - 1) + 1)} von ${num(total)}${more ? "+" : ""}` : "Kein Treffer"}</span>
      <button type="button" class="ib sm" aria-label="Voriger Treffer" disabled={!total} onclick={() => step(-1)}><Icon name="hoch" size={18} sw={2} /></button>
      <button type="button" class="ib sm down" aria-label="Nächster Treffer" disabled={!total} onclick={() => step(1)}><Icon name="hoch" size={18} sw={2} /></button>
      <button type="button" class="ib sm" aria-label="Suche schließen" onclick={closeFind}><Icon name="x" size={18} sw={2} /></button>
    </div>
  {/if}

  {#if d && details}
    <section id="datei-details" class="details" aria-label="Details zur Datei">
      <dl class="tnum">
        <dt>Format</dt><dd>{fileSign(d.format)}, {KIND[d.kind]}</dd>
        {#if d.by}<dt>{d.kind === "book" ? "Autor" : "Künstler"}</dt><dd>{d.by}</dd>{/if}
        {#if d.album}<dt>Album</dt><dd>{d.album}</dd>{/if}
        {#if d.durationMs}<dt>Dauer</dt><dd>{duration(d.durationMs)}</dd>{/if}
        <dt>Größe</dt><dd>{bytes(d.bytes)}</dd>
        {#if amount}<dt>{d.kind === "sheet" ? "Blätter" : d.kind === "slides" ? "Folien" : d.kind === "book" ? "Kapitel" : "Seiten"}</dt><dd>{amount}</dd>{/if}
        {#if d.takenAt !== d.modifiedAt}<dt>Erstellt</dt><dd>{fullDate(d.takenAt)}</dd>{/if}
        <dt>Geändert</dt><dd>{fullDate(d.modifiedAt)}</dd>
        {#if d.labels.length}<dt>Erkannt</dt><dd class="path">{#each d.labels as l, k}{k ? ", " : ""}<Link href="/suche?q={encodeURIComponent(l)}">{l}</Link>{/each}</dd>{/if}
        {#if d.links.length}<dt>Erwähnt</dt><dd class="path">{#each d.links as l, k}{k ? ", " : ""}<Link href={l.kind === "person" ? `/personen/${l.id}` : `/orte/${l.id}`}>{l.name}</Link>{/each}</dd>{/if}
        <dt>Ordner</dt>
        <dd class="path">
          <Link href="/ablage">Ablage</Link>{#each d.path as p (p.id)}<span aria-hidden="true"> / </span><Link href="/ablage/{p.id}">{p.name}</Link>{/each}
        </dd>
        {#if d.origName}<dt>Originalname</dt><dd>{d.origName}</dd>{/if}
      </dl>
    </section>
  {/if}

  <div class="body">
    {#if error}
      <div class="msg" role="alert"><p>{error}</p></div>
    {:else if !d}
      <Loading />
    {:else if d.state === "pending"}
      <div class="msg" role="status"><span class="dab" aria-hidden="true"></span><p class="big">Wird aufbereitet</p><p class="m">Das dauert einen Moment. Diese Seite aktualisiert sich selbst.</p></div>
    {:else if d.state === "failed"}
      <div class="msg" role="alert">
        <p class="big">Das hat nicht geklappt</p>
        <p class="m">{d.error ?? "Diese Datei konnte nicht aufbereitet werden."}</p>
        <a class="main" href="/media/doc/{id}/o" download><Icon name="herunterladen" size={20} sw={1.9} />Original herunterladen</a>
      </div>
    {:else if d.kind === "book"}
      {#key d.id}<BookReader detail={d} />{/key}
    {:else if d.kind === "audio"}
      <AudioView detail={d} mark={wanted()} />
    {:else if d.kind === "other"}
      {#if d.text}
        <TextView detail={d} plain q={finding ? searched : ""} {at} onfound={n => (textHits = n)} />
      {:else}
        <div class="msg" role="status">
          <p class="big">Diese Datei kann Monet nicht anzeigen.</p>
          <p class="m tnum">{fileSign(d.format)} · {bytes(d.bytes)}</p>
          <a class="main" href="/media/doc/{id}/o" download><Icon name="herunterladen" size={20} sw={1.9} />Herunterladen</a>
        </div>
      {/if}
    {:else if d.kind === "sheet"}
      <SheetGrid detail={d} marks={finding ? hits : []} focus={focusHit} />
    {:else if d.kind === "slides"}
      <SlideView detail={d} marks={finding ? hits : []} focus={focusHit} />
    {:else if textual && !asPages}
      <TextView detail={d} q={finding ? searched : ""} {at} onfound={n => (textHits = n)} />
    {:else}
      <DocPages detail={d} marks={finding ? hits : []} focus={focusHit} />
    {/if}
  </div>
</div>

{#if moving && d}
  <MoveSheet docs={[id]} onclose={() => (moving = false)} ondone={() => { moving = false; load(true); }} />
{/if}

<style>
  .datei { position: fixed; inset: 0; box-sizing: border-box; padding-bottom: var(--player-h, 0px); z-index: 25; display: flex; flex-direction: column; background: var(--ground); min-width: 0; }
  header { flex: none; display: flex; align-items: center; gap: 8px; min-height: 60px; padding: calc(6px + env(safe-area-inset-top)) 10px 6px; background: var(--surface); border-bottom: 1px solid var(--rule); }
  h1 { flex: 1; min-width: 0; font-size: 21px; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .wide h1 { font-size: 24px; }
  .acts { flex: none; display: flex; align-items: center; gap: 6px; }
  .ib, .pill { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-width: 44px; height: 44px; padding: 0; border: 0; border-radius: 22px; background: transparent; color: var(--ink); font-size: 14px; font-weight: 600; white-space: nowrap; }
  .ib:hover, .pill:hover { background: var(--surface-2); }
  .pill[aria-expanded=true], .pill[aria-pressed=true] { background: var(--water-soft); }
  .lbl { display: none; }
  button.pill:not(.ib) { padding: 0 14px; background: var(--surface-2); }
  .wide .pill.ib { padding: 0 14px; background: var(--surface-2); } .wide .pill.ib:hover, .wide button.pill:not(.ib):hover { background: var(--surface-3); }
  .wide .lbl { display: inline; }
  /* the actions of a narrow desktop window do not fit with their words: only the icons stay */
  @media (max-width: 1180px) { .wide .lbl { display: none; } .wide .pill.ib { padding: 0; min-width: 44px; } }
  .details { position: absolute; z-index: 5; top: calc(60px + env(safe-area-inset-top)); right: 10px; width: min(420px, calc(100% - 20px)); padding: 14px 18px; border-radius: 18px; background: var(--surface); box-shadow: var(--shadow); }
  dl { display: grid; grid-template-columns: 96px minmax(0, 1fr); row-gap: 6px; column-gap: 10px; margin: 0; font-size: 13.5px; }
  dt { color: var(--muted); } dd { margin: 0; overflow-wrap: anywhere; }
  .path :global(a) { color: var(--water); } .path :global(a:hover) { text-decoration: underline; }
  .find { position: absolute; z-index: 6; top: calc(66px + env(safe-area-inset-top)); right: 10px; display: flex; align-items: center; gap: 4px; padding: 6px 6px 6px 8px; border-radius: 22px; background: var(--surface); box-shadow: var(--shadow); max-width: calc(100% - 20px); }
  .find input { width: min(260px, 44vw); height: 36px; padding: 0 12px; border: 0; border-radius: 18px; background: var(--surface-2); font-size: 15px; }
  .find input:focus { outline: 2px solid var(--water); outline-offset: 0; }
  .cnt { min-width: 74px; padding: 0 6px; font-size: 12.5px; color: var(--muted); text-align: center; white-space: nowrap; }
  .sm { min-width: 36px; height: 36px; }
  .sm:disabled { opacity: .4; }
  .down :global(svg) { transform: rotate(180deg); }
  .body { flex: 1; min-height: 0; display: flex; flex-direction: column; min-width: 0; }
  .msg { margin: auto; padding: 24px; max-width: 420px; display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; }
  .big { font-family: var(--font-display); font-size: 28px; line-height: 1.15; } .m { color: var(--muted); }
  .dab { width: 36px; height: 12px; border-radius: 999px; background: var(--teich); opacity: .6; transform: rotate(-4deg); margin-bottom: 6px; }
  .main { margin-top: 10px; min-height: 46px; display: inline-flex; align-items: center; gap: 8px; padding: 0 20px; border-radius: 23px; background: var(--ink); color: var(--on-ink); font-weight: 650; }
</style>
