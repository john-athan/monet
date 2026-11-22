<script lang="ts">
  // Dinge: what the image model recognised across the library, most common first. A tile opens the search for it.
  import type { ThingOut } from "../../shared/types";
  import { api } from "../lib/api";
  import { num } from "../lib/format";
  import PageHead from "../components/PageHead.svelte";
  import Cover from "../components/Cover.svelte";
  import Loading from "../components/Loading.svelte";
  let things = $state<ThingOut[] | null>(null), error = $state("");
  $effect(() => { api<ThingOut[]>("/api/things").then(r => (things = r)).catch(e => (error = e.message)); });
</script>
<PageHead title="Dinge" room="--seerosen" sub={things ? `${num(things.length)} erkannt` : ""} />
{#if error}<p class="m" role="alert">{error}</p>{:else if !things}<Loading />{:else if !things.length}<p class="m">Sobald die Fotos analysiert sind, steht hier, was auf ihnen zu sehen ist.</p>
{:else}<div class="g">{#each things as t (t.label)}<Cover href="/suche?q={encodeURIComponent(t.label)}" name={t.label} n={t.count} cover={t.item} files={t.docs} doc={t.doc ?? null} />{/each}</div>{/if}
<style>
  .g { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 12px; padding: 12px 14px 0; } .m { padding: 14px; color: var(--muted); }
  @media (min-width: 900px) { .g { grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); padding: 8px 0 0; gap: 24px 16px; } }
</style>
