<script lang="ts">
  // What is said in a recording or a video (docs/together.md, "Transcripts"): the text in segments, each with its time.
  // A click on a segment plays from there (`onseek`, in seconds). Folded to its first lines until opened.
  import type { Transcript } from "../../shared/types";
  import { duration } from "../lib/format";
  let { transcript, onseek, compact = false, mark = "" }: { transcript: Transcript; onseek?: (sec: number) => void; compact?: boolean; mark?: string } = $props();
  let all = $state(false);
  const segs = $derived(transcript.segments);
  // the segments that hold the marked words: all of them shown, the first one scrolled to
  const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss").replace(/\s+/g, " ").trim();
  const hit = $derived(mark ? new Set(segs.filter(s => fold(s.t).includes(fold(mark))).map(s => s.s)) : new Set<number>());
  $effect(() => { if (hit.size) all = true; });
  let list: HTMLElement | undefined = $state();
  $effect(() => { if (!hit.size || !all || !list) return; requestAnimationFrame(() => list?.querySelector(".hit")?.scrollIntoView({ block: "center" })); });
  const shown = $derived(all || segs.length <= 6 ? segs : segs.slice(0, 6));
</script>
<section class="tr" class:compact aria-label="Gesprochen">
  <h3>Gesprochen</h3>
  {#if !segs.length}<p class="m">Darin wird nichts gesprochen.</p>
  {:else}
    <ol bind:this={list}>
      {#each shown as s (s.s)}
        <li class:hit={hit.has(s.s)}><button type="button" onclick={() => onseek?.(s.s / 1000)} disabled={!onseek}><span class="at tnum">{duration(s.s)}</span><span class="t">{s.t}</span></button></li>
      {/each}
    </ol>
    {#if segs.length > shown.length}<button type="button" class="more" onclick={() => (all = true)}>Alles zeigen</button>{/if}
  {/if}
</section>
<style>
  .tr { width: 100%; max-width: 620px; display: flex; flex-direction: column; gap: 6px; }
  h3 { font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
  ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  li button { width: 100%; display: grid; grid-template-columns: 52px minmax(0, 1fr); gap: 10px; padding: 7px 8px; border: 0; border-radius: 8px; background: transparent; color: var(--ink); text-align: left; font: inherit; font-size: 15px; line-height: 1.4; cursor: pointer; }
  li button:hover:not(:disabled) { background: var(--surface-2); }
  li button:disabled { cursor: default; }
  .hit button { background: rgb(255 214 0 / .3); }
  .at { color: var(--water); font-size: 13px; font-weight: 650; padding-top: 2px; }
  .compact li button { font-size: 14px; padding: 5px 6px; }
  .m { color: var(--muted); }
  .more { align-self: flex-start; min-height: 36px; padding: 0 14px; border: 0; border-radius: 18px; background: var(--surface-2); font: inherit; font-size: 14px; font-weight: 650; cursor: pointer; }
</style>
