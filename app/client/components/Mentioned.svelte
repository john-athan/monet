<script lang="ts">
  // The files that name a person or a place (docs/together.md, "Links"): a strip under the page's title.
  import type { DocSummary } from "../../shared/types";
  import { api } from "../lib/api";
  import { count } from "../lib/format";
  import DocCard from "./DocCard.svelte";
  // name: what the file says, so the viewer opens where it says it
  let { kind, id, name = "" }: { kind: "person" | "place"; id: number; name?: string } = $props();
  let docs = $state<DocSummary[]>([]);
  $effect(() => { const my = id; docs = []; api<DocSummary[]>(`/api/links?${kind}=${my}`).then(r => { if (my === id) docs = r; }).catch(() => {}); });
</script>
{#if docs.length}
  <section class="men" aria-label="Erwähnt in">
    <h2>Erwähnt in <span class="tnum n">{count(docs.length, "Datei", "Dateien")}</span></h2>
    <div class="strip">{#each docs as d (d.id)}<div class="dc"><DocCard doc={d} find={name} /></div>{/each}</div>
  </section>
{/if}
<style>
  .men { padding: 4px 0 10px; }
  h2 { font-size: 20px; padding: 10px 14px 8px; display: flex; align-items: baseline; gap: 10px; }
  .n { font-family: var(--font-body); font-size: 13px; color: var(--muted); font-weight: 600; }
  .strip { display: flex; gap: 12px; overflow-x: auto; padding: 0 14px 6px; scroll-snap-type: x proximity; }
  .dc { flex: none; width: 132px; scroll-snap-align: start; }
  @media (min-width: 900px) { h2, .strip { padding-left: 0; padding-right: 0; } .dc { width: 150px; } }
</style>
