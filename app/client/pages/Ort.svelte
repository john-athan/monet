<script lang="ts">
  import type { ItemSummary, PlaceOut } from "../../shared/types";
  import { api } from "../lib/api";
  import { byChip } from "../lib/results.svelte";
  import { count } from "../lib/format";
  import PageHead from "../components/PageHead.svelte";
  import Grid from "../components/Grid.svelte";
  import Loading from "../components/Loading.svelte";
  import Link from "../components/Link.svelte";
  let { id }: { id: number } = $props();
  let items = $state<ItemSummary[] | null>(null), place = $state<PlaceOut | null>(null), error = $state("");
  $effect(() => {
    const my = id; items = null; place = null; error = "";
    api<PlaceOut[]>("/api/places").then(r => { if (my === id) place = r.find(p => p.id === my) ?? null; }).catch(() => {});
    byChip({ kind: "place", label: "Ort", value: String(my) }).then(r => { if (my === id) items = r; }).catch(e => (error = e.message));
  });
  import Mentioned from "../components/Mentioned.svelte";
</script>
<PageHead title={place?.name ?? "Ort"} room="--garten" sub={items ? count(items.length, "Foto", "Fotos") : ""} />
<Mentioned kind="place" {id} />
<div class="p">
  <Link href="/orte" class="back">Alle Orte</Link>
  {#if error}<p class="m" role="alert">{error}</p>{:else if !items}<Loading />{:else if !items.length}<p class="m">Hier ist noch kein Foto.</p>{:else}<Grid {items} />{/if}
</div>
<style>
  .p { display: flex; flex-direction: column; gap: 12px; } .m { padding: 14px; color: var(--muted); }
  .p :global(.back) { padding: 0 14px; font-size: 13px; color: var(--muted); min-height: 32px; display: flex; align-items: center; }
  @media (min-width: 900px) { .p :global(.back) { padding-left: 0; } }
</style>
