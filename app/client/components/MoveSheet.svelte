<script lang="ts">
  // Move files, photos and folders into a folder of the Ablage: browse the tree from the top, make a folder on the way.
  import type { FolderOut } from "../../shared/types";
  import { toast } from "../lib/state.svelte";
  import { createFolder, loadFolder, moveTo } from "../lib/files.svelte";
  import { count } from "../lib/format";
  import Sheet from "./Sheet.svelte";
  import Icon from "./Icon.svelte";
  let { docs = [], items = [], folders = [], onclose, ondone }: { docs?: number[]; items?: number[]; folders?: number[]; onclose: () => void; ondone?: () => void } = $props();
  let open = $state(true), at = $state<number | null>(null), here = $state<FolderOut | null>(null), error = $state(""), busy = $state(false);
  let adding = $state(false), name = $state("");
  const n = $derived(docs.length + items.length + folders.length);
  // a folder cannot go into itself: the ones being moved are not offered, so nothing below them can be reached either
  const subs = $derived((here?.folders ?? []).filter(f => !folders.includes(f.id)));
  let seq = 0;
  async function show(id: number | null) {
    const my = ++seq; error = ""; adding = false; name = "";
    try { const f = await loadFolder(id); if (my === seq) { here = f; at = id; } } catch (e: any) { if (my === seq) error = e.message; }
  }
  $effect(() => { show(null); });
  // the sheet leaves first, then the owner drops it
  $effect(() => { if (!open) { const t = setTimeout(onclose, 280); return () => clearTimeout(t); } });
  const crumbs = $derived(here?.path ?? []);
  async function make(e: Event) {
    e.preventDefault(); const v = name.trim(); if (!v || busy) return; busy = true;
    try { const f = await createFolder(v, at); await show(f.id); } catch (err: any) { toast(err.message); } finally { busy = false; }
  }
  async function put() {
    if (busy) return; busy = true;
    try {
      await moveTo(at, { docs: docs.length ? docs : undefined, items: items.length ? items : undefined, folders: folders.length ? folders : undefined });
      toast(`${n === 1 ? "Verschoben" : `${count(n, "Eintrag", "Einträge")} verschoben`} nach „${here?.name || "Ablage"}“`);
      ondone?.(); open = false;
    } catch (e: any) { toast(e.message); } finally { busy = false; }
  }
</script>
<Sheet bind:open label="Verschieben">
  <h2>Verschieben</h2>
  <nav class="crumbs" aria-label="Ort">
    <button type="button" aria-current={at == null ? "true" : undefined} onclick={() => show(null)}>Ablage</button>
    {#each crumbs as c (c.id)}<Icon name="chevron" size={12} sw={2.2} /><button type="button" aria-current={c.id === at ? "true" : undefined} onclick={() => show(c.id)}>{c.name}</button>{/each}
  </nav>
  {#if error}<p class="m" role="alert">{error}</p>{:else if !here}<p class="m" role="status">Einen Moment</p>
  {:else}
    <ul>
      {#each subs as f (f.id)}
        <li><button type="button" onclick={() => show(f.id)}><Icon name="ordner" size={22} /><span class="n">{f.name}</span><Icon name="chevron" size={16} sw={2} /></button></li>
      {/each}
      {#if !subs.length}<li class="m">Hier gibt es keine Ordner.</li>{/if}
    </ul>
  {/if}
  {#if adding}
    <form onsubmit={make}>
      <input type="text" bind:value={name} maxlength="120" placeholder="Name des Ordners" aria-label="Name des neuen Ordners" />
      <button type="submit" class="go" disabled={busy || !name.trim()}>Anlegen</button>
    </form>
  {:else}
    <button type="button" class="sec" disabled={!here} onclick={() => (adding = true)}><Icon name="ordner-neu" size={18} sw={1.9} />Neuer Ordner</button>
  {/if}
  <button type="button" class="pri" disabled={busy || !here || !n} onclick={put}><Icon name="verschieben" size={18} sw={1.9} />Hierher verschieben</button>
</Sheet>
<style>
  h2 { font-size: 28px; line-height: 1.05; }
  .crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 4px; color: var(--muted); }
  .crumbs button { min-height: 32px; padding: 0 8px; border: 0; border-radius: 8px; background: transparent; font-size: 14px; font-weight: 600; color: var(--muted); }
  .crumbs button:hover { background: var(--surface-2); color: var(--ink); } .crumbs button[aria-current] { color: var(--ink); }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; min-height: 60px; }
  li button { width: 100%; display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 6px 8px; border: 0; border-radius: 12px; background: transparent; text-align: left; color: var(--ink); }
  li button:hover { background: var(--surface-2); } li button :global(svg:last-child) { color: var(--muted); }
  .n { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  .m { color: var(--muted); font-size: 14px; padding: 6px 8px; margin: 0; }
  form { display: flex; gap: 8px; }
  input { flex: 1; min-width: 0; height: 46px; padding: 0 14px; border: 0; border-radius: 12px; background: var(--surface-2); font-size: 16px; }
  .go { height: 46px; padding: 0 18px; border: 0; border-radius: 23px; background: var(--ink); color: var(--on-ink); font-weight: 650; } .go:disabled { opacity: .45; }
  .pri, .sec { min-height: 48px; padding: 0 18px; border: 0; border-radius: 24px; display: inline-flex; align-items: center; justify-content: center; gap: 9px; font-weight: 650; }
  .pri { background: var(--ink); color: var(--on-ink); } .pri:hover:not(:disabled) { background: var(--water); } .pri:disabled { opacity: .45; }
  .sec { background: transparent; box-shadow: inset 0 0 0 1.5px var(--rule); color: var(--ink); } .sec:hover:not(:disabled) { background: var(--surface-2); }
</style>
