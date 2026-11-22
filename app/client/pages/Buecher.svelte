<script lang="ts">
  // Bücher: the covers as a shelf, grouped by author ("Ohne Autor" last), a search over title and text.
  import { onMount } from "svelte";
  import { app, viewing } from "../lib/state.svelte";
  import { KINDS, docList, byAuthor, onUploaded } from "../lib/files.svelte";
  import { count } from "../lib/format";
  import PageHead from "../components/PageHead.svelte";
  import DocCard from "../components/DocCard.svelte";
  import FilePills from "../components/FilePills.svelte";
  import ImportSheet from "../components/ImportSheet.svelte";
  import Loading from "../components/Loading.svelte";
  const k = KINDS.book;
  // groups need all their books: the pages of 200 follow each other until the list is complete
  const list = docList("book", 200), s = list.s;
  let q = $state(""), importing = $state(false);
  onMount(() => { list.reload(); });
  onUploaded(() => list.reload());
  $effect(() => {
    const v = q.trim();
    if (v === s.q) return;
    const t = setTimeout(() => list.search(v), 250);
    return () => clearTimeout(t);
  });
  $effect(() => { if (s.next && !s.loading) list.more(); });
  const groups = $derived(byAuthor(s.docs));
  const empty = $derived(`Noch keine Bücher. ${app.wide ? "Ziehe EPUB-Dateien in das Fenster oder wähle" : "Wähle"} „Importieren“.`);
</script>
<FilePills />
<PageHead title={k.title} room={k.room} sub={s.loaded && !s.q ? count(s.docs.length, k.one, k.title) : ""}>
  {#if !app.wide && viewing() == null}<button type="button" class="pill" onclick={() => (importing = true)}>Importieren</button>{/if}
</PageHead>
<div class="bar"><input type="search" bind:value={q} placeholder="Bücher durchsuchen" aria-label="Bücher durchsuchen" /></div>
{#if s.error}<p class="m" role="alert">{s.error}</p>{/if}
{#if s.loaded && !s.docs.length}<p class="m">{s.q ? `Zu „${s.q}“ gibt es keine Bücher.` : empty}</p>{/if}
{#each groups as g (g.key)}
  <section aria-label={g.label}>
    <h2>{g.label}</h2>
    <div class="shelf">{#each g.docs as d (d.id)}<DocCard doc={d} />{/each}</div>
  </section>
{/each}
{#if s.loading && !s.loaded}<Loading text="Die Bücher kommen" />{/if}
<ImportSheet bind:open={importing} />
<style>
  .bar { padding: 6px 14px 0; max-width: 520px; }
  input { width: 100%; height: 46px; padding: 0 14px; border: 0; border-radius: 12px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--rule); font-size: 16px; }
  input:focus { box-shadow: inset 0 0 0 1.5px var(--water); }
  h2 { font-size: 24px; padding: 20px 14px 8px; }
  /* three covers across on a phone */
  .shelf { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px 12px; padding: 0 14px; align-items: start; }
  .m { padding: 18px 14px; color: var(--muted); }
  .pill { height: 44px; padding: 0 14px; border: 0; border-radius: 22px; background: var(--surface-2); font-size: 14px; font-weight: 650; }
  @media (min-width: 900px) { .bar, h2, .shelf, .m { padding-left: 0; padding-right: 0; } .shelf { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 24px 18px; } }
</style>
