<script lang="ts">
  // Audio: the tracks grouped by album (album and artist as heading, tracks in track order), a search over title and tags.
  // A click queues the whole album from that track in the global player.
  import { onMount } from "svelte";
  import type { DocSummary } from "../../shared/types";
  import { app, viewing } from "../lib/state.svelte";
  import { KINDS, docList, byAlbum, hasCover, coverUrl, onUploaded } from "../lib/files.svelte";
  import { duration, count } from "../lib/format";
  import { player, isCurrent, play, toggle } from "../lib/player.svelte";
  import PageHead from "../components/PageHead.svelte";
  import CoverArt from "../components/CoverArt.svelte";
  import FilePills from "../components/FilePills.svelte";
  import ImportSheet from "../components/ImportSheet.svelte";
  import Loading from "../components/Loading.svelte";
  import Icon from "../components/Icon.svelte";
  import Link from "../components/Link.svelte";
  const k = KINDS.audio;
  const list = docList("audio", 200), s = list.s;
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
  const groups = $derived(byAlbum(s.docs).map(g => ({ ...g, cover: g.docs.find(hasCover) })));
  const empty = $derived(`Noch kein Audio. ${app.wide ? "Ziehe Musik in das Fenster oder wähle" : "Wähle"} „Importieren“.`);
  const label = (d: DocSummary, g: { sub: string }) => d.by && d.by !== g.sub ? d.by : "";
</script>
<FilePills />
<PageHead title={k.title} room={k.room} sub={s.loaded && !s.q ? count(s.docs.length, k.one, "Titel") : ""}>
  {#if !app.wide && viewing() == null}<button type="button" class="pill" onclick={() => (importing = true)}>Importieren</button>{/if}
</PageHead>
<div class="bar"><input type="search" bind:value={q} placeholder="Audio durchsuchen" aria-label="Audio durchsuchen" /></div>
{#if s.error}<p class="m" role="alert">{s.error}</p>{/if}
{#if s.loaded && !s.docs.length}<p class="m">{s.q ? `Zu „${s.q}“ gibt es kein Audio.` : empty}</p>{/if}
{#each groups as g (g.key)}
  <section class="album" aria-label={g.label}>
    <div class="cov">
      {#if g.cover}<img src={coverUrl(g.cover.id)} width={g.cover.w} height={g.cover.h} alt="" loading="lazy" decoding="async" />
      {:else}<CoverArt doc={g.docs[0]} />{/if}
    </div>
    <div class="head"><h2>{g.label}</h2>{#if g.sub}<p>{g.sub}</p>{/if}</div>
    <ol class="tracks">
      {#each g.docs as d, i (d.id)}
        <li>
          <button type="button" class="row" class:cur={isCurrent(d.id)} aria-current={isCurrent(d.id) ? "true" : undefined} onclick={() => (isCurrent(d.id) ? toggle() : play(g.docs, i))}>
            <span class="no tnum">{#if isCurrent(d.id)}<Icon name={player.playing ? "pause" : "play"} size={14} />{:else}{d.track ?? ""}{/if}</span>
            <span class="tt">{d.title}{#if label(d, g)}<span class="by">{label(d, g)}</span>{/if}</span>
            <span class="du tnum">{d.durationMs ? duration(d.durationMs) : ""}</span>
          </button>
          <Link href="/datei/{d.id}" class="open" aria-label="{d.title}, Details"><Icon name="chevron" size={14} sw={2} /></Link>
        </li>
      {/each}
    </ol>
  </section>
{/each}
{#if s.loading && !s.loaded}<Loading text="Das Audio kommt" />{/if}
<ImportSheet bind:open={importing} />
<style>
  .bar { padding: 6px 14px 0; max-width: 520px; }
  input { width: 100%; height: 46px; padding: 0 14px; border: 0; border-radius: 12px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--rule); font-size: 16px; }
  input:focus { box-shadow: inset 0 0 0 1.5px var(--water); }
  .album { display: grid; grid-template-columns: 76px minmax(0, 1fr); grid-template-areas: "c h" "t t"; gap: 8px 14px; padding: 22px 14px 4px; align-items: center; }
  .cov { grid-area: c; width: 76px; aspect-ratio: 1; border-radius: 8px; overflow: hidden; box-shadow: inset 0 0 0 1px var(--rule); background: var(--surface-2); }
  .cov img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .head { grid-area: h; min-width: 0; }
  h2 { font-size: 24px; line-height: 1.15; overflow-wrap: anywhere; }
  .head p { color: var(--muted); font-size: 14px; }
  .tracks { grid-area: t; list-style: none; margin: 0; padding: 0; }
  li { display: flex; align-items: center; border-top: 1px solid var(--rule); }
  .row { flex: 1; min-width: 0; display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; align-items: center; gap: 8px; min-height: 48px; padding: 0 4px; border: 0; background: transparent; color: var(--ink); text-align: left; font: inherit; cursor: pointer; border-radius: 8px; }
  .row:hover { background: var(--surface-2); }
  .row.cur { color: var(--water); font-weight: 650; }
  .no { text-align: right; color: var(--muted); font-size: 13px; display: flex; justify-content: flex-end; }
  .cur .no { color: var(--water); }
  .tt { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .by { margin-left: 8px; color: var(--muted); font-size: 12.5px; font-weight: 400; }
  .du { color: var(--muted); font-size: 13px; }
  li :global(.open) { flex: none; display: grid; place-items: center; width: 40px; height: 44px; color: var(--muted); border-radius: 8px; }
  li :global(.open:hover) { background: var(--surface-2); color: var(--ink); }
  .m { padding: 18px 14px; color: var(--muted); }
  .pill { height: 44px; padding: 0 14px; border: 0; border-radius: 22px; background: var(--surface-2); font-size: 14px; font-weight: 650; }
  @media (min-width: 900px) {
    .bar, .m { padding-left: 0; padding-right: 0; }
    .album { padding: 26px 0 4px; grid-template-columns: 120px minmax(0, 1fr); grid-template-areas: "c h" "c t"; align-items: start; gap: 4px 22px; max-width: 820px; }
    .cov { width: 120px; }
    .head { align-self: end; }
    .tracks { align-self: start; }
  }
</style>
