<script lang="ts">
  // Alben, and the series hung beside them (the atelier room).
  import { lists, loadLists } from "../lib/stores.svelte";
  import { createAlbum } from "../lib/actions.svelte";
  import { go, toast } from "../lib/state.svelte";
  import PageHead from "../components/PageHead.svelte";
  import Cover from "../components/Cover.svelte";
  import Pic from "../components/Pic.svelte";
  import Link from "../components/Link.svelte";
  import { num } from "../lib/format";
  let name = $state(""), busy = $state(false);
  $effect(() => { loadLists(); });
  async function make(e: Event) {
    e.preventDefault(); const n = name.trim(); if (!n) return; busy = true;
    try { const a = await createAlbum(n); name = ""; await loadLists(); go(`/alben/${a.id}`); } catch (err: any) { toast(err.message); } finally { busy = false; }
  }
</script>
<PageHead title="Alben" room="--atelier" sub={lists.loaded ? `${num(lists.albums.length)} Alben, ${num(lists.series.length)} Serien` : ""} />
<form onsubmit={make}><input type="text" bind:value={name} placeholder="Neues Album" aria-label="Name des neuen Albums" /><button type="submit" disabled={busy || !name.trim()}>Anlegen</button></form>
{#if lists.series.length}
  <h2>Serien</h2>
  <div class="series">
    {#each lists.series as s (s.key)}
      <Link href="/serie/{s.key}" class="serie2" aria-label="Serie: {s.title}, {s.subtitle}">
        <span class="st"><span class="t">{s.title}</span><span class="s tnum">{s.subtitle}</span></span>
        <span class="hung">{#each s.items.slice(0, 8) as it}<span class="f"><span class="pic"><Pic id={it.id} w={4} h={5} sizes="80px" /></span><span class="tnum y">{it.year}</span></span>{/each}</span>
      </Link>
    {/each}
  </div>
{/if}
<h2>Alben</h2>
{#if lists.loaded && !lists.albums.length}<p class="m">Noch kein Album. Lege oben eins an oder wähle Fotos und tippe auf „Zum Album“.</p>{/if}
<div class="g">{#each lists.albums as a (a.id)}<Cover href="/alben/{a.id}" name={a.name} n={a.count} cover={a.cover} />{/each}</div>
<style>
  form { display: flex; gap: 8px; padding: 8px 14px 0; max-width: 520px; }
  input { flex: 1; min-width: 0; height: 46px; padding: 0 14px; border: 0; border-radius: 12px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--rule); font-size: 16px; }
  input:focus { box-shadow: inset 0 0 0 1.5px var(--water); }
  form button { height: 46px; padding: 0 18px; border: 0; border-radius: 23px; background: var(--ink); color: var(--on-ink); font-weight: 650; } form button:disabled { opacity: .5; }
  h2 { font-size: 26px; padding: 20px 14px 8px; } .m { padding: 0 14px; color: var(--muted); }
  .series { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; padding: 0 14px; }
  .series :global(.serie2) { display: flex; flex-direction: column; gap: 8px; padding: 12px 12px 10px; border-radius: 16px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--rule); }
  .st { display: flex; flex-direction: column; line-height: 1.15; } .t { font-family: var(--font-display); font-size: 22px; } .s { font-size: 12.5px; color: var(--muted); }
  .hung { display: flex; gap: 5px; } .f { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 3px; }
  .pic { display: block; width: 100%; aspect-ratio: 4 / 5; border-radius: 3px; overflow: hidden; box-shadow: 0 1px 2px rgb(34 48 94 / .18); } .y { font-size: 11px; color: var(--muted); }
  .g { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 12px; padding: 0 14px; }
  @media (min-width: 900px) { form, h2, .series, .g, .m { padding-left: 0; padding-right: 0; } .g { grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 24px 16px; } }
</style>
