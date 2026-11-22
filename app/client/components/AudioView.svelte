<script lang="ts">
  // One track in the viewer: cover, tags and the buttons that hand it to the global player (components/PlayerBar.svelte).
  import type { DocDetail, DocSummary } from "../../shared/types";
  import { toast } from "../lib/state.svelte";
  import { albumOf } from "../lib/files.svelte";
  import { duration } from "../lib/format";
  import { player, isCurrent, play, toggle, seek } from "../lib/player.svelte";
  import TranscriptView from "./TranscriptView.svelte";
  import CoverArt from "./CoverArt.svelte";
  import Icon from "./Icon.svelte";
  // mark: words to find in the transcript (a mention, a search hit), shown and scrolled to
  let { detail, mark = "" }: { detail: DocDetail; mark?: string } = $props();
  const me = $derived(detail as DocSummary);
  const here = $derived(isCurrent(detail.id));
  const going = $derived(here && player.playing);
  let busy = $state(false);
  /** plays this track from `sec`: starts it first when another one (or none) is playing, then waits for its length */
  async function from(sec: number) {
    if (!here) play([me]);
    for (let k = 0; k < 30 && !(isCurrent(detail.id) && player.dur > 0); k++) await new Promise(r => setTimeout(r, 100));
    seek(sec);
    if (!player.playing) toggle();
  }
  async function album() {
    if (busy) return; busy = true;
    try {
      const tracks = await albumOf(me);
      play(tracks, Math.max(0, tracks.findIndex(t => t.id === detail.id)));
    } catch (e: any) { toast(e.message); } finally { busy = false; }
  }
</script>
<div class="v">
  <div class="cover"><CoverArt doc={detail} eager /></div>
  <div class="txt">
    <h2>{detail.title}</h2>
    {#if detail.by}<p class="by">{detail.by}</p>{/if}
    {#if detail.album}<p class="al">{detail.album}{#if detail.track} <span class="tnum">· Titel {detail.track}</span>{/if}</p>{/if}
    {#if detail.durationMs}<p class="du tnum">{duration(detail.durationMs)}</p>{/if}
  </div>
  <div class="acts">
    <button type="button" class="main" onclick={() => (here ? toggle() : play([me]))}><Icon name={going ? "pause" : "play"} size={20} />{going ? "Pause" : "Abspielen"}</button>
    {#if detail.album}<button type="button" class="sec" disabled={busy} onclick={album}>Album abspielen</button>{/if}
  </div>
  {#if detail.transcript}<TranscriptView transcript={detail.transcript} onseek={from} {mark} />{/if}
</div>
<style>
  .v { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; align-items: center; gap: 18px; padding: 28px 20px 40px; }
  .cover { flex: none; width: min(78vw, 340px); aspect-ratio: 1; border-radius: 14px; overflow: hidden; box-shadow: inset 0 0 0 1px var(--rule), var(--shadow); }
  .txt { text-align: center; max-width: 520px; display: flex; flex-direction: column; gap: 3px; }
  h2 { font-size: 30px; line-height: 1.15; overflow-wrap: anywhere; }
  .by { font-size: 18px; } .al, .du { color: var(--muted); }
  .acts { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }
  button { min-height: 48px; padding: 0 22px; border: 0; border-radius: 24px; display: inline-flex; align-items: center; gap: 9px; font: inherit; font-weight: 650; cursor: pointer; }
  .main { background: var(--ink); color: var(--on-ink); } .main:hover { background: var(--water); }
  .sec { background: transparent; color: var(--ink); box-shadow: inset 0 0 0 1.5px var(--rule); } .sec:hover:not(:disabled) { background: var(--surface-2); }
  .sec:disabled { opacity: .5; }
</style>
