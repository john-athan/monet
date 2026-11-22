<script lang="ts">
  import { SECTIONS, sectionOf } from "../lib/nav";
  import { local } from "../lib/state.svelte";
  import Link from "./Link.svelte";
  import Icon from "./Icon.svelte";
  const cur = $derived(sectionOf(local()));
</script>
<nav aria-label="Bereiche" data-vt="tabs" style="grid-template-columns:repeat({SECTIONS.length}, minmax(0, 1fr))">
  {#each SECTIONS as s}
    <Link href={s.path} class={s.key === cur ? "on" : "tab"} aria-current={s.key === cur ? "page" : undefined}>
      <Icon name={s.key} />{s.label}
      {#if s.key === cur}<span class="mk" aria-hidden="true"><span class="dab stroke" style="inset:0;background:var({s.room});transform:rotate(-4deg)"></span></span>{/if}
    </Link>
  {/each}
</nav>
<style>
  nav { position: fixed; z-index: 20; left: 0; right: 0; bottom: 0; height: calc(82px - 18px + max(18px, env(safe-area-inset-bottom))); display: grid; padding: 8px 8px max(18px, env(safe-area-inset-bottom)); background: var(--glass); backdrop-filter: blur(20px) saturate(1.4); -webkit-backdrop-filter: blur(20px) saturate(1.4); border-top: 1px solid var(--rule); }
  nav :global(a) { display: flex; flex-direction: column; align-items: center; gap: 3px; min-height: 44px; font-size: 11.5px; font-weight: 650; }
  nav :global(a.tab) { color: var(--muted); }
  nav :global(a.tab:hover) { color: var(--ink); }
  nav :global(a.on) { color: var(--ink); font-weight: 700; }
  .mk { position: relative; width: 26px; height: 6px; }
  .mk .dab { animation: brush .333s cubic-bezier(.3,.7,.2,1) both; }
  @keyframes brush { from { clip-path: inset(0 100% 0 0 round 3px); } to { clip-path: inset(0 0 0 0 round 3px); } }
</style>
