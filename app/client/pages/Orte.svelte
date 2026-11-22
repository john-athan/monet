<script lang="ts">
  import type { PlaceOut } from "../../shared/types";
  import { api } from "../lib/api";
  import { num } from "../lib/format";
  import PageHead from "../components/PageHead.svelte";
  import Cover from "../components/Cover.svelte";
  import Loading from "../components/Loading.svelte";
  import Karte from "../components/Karte.svelte";
  let places = $state<PlaceOut[] | null>(null), error = $state("");
  $effect(() => { api<PlaceOut[]>("/api/places").then(r => (places = r)).catch(e => (error = e.message)); });
</script>
<div class="map"><Karte {places} /></div>
<PageHead title="Orte" room="--garten" sub={places ? `${num(places.length)} Orte` : ""} />
{#if error}<p class="m" role="alert">{error}</p>{:else if !places}<Loading />{:else if !places.length}<p class="m">Sobald Fotos einen Ort haben, erscheinen sie hier.</p>
{:else}<div class="g">{#each places as p (p.id)}<Cover href="/orte/{p.id}" name={p.name} n={p.count} cover={p.item} sub={p.country} />{/each}</div>{/if}
<style>
  .map { height: 55vh; min-height: 280px; padding: 12px 14px 0; box-sizing: border-box; }
  .g { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 12px; padding: 12px 14px 0; } .m { padding: 14px; color: var(--muted); }
  @media (min-width: 900px) { .map { height: 62vh; padding: 0; } .g { grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); padding: 8px 0 0; gap: 24px 16px; } }
</style>
