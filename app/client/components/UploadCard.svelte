<script lang="ts">
  // What an import is doing, from the moment the picker closes until the last file is in: reading the folder, then a
  // bar by bytes (a 1 GB video moves it too), the count and the file on its way. The toast says how it ended.
  import { up, busy } from "../lib/upload.svelte";
  import { num, bytes } from "../lib/format";
  import { stroke } from "../lib/motion";
  const through = $derived(up.done + up.skipped + up.failed);
  const share = $derived(up.bytes ? Math.min(1, up.moved / up.bytes) : 0);
</script>
{#if busy()}
  <div class="upcard" role="status" in:stroke={{ from: "left" }} out:stroke={{ from: "left", duration: 260 }}>
    <p class="t"><span class="sun" data-sun aria-hidden="true"></span>{up.reading ? "Liest den Ordner" : "Lädt hoch"}
      {#if !up.reading}<span class="pc tnum">{Math.floor(share * 100)} %</span>{/if}</p>
    <div class="bar" class:wait={up.reading} aria-hidden="true"><span style:width={up.reading ? null : `${Math.max(2, share * 100)}%`}></span></div>
    {#if up.reading}
      <p class="s">Bei Tausenden Dateien dauert das einen Moment.</p>
    {:else}
      <p class="s tnum">{num(through)} von {num(up.total)} · {bytes(up.moved)} von {bytes(up.bytes)}</p>
      {#if up.now}<p class="s f">{up.now}</p>{/if}
      {#if up.other}<p class="s">{num(up.other)} versteckte Dateien übersprungen</p>{/if}
    {/if}
  </div>
{/if}
<style>
  .upcard { position: fixed; z-index: 29; left: 20px; bottom: 24px; width: min(340px, calc(100vw - 24px)); padding: 14px 16px 13px; border-radius: 20px; background: var(--surface); box-shadow: var(--shadow), inset 0 0 0 1px var(--rule); display: flex; flex-direction: column; gap: 7px; }
  @media (max-width: 899px) { .upcard { left: 12px; right: 12px; width: auto; bottom: auto; top: calc(env(safe-area-inset-top) + 10px); } }
  p { margin: 0; }
  .t { display: flex; align-items: center; gap: 10px; font-weight: 650; font-size: 15px; }
  .pc { margin-left: auto; color: var(--muted); font-size: 13px; font-weight: 600; }
  .s { font-size: 12.5px; color: var(--muted); }
  .f { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sun { width: 12px; height: 12px; border-radius: 50%; background: var(--sun); flex: none; animation: breathe 1.8s ease-in-out infinite; }
  /* a stroke of water across the bar; its light wanders along so the bar lives while one big file is on its way */
  .bar { position: relative; height: 10px; border-radius: 999px; background: var(--surface-2); overflow: hidden; transform: rotate(-.4deg); }
  .bar span { position: absolute; inset: 0 auto 0 0; border-radius: inherit; transition: width .6s ease;
    background: linear-gradient(90deg, var(--water) 0%, var(--teich) 30%, var(--water-soft) 50%, var(--teich) 70%, var(--water) 100%) 0 0 / 220px 100% repeat-x;
    animation: wash 1.6s linear infinite; }
  .bar.wait span { width: 34%; animation: wash 1.6s linear infinite, sweep 1.4s ease-in-out infinite alternate; }
  @keyframes wash { to { background-position: 220px 0; } }
  @keyframes sweep { from { left: -10%; } to { left: 76%; } }
  @keyframes breathe { 50% { transform: scale(.7); opacity: .55; } }
  @media (prefers-reduced-motion: reduce) { .sun, .bar span, .bar.wait span { animation: none; transition: none; } .bar.wait span { width: 100%; opacity: .45; } }
</style>
