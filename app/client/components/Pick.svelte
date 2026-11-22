<script lang="ts">
  // While things are picked, this covers a card (the parent is position: relative): a tap toggles, the circle shows the state.
  import Icon from "./Icon.svelte";
  let { on, ontoggle, label }: { on: boolean; ontoggle: () => void; label: string } = $props();
</script>
<button type="button" class="pick" class:on aria-pressed={on} aria-label="{label}, {on ? 'ausgewählt' : 'nicht ausgewählt'}" onclick={e => { e.preventDefault(); e.stopPropagation(); ontoggle(); }}>
  <span class="c">{#if on}<Icon name="check" size={13} sw={3} />{/if}</span>
</button>
<style>
  .pick { position: absolute; inset: 0; z-index: 2; padding: 0; border: 0; border-radius: inherit; background: transparent; cursor: pointer; }
  .pick.on { box-shadow: inset 0 0 0 3px var(--sun); }
  .c { position: absolute; left: 8px; top: 8px; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: rgb(34 48 94 / .25); color: #fff; box-shadow: 0 0 0 1.5px #FBF8F2; }
  .on .c { background: var(--sun); }
</style>
