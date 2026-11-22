<script lang="ts">
  import { app, closeToast } from "../lib/state.svelte";
  import { stroke } from "../lib/motion";
</script>
{#if app.toast}
  <div class="toast" role="status" in:stroke={{ from: "middle" }} out:stroke={{ from: "middle", duration: 220 }}>
    <span>{app.toast.msg}</span>
    {#if app.toast.action}<button type="button" onclick={() => { app.toast?.action?.run(); closeToast(); }}>{app.toast.action.label}</button>{/if}
  </div>
{/if}
<style>
  .toast { position: fixed; z-index: 30; left: 50%; transform: translateX(-50%); bottom: calc(env(safe-area-inset-bottom) + 100px + var(--player-h, 0px)); display: flex; align-items: center; gap: 14px; max-width: calc(100vw - 28px); padding: 6px 8px 6px 18px; min-height: 44px; border-radius: 24px; background: var(--ink); color: var(--on-ink); box-shadow: var(--shadow); font-size: 14px; font-weight: 600; }
  button { min-height: 44px; padding: 0 14px; border: 0; border-radius: 22px; background: transparent; color: var(--sun); font-weight: 700; }
  button:hover { background: rgb(255 255 255 / .12); }
  @media (min-width: 900px) { .toast { bottom: calc(96px + var(--player-h, 0px)); } }
</style>
