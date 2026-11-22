<script lang="ts">
  // The floating ink bar while photos are picked.
  import { sel, selectEnd, viewing } from "../lib/state.svelte";
  import { deleteItems, download, share } from "../lib/actions.svelte";
  import { num } from "../lib/format";
  import Icon from "./Icon.svelte";
  import AlbumSheet from "./AlbumSheet.svelte";
  import { stroke } from "../lib/motion";
  let album = $state(false);
  const ids = $derived([...sel.ids]);
  $effect(() => {
    if (!sel.on) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector("[aria-modal='true']")) selectEnd(); };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  });
</script>
{#if sel.on}
  <div role="toolbar" aria-label="Auswahl" in:stroke out:stroke={{ duration: 200 }}>
    <span class="n tnum" aria-live="polite">{num(ids.length)} ausgewählt</span>
    <button type="button" disabled={!ids.length} onclick={() => share(ids)}><Icon name="teilen" size={18} sw={1.9} />Teilen</button>
    <!-- in another person's library only what does not change it -->
    {#if viewing() == null}<button type="button" disabled={!ids.length} onclick={() => (album = true)}><Icon name="album" size={18} sw={1.9} />Zum Album</button>{/if}
    <button type="button" disabled={!ids.length} onclick={() => download(ids)}><Icon name="laden" size={18} sw={1.9} />Herunterladen</button>
    {#if viewing() == null}<button type="button" disabled={!ids.length} onclick={() => deleteItems(ids)}><Icon name="papierkorb" size={18} sw={1.9} />Löschen</button>{/if}
    <button type="button" class="x" aria-label="Auswahl beenden" onclick={selectEnd}><Icon name="x" size={16} sw={2.2} /></button>
  </div>
{/if}
<AlbumSheet bind:open={album} {ids} />
<style>
  [role=toolbar] { position: fixed; z-index: 25; left: 50%; bottom: 28px; transform: translateX(-50%); display: flex; align-items: center; gap: 4px; padding: 6px 6px 6px 20px; border-radius: 28px; background: var(--ink); color: var(--on-ink); box-shadow: var(--shadow); white-space: nowrap; max-width: calc(100vw - 16px); overflow-x: auto; }
  .n { font-weight: 700; padding-right: 10px; }
  button { height: 44px; padding: 0 14px; border: 0; border-radius: 22px; background: transparent; color: var(--on-ink); font-weight: 600; display: inline-flex; align-items: center; gap: 7px; }
  button:hover:not(:disabled) { background: rgb(255 255 255 / .12); }
  button:disabled { opacity: .45; }
  button.x { width: 44px; padding: 0; justify-content: center; }
  @media (max-width: 899px) {
    [role=toolbar] { bottom: calc(env(safe-area-inset-bottom) + 96px); padding-left: 14px; }
    button { padding: 0 10px; font-size: 0; gap: 0; width: 44px; justify-content: center; } /* icons only: the labels stay in the accessibility tree through the buttons' text */
    button.x { width: 44px; }
  }
</style>
