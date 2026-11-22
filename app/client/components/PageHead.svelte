<script lang="ts">
  // The title of a room: Didot with two dabs of the room's colour under it, as on the canvas.
  import type { Snippet } from "svelte";
  let { title, sub = "", room, children }: { title: string; sub?: string; room: string; children?: Snippet } = $props();
</script>
<header>
  <div class="in">
    <div class="ttl">
      <span aria-hidden="true" class="dab stroke" style="left:-2px;bottom:2px;width:65%;height:10px;background:var({room});opacity:.7;transform:rotate(-2deg)"></span>
      <span aria-hidden="true" class="dab stroke" style="left:45%;bottom:-1px;width:44%;height:8px;background:var({room});opacity:.45;transform:rotate(3deg)"></span>
      <h1>{title}</h1>
    </div>
    {@render children?.()}
  </div>
  {#if sub}<p class="tnum">{sub}</p>{/if}
</header>
<style>
  header { padding: 22px 18px 8px; display: flex; flex-direction: column; gap: 4px; }
  .in { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
  .ttl { position: relative; width: max-content; max-width: 100%; }
  h1 { position: relative; font-size: 40px; line-height: 1; }
  p { font-size: 13px; color: var(--muted); }
  @media (min-width: 900px) { header { padding: 6px 0 14px; } h1 { font-size: 52px; line-height: 1.05; } p { font-size: 17px; } }
</style>
