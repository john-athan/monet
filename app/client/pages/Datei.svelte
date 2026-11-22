<script lang="ts">
  // One file, for viewing only. It fills the screen like a photo does; the header carries the title and what you can do
  // with the file, the body is one of the viewers: pages, slides, sheet, book, audio, text, or a download panel.
  import type { DocDetail, DocKind } from "../../shared/types";
  import { KINDS, fileSign } from "../lib/files.svelte";
  import { api, post } from "../lib/api";
  import { backOr, go, toast, house } from "../lib/state.svelte";
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
  $effect(() => { id; d = null; error = ""; details = false; load(); });
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
      <AudioView detail={d} />
    {:else if d.kind === "other"}
      {#if d.text}
        <TextView detail={d} plain />
      {:else}
        <div class="msg" role="status">
          <p class="big">Diese Datei kann Monet nicht anzeigen.</p>
          <p class="m tnum">{fileSign(d.format)} · {bytes(d.bytes)}</p>
          <a class="main" href="/media/doc/{id}/o" download><Icon name="herunterladen" size={20} sw={1.9} />Herunterladen</a>
        </div>
      {/if}
    {:else if d.kind === "sheet"}
      <SheetGrid detail={d} />
    {:else if d.kind === "slides"}
      <SlideView detail={d} />
    {:else if textual && !asPages}
      <TextView detail={d} />
    {:else}
      <DocPages detail={d} />
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
  .body { flex: 1; min-height: 0; display: flex; flex-direction: column; min-width: 0; }
  .msg { margin: auto; padding: 24px; max-width: 420px; display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; }
  .big { font-family: var(--font-display); font-size: 28px; line-height: 1.15; } .m { color: var(--muted); }
  .dab { width: 36px; height: 12px; border-radius: 999px; background: var(--teich); opacity: .6; transform: rotate(-4deg); margin-bottom: 6px; }
  .main { margin-top: 10px; min-height: 46px; display: inline-flex; align-items: center; gap: 8px; padding: 0 20px; border-radius: 23px; background: var(--ink); color: var(--on-ink); font-weight: 650; }
</style>
