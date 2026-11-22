<script lang="ts">
  // Dokumente, Tabellen, Präsentationen, Bücher, Audio: the files of one kind on the timeline of the photos, on their
  // own days (docs/together.md), with the band to jump through the years. A search keeps the timeline, of its hits.
  import { onMount, untrack } from "svelte";
  import type { DocKind } from "../../shared/types";
  import { app, viewing } from "../lib/state.svelte";
  import { KINDS, onUploaded } from "../lib/files.svelte";
  import { band, loadBand, kindTimeline, makeTimeline, jumper } from "../lib/stores.svelte";
  import { count } from "../lib/format";
  import PageHead from "../components/PageHead.svelte";
  import Timeline from "../components/Timeline.svelte";
  import Band from "../components/Band.svelte";
  import FilePills from "../components/FilePills.svelte";
  import ImportSheet from "../components/ImportSheet.svelte";
  import Loading from "../components/Loading.svelte";
  import { stacks, openStack, closeStack, followStacks, withStack } from "../lib/stacks.svelte";
  let { kind }: { kind: DocKind } = $props();
  const k = $derived(KINDS[kind]);
  const NONE: Partial<Record<DocKind, string>> = { doc: "keine Dokumente", sheet: "keine Tabellen", slides: "keine Präsentationen", book: "keine Bücher", audio: "kein Audio" };
  const DROP: Partial<Record<DocKind, string>> = { book: "EPUB-Dateien", audio: "Musik" };

  // the timeline of the kind is kept between visits; a search is a timeline of its own
  let q = $state(""), shownQ = $state(""), importing = $state(false);
  const base = untrack(() => kindTimeline(kind));
  let cur = $state(base);
  const s = $derived(cur.tl);
  const key = $derived(`kind=${kind}${shownQ ? `&q=${encodeURIComponent(shownQ)}` : ""}`);
  const unit = $derived(kind === "audio" ? "Titel" : kind === "book" ? "Bücher" : "Dateien");
  // typing waits a moment, so a word is not searched letter by letter
  $effect(() => {
    const v = q.trim();
    if (v === untrack(() => shownQ)) return;
    const t = setTimeout(() => {
      shownQ = v; cur = v ? makeTimeline(`kind=${kind}&q=${encodeURIComponent(v)}`) : base;
      if (!cur.tl.loaded) cur.loadMore(16);
      loadBand(key, unit); scrollTo({ top: 0, behavior: "auto" });
    }, 250);
    return () => clearTimeout(t);
  });

  const days = $derived(s.days.map(d => ({ ...d, docs: withStack(d.docs ?? []) })).filter(d => d.docs.length));
  $effect(() => { void app.query; followStacks(); });
  let t: Timeline | undefined = $state();
  const jumpTo = jumper({ days: () => days, more: () => cur.loadMore(60), next: () => !!cur.tl.next, scroll: i => t?.scrollToDay(i) });
  const onpos = (date: string) => { band.current = date.slice(0, 7); };
  onMount(() => {
    if (!base.tl.loaded) base.loadMore(16).then(() => base.loadMore(24));
    if (!band.loaded || band.key !== key) loadBand(key, unit);
    band.jump = jumpTo;
    return () => { if (band.jump === jumpTo) band.jump = null; };
  });
  onUploaded(() => { cur.refresh(); loadBand(key, unit); });
  const total = $derived(band.key === key ? band.months.reduce((n, m) => n + m.n, 0) : 0);
  const empty = $derived(`Noch ${NONE[kind]}. ${app.wide ? `Ziehe ${DROP[kind] ?? "Dateien"} in das Fenster oder wähle` : "Wähle"} „Importieren“.`);
</script>
<FilePills />
<PageHead title={k.title} room={k.room} sub={band.loaded && band.key === key && !shownQ && total ? count(total, k.one, kind === "audio" ? "Titel" : k.title) : ""}>
  {#if !app.wide && viewing() == null}<button type="button" class="pill" onclick={() => (importing = true)}>Importieren</button>{/if}
</PageHead>
<div class="bar"><input type="search" bind:value={q} placeholder="{k.title} durchsuchen" aria-label="{k.title} durchsuchen" /></div>
{#if s.error}<p class="m" role="alert">{s.error}</p>{/if}
{#if s.loaded && !days.length}<p class="m">{shownQ ? `Zu „${shownQ}“ gibt es ${NONE[kind]}.` : empty}</p>{/if}
<div class="tlwrap" class:wide={app.wide}>
  <Timeline bind:this={t} {days} wide={app.wide} {onpos} onend={() => cur.loadMore()} open={stacks.open} onstack={openStack} onfold={closeStack} />
</div>
{#if !s.loaded}<Loading text="Die Dateien kommen" />{/if}
{#if !app.wide && band.loaded && band.key === key && band.months.length}<Band vertical />{/if}
<ImportSheet bind:open={importing} />
<style>
  .bar { padding: 6px 14px 0; max-width: 520px; }
  input { width: 100%; height: 46px; padding: 0 14px; border: 0; border-radius: 12px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--rule); font-size: 16px; }
  input:focus { box-shadow: inset 0 0 0 1.5px var(--water); }
  .m { padding: 18px 14px; color: var(--muted); }
  .pill { height: 44px; padding: 0 14px; border: 0; border-radius: 22px; background: var(--surface-2); font-size: 14px; font-weight: 650; }
  .tlwrap { padding-right: 22px; }
  .tlwrap.wide { padding-right: 0; }
  @media (min-width: 900px) { .bar, .m { padding-left: 0; padding-right: 0; } }
</style>
