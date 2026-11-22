<script lang="ts">
  import type { AlbumDetail } from "../../shared/types";
  import { album } from "../lib/results.svelte";
  import { deleteAlbum } from "../lib/actions.svelte";
  import { loadLists } from "../lib/stores.svelte";
  import { toast, go, viewing } from "../lib/state.svelte";
  import { count } from "../lib/format";
  import PageHead from "../components/PageHead.svelte";
  import Grid from "../components/Grid.svelte";
  import Loading from "../components/Loading.svelte";
  import Link from "../components/Link.svelte";
  let { id }: { id: number } = $props();
  let a = $state<AlbumDetail | null>(null), error = $state("");
  // deleting asks once more; the photos stay in the library, only the album goes
  let asking = $state(false), busy = $state(false);
  $effect(() => { const my = id; a = null; error = ""; asking = false; album(my).then(r => { if (my === id) a = r; }).catch(e => (error = e.message)); });
  async function remove() {
    if (!a || busy) return; busy = true;
    try { await deleteAlbum(a.id); await loadLists(); toast(`Album „${a.name}“ gelöscht. Die Fotos bleiben.`); go("/alben", true); }
    catch (e: any) { toast(e.message); } finally { busy = false; asking = false; }
  }
</script>
<PageHead title={a?.name ?? "Album"} room="--atelier" sub={a ? count(a.items.length, "Foto", "Fotos") : ""}>
  {#if a && viewing() == null}
    <div class="acts">
      {#if asking}<button type="button" class="btn" onclick={() => (asking = false)}>Behalten</button><button type="button" class="btn danger" disabled={busy} onclick={remove}>Wirklich löschen</button>
      {:else}<button type="button" class="btn" onclick={() => (asking = true)}>Album löschen</button>{/if}
    </div>
  {/if}
</PageHead>
<div class="p">
  <Link href="/alben" class="back">Alle Alben</Link>
  {#if error}<p class="m" role="alert">{error}</p>{:else if !a}<Loading />{:else if !a.items.length}<p class="m">Das Album ist noch leer. Wähle Fotos in der Übersicht und tippe auf „Zum Album“.</p>{:else}<Grid items={a.items} />{/if}
</div>
<style>
  .p { display: flex; flex-direction: column; gap: 12px; } .m { padding: 14px; color: var(--muted); }
  .p :global(.back) { padding: 0 14px; font-size: 13px; color: var(--muted); min-height: 32px; display: flex; align-items: center; }
  @media (min-width: 900px) { .p :global(.back) { padding-left: 0; } }
  .acts { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
  .btn { height: 44px; padding: 0 14px; border: 0; border-radius: 22px; background: var(--surface-2); font-weight: 650; font-size: 14px; }
  .danger { background: var(--sun); color: var(--deep); font-weight: 700; }
</style>
