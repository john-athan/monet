<script lang="ts">
  // Drag files or folders anywhere on the window (desktop). On another person's library they go into that library.
  import { addFiles, filesFromDrop, dest } from "../lib/upload.svelte";
  import { viewing, member, genitive } from "../lib/state.svelte";
  const guest = $derived(viewing() != null ? member(viewing()) : undefined);
  let over = $state(false), depth = 0;
  const has = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
  $effect(() => {
    const enter = (e: DragEvent) => { if (!has(e)) return; e.preventDefault(); depth++; over = true; };
    const overf = (e: DragEvent) => { if (has(e)) e.preventDefault(); };
    const leave = (e: DragEvent) => { if (!has(e)) return; if (--depth <= 0) { depth = 0; over = false; } };
    const drop = async (e: DragEvent) => { if (!has(e)) return; e.preventDefault(); depth = 0; over = false; const of = viewing(); addFiles(await filesFromDrop(e.dataTransfer!), of); };
    addEventListener("dragenter", enter); addEventListener("dragover", overf); addEventListener("dragleave", leave); addEventListener("drop", drop);
    return () => { removeEventListener("dragenter", enter); removeEventListener("dragover", overf); removeEventListener("dragleave", leave); removeEventListener("drop", drop); };
  });
</script>
{#if over}
  <div class="drop" role="status"><p>{dest.name ? `Zum Ablegen in „${dest.name}“ hier loslassen` : guest ? `Zum Importieren in ${genitive(guest.name)} Fotos hier loslassen` : "Zum Importieren hier loslassen"}</p></div>
{/if}
<style>
  .drop { position: fixed; inset: 10px; z-index: 50; border-radius: 24px; background: var(--glass); box-shadow: inset 0 0 0 3px var(--sun); display: grid; place-items: center; pointer-events: none; backdrop-filter: blur(6px); }
  p { font-family: var(--font-display); font-size: 36px; max-width: 18em; padding: 0 24px; text-align: center; text-wrap: balance; }
</style>
