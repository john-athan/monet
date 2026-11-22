<script lang="ts">
  // Ablage: one tree of folders holding files and photos. Folders first, then files, then photos; pick things to move or delete.
  import { untrack } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import type { FolderOut } from "../../shared/types";
  import { app, view, viewing, toast } from "../lib/state.svelte";
  import { gone, deleteItems } from "../lib/actions.svelte";
  import { dest } from "../lib/upload.svelte";
  import { coverUrl, createFolder, deleteDoc, deleteFolder, loadFolder, onUploaded, renameFolder, restoreDoc } from "../lib/files.svelte";
  import { count } from "../lib/format";
  import { stroke } from "../lib/motion";
  import PageHead from "../components/PageHead.svelte";
  import DocCard from "../components/DocCard.svelte";
  import FilePills from "../components/FilePills.svelte";
  import ImportSheet from "../components/ImportSheet.svelte";
  import MoveSheet from "../components/MoveSheet.svelte";
  import Pick from "../components/Pick.svelte";
  import Tile from "../components/Tile.svelte";
  import Pic from "../components/Pic.svelte";
  import Link from "../components/Link.svelte";
  import Icon from "../components/Icon.svelte";
  import Loading from "../components/Loading.svelte";
  let { id }: { id: number | null } = $props();

  let data = $state<FolderOut | null>(null), error = $state("");
  let seq = 0;
  async function load(at: number | null) {
    const my = ++seq;
    try { const f = await loadFolder(at); if (my === seq) { data = f; error = ""; } } catch (e: any) { if (my === seq) { data = null; error = e.message; } }
  }
  // a new folder starts empty; an upload that lands reloads in place
  $effect(() => { const at = id; data = null; error = ""; untrack(() => { end(); creating = false; }); load(at); });
  onUploaded(() => load(id));
  // drops and imports on this page go into this folder
  $effect(() => { dest.into = id; dest.name = id != null ? data?.name ?? "" : ""; return () => { dest.into = null; dest.name = ""; }; });

  const mine = $derived(viewing() == null);
  const items = $derived((data?.items ?? []).filter(i => !gone.has(i.id)));
  $effect(() => { view.ids = items.map(i => i.id); });
  const crumbs = $derived.by(() => {
    const p = data?.path ?? [];
    return id != null && data && p.at(-1)?.id !== id ? [...p, { id, name: data.name }] : p;
  });
  const sub = $derived(data ? [data.folders.length && count(data.folders.length, "Ordner", "Ordner"), data.docs.length && count(data.docs.length, "Datei", "Dateien"), items.length && count(items.length, "Foto", "Fotos")].filter(Boolean).join(", ") : "");

  // picking
  let picking = $state(false), importing = $state(false), moving = $state<null | { docs: number[]; items: number[]; folders: number[] }>(null), busy = $state(false);
  const pd = new SvelteSet<number>(), pf = new SvelteSet<number>(), pi = new SvelteSet<number>();
  const n = $derived(pd.size + pf.size + pi.size);
  const flip = (s: SvelteSet<number>, k: number) => { s.has(k) ? s.delete(k) : s.add(k); };
  function end() { picking = false; pd.clear(); pf.clear(); pi.clear(); renaming = null; }
  $effect(() => {
    if (!picking) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector("[aria-modal='true']")) end(); };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  });

  // new folder and rename, inline
  let creating = $state(false), name = $state(""), renaming = $state<number | null>(null), rename = $state("");
  const focus = (el: HTMLInputElement) => { el.focus(); el.select(); };
  async function make(e: Event) {
    e.preventDefault(); const v = name.trim(); if (!v || busy) return; busy = true;
    try { await createFolder(v, id); name = ""; creating = false; await load(id); } catch (err: any) { toast(err.message); } finally { busy = false; }
  }
  async function rn(e: Event, fid: number) {
    e.preventDefault(); const v = rename.trim(); if (!v || busy) return; busy = true;
    try { await renameFolder(fid, v); end(); await load(id); } catch (err: any) { toast(err.message); } finally { busy = false; }
  }
  function startRename() { const f = data?.folders.find(x => pf.has(x.id)); if (f) { renaming = f.id; rename = f.name; } }

  async function remove() {
    if (busy || !n) return; busy = true;
    const docs = [...pd], folders = [...pf], photos = [...pi];
    let bad = "";
    try {
      // a folder goes only when it is empty: the server says so otherwise
      for (const f of folders) { try { await deleteFolder(f); } catch (e: any) { bad = e.message; } }
      const r = await Promise.allSettled(docs.map(deleteDoc));
      const gonedocs = docs.filter((_, i) => r[i].status === "fulfilled");
      if (gonedocs.length < docs.length) bad ||= "Eine Datei konnte nicht gelöscht werden.";
      end(); await load(id);
      if (bad) toast(bad);
      else if (gonedocs.length && !photos.length) toast(gonedocs.length === 1 ? "Datei gelöscht" : `${gonedocs.length} Dateien gelöscht`, { ms: 6000, action: { label: "Rückgängig", run: () => { Promise.all(gonedocs.map(restoreDoc)).then(() => load(id)).catch(e => toast(e.message)); } } });
      if (photos.length) deleteItems(photos);
    } finally { busy = false; }
  }
</script>
<FilePills />
<PageHead title={id == null ? "Ablage" : data?.name ?? "Ordner"} room="--water" {sub}>
  {#if data}
    <div class="acts">
      {#if !app.wide}<button type="button" class="btn ic" aria-label="Importieren" title="Importieren" onclick={() => (importing = true)}><Icon name="cloud" size={20} sw={1.9} /></button>{/if}
      {#if mine}
        <button type="button" class="btn" class:ic={!app.wide} aria-label="Neuer Ordner" title="Neuer Ordner" onclick={() => { end(); creating = !creating; }}><Icon name="ordner-neu" size={app.wide ? 18 : 20} sw={1.9} />{#if app.wide}Neuer Ordner{/if}</button>
        <button type="button" class="btn" onclick={() => (picking ? end() : (picking = true))}>{picking ? "Fertig" : "Auswählen"}</button>
      {/if}
    </div>
  {/if}
</PageHead>
<nav class="crumbs" aria-label="Pfad">
  {#if crumbs.length}<Link href="/ablage">Ablage</Link>{:else}<span aria-current="page">Ablage</span>{/if}
  {#each crumbs as c, i (c.id)}
    <Icon name="chevron" size={12} sw={2.2} />
    {#if i === crumbs.length - 1}<span aria-current="page">{c.name}</span>{:else}<Link href="/ablage/{c.id}">{c.name}</Link>{/if}
  {/each}
</nav>
{#if error}<p class="m" role="alert">{error}</p>
{:else if !data}<Loading text="Die Ablage kommt" />
{:else}
  {#if creating || data.folders.length}
    <section aria-label="Ordner">
      <h2>Ordner</h2>
      <div class="fgrid">
        {#if creating}
          <form class="folder new" onsubmit={make}>
            <input type="text" bind:value={name} maxlength="120" placeholder="Name des Ordners" aria-label="Name des neuen Ordners" {@attach focus} onkeydown={e => { if (e.key === "Escape") { e.stopPropagation(); creating = false; } }} />
            <span class="row"><button type="submit" class="go" disabled={busy || !name.trim()}>Anlegen</button><button type="button" class="ghost" onclick={() => (creating = false)}>Abbrechen</button></span>
          </form>
        {/if}
        {#each data.folders as f (f.id)}
          <div class="folder" class:on={pf.has(f.id)}>
            {#if renaming === f.id}
              <form class="ren" onsubmit={e => rn(e, f.id)}>
                <input type="text" bind:value={rename} maxlength="120" aria-label="Neuer Name des Ordners" {@attach focus} onkeydown={e => { if (e.key === "Escape") { e.stopPropagation(); renaming = null; } }} />
                <span class="row"><button type="submit" class="go" disabled={busy || !rename.trim()}>Speichern</button><button type="button" class="ghost" onclick={() => (renaming = null)}>Abbrechen</button></span>
              </form>
            {:else}
              <Link href="/ablage/{f.id}" class="fa" aria-label="Ordner {f.name}, {count(f.count, 'Eintrag', 'Einträge')}">
                <span class="peek" data-n={Math.min(f.peek.length, 4)}>
                  {#each f.peek.slice(0, 4) as p}
                    <span class="cell">{#if "doc" in p}<img src={coverUrl(p.doc)} alt="" loading="lazy" decoding="async" onerror={e => (e.currentTarget.style.visibility = "hidden")} />{:else}<Pic id={p.item} w={1} h={1} square sizes="120px" />{/if}</span>
                  {:else}<Icon name="ordner" size={40} sw={1.5} />{/each}
                </span>
                <span class="n">{f.name}</span>
                <span class="c tnum">{count(f.count, "Eintrag", "Einträge")}</span>
              </Link>
              {#if picking}<Pick on={pf.has(f.id)} ontoggle={() => flip(pf, f.id)} label="Ordner {f.name}" />{/if}
            {/if}
          </div>
        {/each}
      </div>
    </section>
  {/if}
  {#if data.docs.length}
    <section aria-label="Dateien">
      <h2>Dateien</h2>
      <div class="grid">{#each data.docs as d (d.id)}<DocCard doc={d} selectable={picking} selected={pd.has(d.id)} ontoggle={() => flip(pd, d.id)} />{/each}</div>
    </section>
  {/if}
  {#if items.length}
    <section aria-label="Fotos">
      <h2>Fotos</h2>
      <div class="pgrid">
        {#each items as it, k (it.id)}
          <div class="ph"><Tile item={it} square mark={false} sizes="(min-width: 900px) 160px, 33vw" first={k < 6} />{#if picking}<Pick on={pi.has(it.id)} ontoggle={() => flip(pi, it.id)} label="Foto" />{/if}</div>
        {/each}
      </div>
    </section>
  {/if}
  {#if !creating && !data.folders.length && !data.docs.length && !items.length}
    <p class="m">{id == null ? "Die Ablage ist noch leer." : "Dieser Ordner ist leer."} Lege einen Ordner an{app.wide ? ", ziehe Dateien in das Fenster" : ""} oder wähle „Importieren“.</p>
  {/if}
{/if}
{#if picking}
  <div role="toolbar" aria-label="Auswahl" in:stroke out:stroke={{ duration: 200 }}>
    <span class="cnt tnum" aria-live="polite">{n} ausgewählt</span>
    <button type="button" disabled={!n} onclick={() => (moving = { docs: [...pd], items: [...pi], folders: [...pf] })}><Icon name="verschieben" size={18} sw={1.9} />Verschieben</button>
    {#if pf.size === 1 && !pd.size && !pi.size}<button type="button" onclick={startRename}><Icon name="dokumente" size={18} sw={1.9} />Umbenennen</button>{/if}
    <button type="button" disabled={!n || busy} onclick={remove}><Icon name="papierkorb" size={18} sw={1.9} />Löschen</button>
    <button type="button" class="x" aria-label="Auswahl beenden" onclick={end}><Icon name="x" size={16} sw={2.2} /></button>
  </div>
{/if}
{#if moving}<MoveSheet {...moving} onclose={() => (moving = null)} ondone={() => { end(); load(id); }} />{/if}
<ImportSheet bind:open={importing} />
<style>
  .acts { display: flex; gap: 8px; justify-content: flex-end; flex: none; }
  .btn.ic { width: 44px; padding: 0; justify-content: center; }
  .btn { height: 44px; padding: 0 14px; border: 0; border-radius: 22px; background: var(--surface-2); font-weight: 650; font-size: 14px; display: inline-flex; align-items: center; gap: 7px; }
  .btn:hover { background: var(--surface-3); }
  .crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; padding: 0 18px; min-height: 32px; font-size: 14px; color: var(--muted); }
  .crumbs :global(a) { color: var(--muted); } .crumbs :global(a:hover) { color: var(--ink); text-decoration: underline; text-underline-offset: 3px; }
  .crumbs [aria-current] { color: var(--ink); font-weight: 650; }
  h2 { font-size: 24px; padding: 18px 14px 8px; } .m { padding: 18px 14px; color: var(--muted); }
  .fgrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 12px; padding: 0 14px; align-items: start; }
  .folder { position: relative; min-width: 0; border-radius: 16px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--rule); }
  .folder :global(.fa) { display: flex; flex-direction: column; gap: 2px; padding: 8px 8px 10px; min-width: 0; }
  .folder:hover .peek { filter: brightness(1.05) saturate(1.05); }
  .peek { display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: 1fr; gap: 2px; aspect-ratio: 4 / 3; margin-bottom: 6px; border-radius: 10px; overflow: hidden; background: var(--surface-2); color: var(--muted); place-items: center; }
  .peek[data-n="0"] { display: flex; justify-content: center; align-items: center; }
  .peek[data-n="1"] > .cell { grid-column: 1 / -1; grid-row: 1 / -1; }
  .peek[data-n="2"] > .cell, .peek[data-n="3"] > .cell:first-child { grid-row: 1 / -1; }
  .cell { display: block; width: 100%; height: 100%; min-height: 0; overflow: hidden; } .cell img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .n { font-family: var(--font-display); font-size: 20px; line-height: 1.15; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .c { font-size: 12.5px; color: var(--muted); }
  .new, .ren { display: flex; flex-direction: column; gap: 8px; padding: 12px; }
  input { height: 44px; padding: 0 12px; border: 0; border-radius: 10px; background: var(--surface-2); font-size: 16px; min-width: 0; }
  input:focus { box-shadow: inset 0 0 0 1.5px var(--water); }
  .row { display: flex; gap: 6px; flex-wrap: wrap; }
  .go { height: 40px; padding: 0 16px; border: 0; border-radius: 20px; background: var(--ink); color: var(--on-ink); font-weight: 650; } .go:disabled { opacity: .45; }
  .ghost { height: 40px; padding: 0 12px; border: 0; border-radius: 20px; background: transparent; color: var(--muted); font-weight: 600; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 12px; padding: 0 14px; align-items: start; }
  .pgrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 3px; padding: 0 14px; }
  .ph { position: relative; aspect-ratio: 1; overflow: hidden; border-radius: 4px; }
  [role=toolbar] { position: fixed; z-index: 25; left: 50%; bottom: 28px; transform: translateX(-50%); display: flex; align-items: center; gap: 4px; padding: 6px 6px 6px 20px; border-radius: 28px; background: var(--ink); color: var(--on-ink); box-shadow: var(--shadow); white-space: nowrap; max-width: calc(100vw - 16px); overflow-x: auto; }
  .cnt { font-weight: 700; padding-right: 10px; }
  [role=toolbar] button { height: 44px; padding: 0 14px; border: 0; border-radius: 22px; background: transparent; color: var(--on-ink); font-weight: 600; display: inline-flex; align-items: center; gap: 7px; }
  [role=toolbar] button:hover:not(:disabled) { background: rgb(255 255 255 / .12); } [role=toolbar] button:disabled { opacity: .45; }
  [role=toolbar] button.x { width: 44px; padding: 0; justify-content: center; }
  @media (max-width: 899px) {
    [role=toolbar] { bottom: calc(env(safe-area-inset-bottom) + 96px); padding-left: 14px; }
    [role=toolbar] button { padding: 0 10px; font-size: 0; gap: 0; width: 44px; justify-content: center; }
  }
  @media (min-width: 900px) {
    .crumbs, h2, .fgrid, .grid, .pgrid, .m { padding-left: 0; padding-right: 0; }
    .fgrid { grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 16px; }
    .grid { grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 24px 16px; }
    .pgrid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 4px; }
  }
</style>
