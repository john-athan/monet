<script lang="ts">
  // One series, hung like Monet's haystacks: the same subject, one row per year, large.
  import type { SeriesOut } from "../../shared/types";
  import { api } from "../lib/api";
  import { view } from "../lib/state.svelte";
  import PageHead from "../components/PageHead.svelte";
  import Pic from "../components/Pic.svelte";
  import Link from "../components/Link.svelte";
  import Loading from "../components/Loading.svelte";
  let { key }: { key: string } = $props();
  let s = $state<SeriesOut | null | undefined>(undefined);
  $effect(() => { const my = key; s = undefined; api<SeriesOut[]>("/api/series").then(r => { if (my === key) s = r.find(x => x.key === my) ?? null; }).catch(() => (s = null)); });
  $effect(() => { if (s) view.ids = s.items.map(i => i.id); });
</script>
<PageHead title={s?.title ?? "Serie"} room="--atelier" sub={s?.subtitle ?? ""} />
<div class="p">
  <Link href="/alben" class="back">Alle Alben und Serien</Link>
  {#if s === undefined}<Loading />{:else if s === null}<p class="m">Diese Serie gibt es nicht (mehr).</p>
  {:else}
    <ol>
      {#each [...s.items].sort((a, b) => a.year - b.year) as it (it.id)}
        <li>
          <Link href="/foto/{it.id}" class="row" aria-label="{it.year}: Foto öffnen" data-item>
            <span class="y tnum">{it.year}</span>
            <span class="pic"><Pic id={it.id} w={3} h={2} sizes="(min-width: 900px) 900px, 100vw" eager /></span>
          </Link>
        </li>
      {/each}
    </ol>
  {/if}
</div>
<style>
  .p { display: flex; flex-direction: column; gap: 12px; } .m { padding: 14px; color: var(--muted); }
  .p :global(.back) { padding: 0 14px; font-size: 13px; color: var(--muted); min-height: 32px; display: flex; align-items: center; }
  ol { list-style: none; margin: 0; padding: 0 14px; display: flex; flex-direction: column; gap: 22px; }
  .p :global(.row) { display: flex; flex-direction: column; gap: 6px; }
  .y { font-family: var(--font-display); font-size: 34px; line-height: 1; }
  .pic { display: block; aspect-ratio: 3 / 2; border-radius: 6px; overflow: hidden; background: var(--surface-2); box-shadow: 0 1px 2px rgb(34 48 94 / .18), var(--shadow); }
  @media (min-width: 900px) { .p :global(.back), ol { padding-left: 0; padding-right: 0; } ol { max-width: 980px; } .p :global(.row) { flex-direction: row; align-items: flex-end; gap: 18px; } .y { width: 90px; flex: none; font-size: 40px; } .pic { flex: 1; } }
</style>
