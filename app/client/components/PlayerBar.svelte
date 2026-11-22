<script lang="ts">
  // The bar of the global player (lib/player.svelte.ts): only there while something is queued. It sits at the bottom of
  // the main column on the desktop and just above the tab bar on the phone. While it shows, --player-h on the root says
  // how much room it takes, so pages pad their bottom and the floating bars lift above it.
  import { app, within } from "../lib/state.svelte";
  import { duration } from "../lib/format";
  import { player, current, toggle, next, prev, seek, close } from "../lib/player.svelte";
  import Icon from "./Icon.svelte";
  import Link from "./Link.svelte";
  import CoverArt from "./CoverArt.svelte";
  let { bare = false }: { bare?: boolean } = $props();
  const d = $derived(current());
  const shown = $derived(d != null);
  const wide = $derived(app.wide);
  $effect(() => {
    if (!shown) return;
    document.documentElement.style.setProperty("--player-h", wide ? "78px" : "92px");
    return () => document.documentElement.style.removeProperty("--player-h");
  });
  const t = (s: number) => duration(s * 1000);
  const sub = $derived([d?.by, d?.album].filter(Boolean).join(" · "));
</script>
{#if d}
  <section class="bar" class:bare class:wide aria-label="Player">
    <Link href={within(`/datei/${d.id}`, d.owner ?? undefined)} raw class="cov" aria-label="{d.title} öffnen"><CoverArt doc={d} eager /></Link>
    <div class="who">
      <b>{d.title}</b>
      <span class="s">{player.error || sub || "Audio"}</span>
    </div>
    <div class="keys">
      <button type="button" aria-label="Zurück" disabled={player.index <= 0 && player.pos < 1} onclick={prev}><Icon name="vorher" size={20} /></button>
      <button type="button" class="pp" aria-label={player.playing ? "Pause" : "Abspielen"} onclick={toggle}><Icon name={player.playing ? "pause" : "play"} size={22} /></button>
      <button type="button" aria-label="Weiter" disabled={player.index >= player.queue.length - 1} onclick={next}><Icon name="weiter" size={20} /></button>
    </div>
    <div class="seek tnum">
      <span class="tm" aria-hidden="true">{t(player.pos)}</span>
      <input type="range" min="0" max={Math.max(1, Math.round(player.dur))} step="1" value={Math.min(player.pos, player.dur || player.pos)} aria-label="Position" aria-valuetext="{t(player.pos)} von {t(player.dur)}" disabled={!player.dur} oninput={e => seek(Number(e.currentTarget.value))} />
      <span class="tm" aria-hidden="true">{t(player.dur)}</span>
    </div>
    <button type="button" class="x" aria-label="Player schließen" onclick={close}><Icon name="x" size={18} sw={2} /></button>
  </section>
{/if}
<style>
  .bar { position: fixed; z-index: 27; left: 10px; right: 10px; bottom: calc(64px + max(18px, env(safe-area-inset-bottom)) + 8px); box-sizing: border-box; height: 80px;
    display: grid; grid-template-columns: 52px minmax(0, 1fr) auto 36px; grid-template-areas: "c w k x" "s s s s"; align-items: center; gap: 2px 10px; padding: 8px 6px 4px 8px;
    border-radius: 18px; background: var(--glass); backdrop-filter: blur(20px) saturate(1.4); -webkit-backdrop-filter: blur(20px) saturate(1.4); box-shadow: inset 0 0 0 1px var(--rule), var(--shadow); }
  .bar.bare { bottom: calc(max(10px, env(safe-area-inset-bottom))); }
  .bar :global(.cov) { grid-area: c; display: block; width: 52px; height: 52px; border-radius: 8px; overflow: hidden; box-shadow: inset 0 0 0 1px var(--rule); }
  .who { grid-area: w; min-width: 0; display: flex; flex-direction: column; line-height: 1.25; }
  .who b { font-size: 14px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .s { font-size: 12.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .keys { grid-area: k; display: flex; align-items: center; }
  .x { grid-area: x; }
  .seek { grid-area: s; display: flex; align-items: center; gap: 8px; min-width: 0; }
  .tm { flex: none; min-width: 36px; font-size: 11.5px; color: var(--muted); }
  .tm:first-child { text-align: right; }
  input { flex: 1; min-width: 0; height: 24px; margin: 0; accent-color: var(--water); }
  button { display: grid; place-items: center; width: 40px; height: 40px; padding: 0; border: 0; border-radius: 20px; background: transparent; color: var(--ink); cursor: pointer; }
  button:hover:not(:disabled) { background: var(--surface-2); }
  button:disabled { opacity: .35; cursor: default; }
  .pp { width: 44px; height: 44px; border-radius: 22px; background: var(--ink); color: var(--on-ink); }
  .pp:hover:not(:disabled) { background: var(--water); }
  .x { width: 36px; height: 36px; color: var(--muted); }
  /* desktop: one row at the bottom of the main column (right of the sidebar), on a bare page centred */
  .bar.wide { bottom: 14px; left: 262px; right: 14px; max-width: 900px; height: 64px; grid-template-columns: 48px minmax(120px, 1fr) auto minmax(180px, 1.2fr) 36px; grid-template-areas: "c w k s x"; padding: 8px 8px 8px 8px; gap: 12px; }
  .bar.wide.bare { left: 14px; margin: 0 auto; }
  .bar.wide :global(.cov) { width: 48px; height: 48px; }
</style>
