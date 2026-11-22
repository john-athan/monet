<script lang="ts">
  // A bottom sheet on the phone, a dialog in the middle on the desktop. Esc and the scrim close it.
  import type { Snippet } from "svelte";
  import { lily, lilyOut, veil } from "../lib/motion";
  const wide = matchMedia("(min-width: 900px)").matches;
  let { open = $bindable(false), label, children }: { open: boolean; label: string; children: Snippet } = $props();
  let el: HTMLDivElement | undefined = $state();
  $effect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    queueMicrotask(() => (el?.querySelector("input, button, [tabindex]") as HTMLElement | null)?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); open = false; }
      if (e.key === "Tab" && el) { // keep the focus inside
        const f = [...el.querySelectorAll<HTMLElement>("button, input, a[href], [tabindex='0']")].filter(x => !x.hasAttribute("disabled"));
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    addEventListener("keydown", onKey, true);
    return () => { removeEventListener("keydown", onKey, true); prev?.focus?.(); };
  });
</script>
{#if open}
  <div class="scrim" onclick={() => (open = false)} aria-hidden="true" transition:veil></div>
  <div class="sheet" role="dialog" in:lily={{ wide }} out:lilyOut={{ wide }} aria-modal="true" aria-label={label} bind:this={el}>
    <span class="grab" aria-hidden="true"></span>
    {@render children()}
  </div>
{/if}
<style>
  .scrim { position: fixed; inset: 0; z-index: 40; background: var(--veil); }
  .sheet { position: fixed; z-index: 41; left: 0; right: 0; bottom: 0; max-height: 80vh; overflow: auto; padding: 10px 20px calc(env(safe-area-inset-bottom) + 20px); border-radius: 22px 22px 0 0; background: var(--surface); box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 14px; }
  .grab { align-self: center; width: 36px; height: 5px; border-radius: 3px; background: var(--surface-3); flex: none; }
  @media (min-width: 900px) { .sheet { left: 50%; right: auto; bottom: auto; top: 50%; width: 440px; transform: translate(-50%, -50%); border-radius: 22px; padding-bottom: 20px; } .grab { display: none; } }
</style>
