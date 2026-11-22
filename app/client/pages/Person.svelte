<script lang="ts">
  import { onMount } from "svelte";
  import type { ItemSummary } from "../../shared/types";
  import { people, loadPeople, loadLists } from "../lib/stores.svelte";
  import { post } from "../lib/api";
  import { toast, go } from "../lib/state.svelte";
  import { byChip } from "../lib/results.svelte";
  import { count } from "../lib/format";
  import PageHead from "../components/PageHead.svelte";
  import Grid from "../components/Grid.svelte";
  import Loading from "../components/Loading.svelte";
  import Link from "../components/Link.svelte";
  import SameName, { namesakes } from "../components/SameName.svelte";
  let { id }: { id: number } = $props();
  let items = $state<ItemSummary[] | null>(null), editing = $state(false), name = $state("");
  // merging: this person's faces go to the one picked here, and the page moves there (this person is gone afterwards)
  let merging = $state(false), target = $state<number | null>(null), busy = $state(false);
  const others = $derived(people.p?.named.filter(n => n.id !== id) ?? []);
  const into = $derived(others.find(n => n.id === target) ?? null);
  const named = $derived(people.p?.named.find(n => n.id === id) ?? null);
  const unnamed = $derived(people.p?.unnamed.find(n => n.id === id) ?? null);
  const label = $derived(named?.name ?? "Unbekannte Person");
  onMount(() => { loadPeople(true); });
  $effect(() => { const my = id; items = null; byChip({ kind: "person", label: "Person", value: String(my) }).then(r => { if (my === id) items = r; }).catch(e => toast(e.message)); });
  // a name someone else already has asks first, as on the Personen page
  let asking = $state<string | null>(null);
  const matches = $derived(asking ? namesakes(people.p?.named ?? [], asking, id) : []);
  function rename(e: Event) {
    e.preventDefault(); const n = name.trim(); if (!n) return;
    if (n !== named?.name && namesakes(people.p?.named ?? [], n, id).length) { asking = n; return; }
    save(n);
  }
  async function save(n: string) {
    asking = null;
    try { await post(`/api/people/${id}`, { name: n }); editing = false; await loadPeople(true); loadLists(); toast(`Umbenannt in ${n}.`); } catch (err: any) { toast(err.message); }
  }
  async function merge(to = into) {
    if (!to || busy) return; asking = null;
    busy = true;
    try {
      await post("/api/people/merge", { from: id, into: to.id });
      merging = false; target = null; await loadPeople(true); loadLists();
      toast(`Mit ${to.name} zusammengeführt.`); go(`/personen/${to.id}`, true);
    } catch (err: any) { toast(err.message); } finally { busy = false; }
  }
  import Mentioned from "../components/Mentioned.svelte";
</script>
<PageHead title={label} room="--esszimmer" sub={items ? count(items.length, "Foto", "Fotos") : ""}>
  <div class="acts">
  <button type="button" class="btn" onclick={() => { editing = !editing; merging = false; name = named?.name ?? ""; }}>{named ? "Umbenennen" : "Benennen"}</button>
  {#if others.length}<button type="button" class="btn" aria-expanded={merging} onclick={() => { merging = !merging; editing = false; target = null; }}>Zusammenführen</button>{/if}
  </div>
</PageHead>
<div class="p">
  <Link href="/personen" class="back">Alle Personen</Link>
  {#if editing}
    <form onsubmit={rename}><input type="text" bind:value={name} oninput={() => (asking = null)} placeholder="Name" aria-label="Name" autocomplete="off" /><button type="submit" disabled={!name.trim()}>Speichern</button></form>
    {#if asking && matches.length}<div class="sn"><SameName name={asking} {matches} {busy} onmerge={n => merge(n)} onnew={() => save(asking!)} /></div>{/if}
  {/if}
  {#if merging}
    <section class="mg" aria-label="Zusammenführen">
      <p class="m0">Zu wem gehören diese Fotos?</p>
      <div class="pick">
        {#each others as n (n.id)}
          <button type="button" class="who" aria-pressed={target === n.id} onclick={() => (target = n.id)}>
            {#if n.face}<img src="/media/face/{n.face}" alt="" width="64" height="64" />{:else}<span class="ph"></span>{/if}
            <b>{n.name}</b><span class="tnum">{count(n.count, "Foto", "Fotos")}</span>
          </button>
        {/each}
      </div>
      {#if into}<button type="button" class="ink" disabled={busy} onclick={() => merge()}>Mit {into.name} zusammenführen</button>{/if}
    </section>
  {/if}
  <Mentioned kind="person" {id} name={named?.name ?? ""} />
  {#if !items}<Loading />{:else if !items.length}<p class="m">Hier ist noch kein Foto.</p>{:else}<Grid {items} />{/if}
</div>
<style>
  .p { padding: 0 0 8px; display: flex; flex-direction: column; gap: 12px; } .m { padding: 14px; color: var(--muted); }
  .p :global(.back) { padding: 0 14px; font-size: 13px; color: var(--muted); min-height: 32px; display: flex; align-items: center; }
  .acts { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
  .btn { height: 44px; padding: 0 14px; border: 0; border-radius: 22px; background: var(--surface-2); font-weight: 650; font-size: 14px; }
  form { display: flex; gap: 8px; padding: 0 14px; }
  input { flex: 1; min-width: 0; height: 46px; padding: 0 14px; border: 0; border-radius: 12px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--ess-rule); font-size: 16px; }
  form button { height: 46px; padding: 0 18px; border: 0; border-radius: 23px; background: var(--ink); color: var(--on-ink); font-weight: 650; } form button:disabled { opacity: .5; }
  .sn { padding: 0 14px; }
  .mg { display: flex; flex-direction: column; gap: 10px; padding: 0 14px; } .m0 { color: var(--muted); font-size: 14px; }
  .pick { display: flex; gap: 6px; overflow-x: auto; padding: 4px 0; }
  .who { flex: none; width: 96px; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 8px 4px; border: 0; border-radius: 16px; background: transparent; font-size: 13px; }
  .who img, .who .ph { width: 64px; height: 64px; border-radius: 50%; object-fit: cover; background: var(--surface-2); }
  .who span { color: var(--muted); font-size: 12px; } .who b { font-weight: 650; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .who:hover { background: var(--surface); } .who[aria-pressed="true"] { background: var(--surface-2); box-shadow: inset 0 0 0 2px var(--ink); }
  .ink { align-self: flex-start; height: 46px; padding: 0 18px; border: 0; border-radius: 23px; background: var(--ink); color: var(--on-ink); font-weight: 650; } .ink:disabled { opacity: .5; }
  @media (min-width: 900px) { .p :global(.back), form, .mg, .sn { padding-left: 0; } }
</style>
