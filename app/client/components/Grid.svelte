<script lang="ts">
  // A set of photos: three squares across on the phone, justified rows on the desktop.
  import type { ItemSummary } from "../../shared/types";
  import { app, view } from "../lib/state.svelte";
  import { gone } from "../lib/actions.svelte";
  import { justify } from "../lib/layout";
  import Tile from "./Tile.svelte";
  let { items }: { items: ItemSummary[] } = $props();
  let w = $state(0);
  const list = $derived(items.filter(i => !gone.has(i.id)));
  $effect(() => { view.ids = list.map(i => i.id); });
  const rows = $derived(app.wide && w ? justify(list, w) : []);
</script>
<div class="g" bind:clientWidth={w} data-grid>
  {#if app.wide}
    {#each rows as r}<div class="row" style="height:{r.h}px">{#each r.tiles as t (list[t.i].id)}<div style="width:{t.w}px;height:{r.h}px"><Tile item={list[t.i]} sizes="{Math.round(t.w)}px" /></div>{/each}</div>{/each}
  {:else}
    <div class="grid">{#each list as it, k (it.id)}<div><Tile item={it} square sizes="34vw" first={k < 6} /></div>{/each}</div>
  {/if}
</div>
<style>
  .g { display: flex; flex-direction: column; gap: 4px; }
  .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 2px; width: 100%; }
  .grid > div { aspect-ratio: 1; min-width: 0; }
  .row { display: flex; gap: 4px; } .row > div { flex: none; }
</style>
