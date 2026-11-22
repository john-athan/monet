<script lang="ts">
  // Momente (docs/together.md): the trips and the big days, newest first, each with four of its photos and its count.
  import type { MomentSummary } from "../../shared/types";
  import { api } from "../lib/api";
  import { count } from "../lib/format";
  import PageHead from "../components/PageHead.svelte";
  import Pic from "../components/Pic.svelte";
  import Link from "../components/Link.svelte";
  import Loading from "../components/Loading.svelte";
  let list = $state<MomentSummary[] | null>(null), error = $state("");
  $effect(() => { api<MomentSummary[]>("/api/moments").then(r => (list = r)).catch(e => (error = e.message)); });
  const years = $derived.by(() => {
    const out: { y: string; ms: MomentSummary[] }[] = [];
    for (const m of list ?? []) { const y = m.start.slice(0, 4), last = out.at(-1); if (last?.y === y) last.ms.push(m); else out.push({ y, ms: [m] }); }
    return out;
  });
  const what = (m: MomentSummary) => [count(m.count, "Foto", "Fotos"), m.docs ? count(m.docs, "Datei", "Dateien") : ""].filter(Boolean).join(", ");
</script>
<PageHead title="Momente" room="--teich" sub={list ? count(list.length, "Moment", "Momente") : ""} />
{#if error}<p class="m" role="alert">{error}</p>
{:else if !list}<Loading />
{:else if !list.length}<p class="m">Noch keine Momente. Ein Moment entsteht aus Tagen unterwegs oder einem großen Tag zu Hause, sobald genug Fotos davon da sind.</p>
{:else}
  {#each years as g (g.y)}
    <section aria-label={g.y}>
      <h2 class="tnum">{g.y}</h2>
      <div class="grid">
        {#each g.ms as m (m.key)}
          <Link href="/moment/{m.key}" class="mo" aria-label="{m.title}, {m.subtitle}, {what(m)}">
            <span class="pics">{#each m.cover as id, k (id)}<span class="p p{k}"><Pic {id} w={1} h={1} square sizes="(min-width: 900px) 140px, 25vw" /></span>{/each}</span>
            <span class="t">{m.title}</span>
            <span class="s tnum">{m.subtitle} · {what(m)}</span>
          </Link>
        {/each}
      </div>
    </section>
  {/each}
{/if}
<style>
  .m { padding: 18px 14px; color: var(--muted); max-width: 560px; }
  h2 { font-size: 24px; padding: 20px 14px 8px; }
  .grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 22px; padding: 0 14px; }
  .grid :global(.mo) { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .pics { display: grid; grid-template-columns: 2fr 1fr; grid-template-rows: 1fr 1fr; gap: 3px; aspect-ratio: 16 / 10; border-radius: 14px; overflow: hidden; background: var(--surface-2); }
  .p { display: block; min-height: 0; overflow: hidden; } .p0 { grid-row: span 2; }
  .p3 { display: none; }
  :global(.mo:hover) .pics { filter: brightness(1.05) saturate(1.05); }
  .t { font-family: var(--font-display); font-size: 24px; line-height: 1.15; overflow-wrap: anywhere; }
  .s { font-size: 13px; color: var(--muted); }
  @media (min-width: 900px) { h2, .grid, .m { padding-left: 0; padding-right: 0; } .grid { grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 28px 18px; } }
</style>
