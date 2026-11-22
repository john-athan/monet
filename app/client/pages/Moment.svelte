<script lang="ts">
  // One moment (docs/together.md): its days as photos, and beside them the files that belong to it: what was made during
  // it, and the bookings and invoices before and after that name its places.
  import type { MomentOut } from "../../shared/types";
  import { api } from "../lib/api";
  import { view } from "../lib/state.svelte";
  import { count } from "../lib/format";
  import PageHead from "../components/PageHead.svelte";
  import Grid from "../components/Grid.svelte";
  import DocCard from "../components/DocCard.svelte";
  import Link from "../components/Link.svelte";
  import Loading from "../components/Loading.svelte";
  let { key }: { key: string } = $props();
  let m = $state<MomentOut | null | undefined>(undefined);
  $effect(() => { const my = key; m = undefined; api<MomentOut>(`/api/moments/${my}`).then(r => { if (my === key) m = r; }).catch(() => { if (my === key) m = null; }); });
  $effect(() => { if (m) view.ids = m.items.map(i => i.id); });
</script>
<PageHead title={m?.title ?? "Moment"} room="--teich" sub={m ? `${m.subtitle} · ${count(m.count, "Foto", "Fotos")}` : ""} />
<div class="p">
  <Link href="/momente" class="back">Alle Momente</Link>
  {#if m === undefined}<Loading />{:else if m === null}<p class="m">Diesen Moment gibt es nicht (mehr).</p>
  {:else}
    {#if m.files.length}
      <section aria-label="Dateien dazu">
        <h2>Dateien dazu <span class="tnum n">{count(m.files.length, "Datei", "Dateien")}</span></h2>
        <div class="strip">{#each m.files as d (d.id)}<div class="dc"><DocCard doc={d} /></div>{/each}</div>
      </section>
    {/if}
    <Grid items={m.items} />
  {/if}
</div>
<style>
  .p { display: flex; flex-direction: column; gap: 12px; } .m { padding: 14px; color: var(--muted); }
  .p :global(.back) { padding: 0 14px; font-size: 13px; color: var(--muted); min-height: 32px; display: flex; align-items: center; }
  h2 { font-size: 20px; padding: 4px 14px 8px; display: flex; align-items: baseline; gap: 10px; }
  .n { font-family: var(--font-body); font-size: 13px; color: var(--muted); font-weight: 600; }
  .strip { display: flex; gap: 12px; overflow-x: auto; padding: 0 14px 6px; }
  .dc { flex: none; width: 132px; }
  @media (min-width: 900px) { .p :global(.back), h2, .strip { padding-left: 0; padding-right: 0; } .dc { width: 150px; } }
</style>
