<script lang="ts">
  // Pick an album for the chosen photos, or make a new one.
  import { lists, loadLists } from "../lib/stores.svelte";
  import { addToAlbum, createAlbum } from "../lib/actions.svelte";
  import { toast, selectEnd } from "../lib/state.svelte";
  import { count } from "../lib/format";
  import Sheet from "./Sheet.svelte";
  import Pic from "./Pic.svelte";
  import { tick } from "svelte";
  import { takeoff, fly } from "../lib/motion";
  let { open = $bindable(false), ids }: { open: boolean; ids: number[] } = $props();
  let name = $state(""), busy = $state(false);
  async function put(albumId: number, label: string) {
    busy = true;
    const flight = takeoff(ids); // where the pictures are now, before the selection ends
    try { await addToAlbum(albumId, ids); toast(`${count(ids.length, "Foto", "Fotos")} in „${label}“`); selectEnd(); open = false; await loadLists(); await tick(); fly(flight, albumId); }
    catch (e: any) { toast(e.message); } finally { busy = false; }
  }
  async function make(e: Event) {
    e.preventDefault(); const n = name.trim(); if (!n) return;
    busy = true;
    try { const a = await createAlbum(n); name = ""; await put(a.id, n); } catch (err: any) { toast(err.message); busy = false; }
  }
</script>
<Sheet bind:open label="Zum Album hinzufügen">
  <h2>Zum Album</h2>
  <form onsubmit={make}>
    <input type="text" bind:value={name} placeholder="Neues Album, z. B. Italien 2023" aria-label="Name des neuen Albums" />
    <button type="submit" disabled={busy || !name.trim()}>Anlegen</button>
  </form>
  <ul>
    {#each lists.albums as a (a.id)}
      <li><button type="button" disabled={busy} onclick={() => put(a.id, a.name)}>
        <span class="c">{#if a.cover}<Pic id={a.cover} w={1} h={1} square sizes="44px" />{/if}</span>
        <span class="n"><b>{a.name}</b><span class="tnum">{count(a.count, "Foto", "Fotos")}</span></span>
      </button></li>
    {/each}
  </ul>
</Sheet>
<style>
  h2 { font-size: 28px; line-height: 1.05; }
  form { display: flex; gap: 8px; }
  input { flex: 1; min-width: 0; height: 46px; padding: 0 14px; border: 0; border-radius: 12px; background: var(--surface-2); font-size: 16px; }
  form button { height: 46px; padding: 0 18px; border: 0; border-radius: 23px; background: var(--ink); color: var(--on-ink); font-weight: 650; }
  form button:disabled { opacity: .45; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  li button { width: 100%; display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 6px 8px; border: 0; border-radius: 14px; background: transparent; text-align: left; }
  li button:hover { background: var(--surface-2); }
  .c { width: 44px; height: 44px; border-radius: 8px; overflow: hidden; background: var(--surface-2); flex: none; }
  .n { display: flex; flex-direction: column; line-height: 1.25; } .n b { font-weight: 650; } .n span { font-size: 13px; color: var(--muted); }
</style>
