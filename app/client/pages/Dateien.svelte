<script lang="ts">
  // Dokumente, Tabellen, Präsentationen: the covers by month of their change, a search over title and text.
  import { onMount, untrack } from "svelte";
  import type { DocKind, DocSummary } from "../../shared/types";
  import { app, viewing } from "../lib/state.svelte";
  import { KINDS, docList, monthLabel, onUploaded } from "../lib/files.svelte";
  import { count } from "../lib/format";
  import PageHead from "../components/PageHead.svelte";
  import DocCard from "../components/DocCard.svelte";
  import FilePills from "../components/FilePills.svelte";
  import ImportSheet from "../components/ImportSheet.svelte";
  import Loading from "../components/Loading.svelte";
  let { kind }: { kind: DocKind } = $props();
  const k = $derived(KINDS[kind]);
  // one list per page: App mounts each kind as its own page
  const list = untrack(() => docList(kind)), s = list.s;
  let q = $state(""), importing = $state(false);
  onMount(() => { list.reload(); });
  onUploaded(() => list.reload());
  // typing waits a moment, so a word is not searched letter by letter
  $effect(() => {
    const v = q.trim();
    if (v === list.s.q) return;
    const t = setTimeout(() => list.search(v), 250);
    return () => clearTimeout(t);
  });
  const groups = $derived.by(() => {
    const out: { label: string; docs: DocSummary[] }[] = [];
    for (const d of s.docs) {
      const label = monthLabel(d.modifiedAt), last = out.at(-1);
      if (last && last.label === label) last.docs.push(d); else out.push({ label, docs: [d] });
    }
    return out;
  });
  const empty = $derived(`Noch keine ${({ doc: "Dokumente", sheet: "Tabellen", slides: "Präsentationen" } as const)[kind]}. ${app.wide ? "Ziehe Dateien in das Fenster oder wähle" : "Wähle"} „Importieren“.`);
  // the next page loads when the end of the list comes near
  let end: HTMLElement | undefined = $state();
  $effect(() => {
    if (!end) return;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) list.more(); }, { rootMargin: "600px" });
    io.observe(end); return () => io.disconnect();
  });
</script>
<FilePills />
<PageHead title={k.title} room={k.room} sub={s.loaded && !s.q ? count(s.docs.length, k.one, k.title) + (s.next ? " und mehr" : "") : ""}>
  {#if !app.wide && viewing() == null}<button type="button" class="pill" onclick={() => (importing = true)}>Importieren</button>{/if}
</PageHead>
<div class="bar"><input type="search" bind:value={q} placeholder="{k.title} durchsuchen" aria-label="{k.title} durchsuchen" /></div>
{#if s.error}<p class="m" role="alert">{s.error}</p>{/if}
{#if s.loaded && !s.docs.length}<p class="m">{s.q ? `Zu „${s.q}“ gibt es keine ${k.title}.` : empty}</p>{/if}
{#each groups as g (g.label)}
  <section aria-label={g.label}>
    <h2>{g.label}</h2>
    <div class="grid">{#each g.docs as d (d.id)}<DocCard doc={d} />{/each}</div>
  </section>
{/each}
{#if s.loading && !s.loaded}<Loading text="Die Dateien kommen" />{/if}
<div bind:this={end} class="end"></div>
<ImportSheet bind:open={importing} />
<style>
  .bar { padding: 6px 14px 0; max-width: 520px; }
  input { width: 100%; height: 46px; padding: 0 14px; border: 0; border-radius: 12px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--rule); font-size: 16px; }
  input:focus { box-shadow: inset 0 0 0 1.5px var(--water); }
  h2 { font-size: 24px; padding: 20px 14px 8px; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 12px; padding: 0 14px; align-items: start; }
  .m { padding: 18px 14px; color: var(--muted); }
  .pill { height: 44px; padding: 0 14px; border: 0; border-radius: 22px; background: var(--surface-2); font-size: 14px; font-weight: 650; }
  .end { height: 1px; }
  @media (min-width: 900px) { .bar, h2, .grid, .m { padding-left: 0; padding-right: 0; } .grid { grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 24px 16px; } }
</style>
