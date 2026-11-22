<script lang="ts">
  // Phone: the six file pages as a row of pills on top of each of them (Ordner is the Ablage). The row scrolls sideways.
  import { app, local } from "../lib/state.svelte";
  import { FILES, fileOf } from "../lib/nav";
  import Link from "./Link.svelte";
  const cur = $derived(fileOf(local()));
  // short words on the pills; the current one scrolls into view when the row is wider than the screen
  const NAMES: Record<string, string> = { ablage: "Ordner", praesentationen: "Folien" };
  const seen = (el: HTMLElement) => { const on = el.querySelector<HTMLElement>("[aria-current]"); if (on) el.scrollLeft = Math.max(0, on.offsetLeft - (el.clientWidth - on.offsetWidth) / 2); };
</script>
{#if !app.wide}
  <div class="pills" role="list" aria-label="Dateien" use:seen>
    {#each FILES as f (f.key)}
      <span role="listitem"><Link href={f.path} class="pl" aria-current={f.key === cur ? "page" : undefined}>{NAMES[f.key] ?? f.label}</Link></span>
    {/each}
  </div>
{/if}
<style>
  .pills { position: relative; display: flex; gap: 6px; padding: 14px 18px 0; overflow-x: auto; scrollbar-width: none; } .pills::-webkit-scrollbar { display: none; }
  .pills > span { flex: 1 0 auto; } .pills :global(.pl) { justify-content: center; }
  .pills :global(.pl) { min-height: 36px; display: inline-flex; align-items: center; padding: 0 12px; border-radius: 18px; background: var(--surface-2); color: var(--muted); font-size: 14px; font-weight: 650; white-space: nowrap; }
  .pills :global(.pl[aria-current]) { background: var(--ink); color: var(--on-ink); }
</style>
