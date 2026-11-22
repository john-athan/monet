<script lang="ts">
  // A place or an album: the cover picture, a Didot name, how many.
  import Link from "./Link.svelte";
  import Pic from "./Pic.svelte";
  import { count } from "../lib/format";
  let { href, name, n, cover, sub = "" }: { href: string; name: string; n: number; cover: number | null; sub?: string } = $props();
</script>
<Link {href} class="cover">
  <span class="pic">{#if cover}<Pic id={cover} w={1} h={1} square sizes="(min-width: 900px) 220px, 46vw" />{/if}</span>
  <span class="t"><span class="n">{name}</span><span class="tnum c">{sub ? sub + ", " : ""}{count(n, "Foto", "Fotos")}</span></span>
</Link>
<style>
  :global(.cover) { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .pic { display: block; aspect-ratio: 1; border-radius: 16px; overflow: hidden; background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--rule); }
  :global(.cover:hover) .pic { filter: brightness(1.05) saturate(1.05); }
  .t { display: flex; flex-direction: column; line-height: 1.2; }
  .n { font-family: var(--font-display); font-size: 22px; } .c { font-size: 13px; color: var(--muted); }
</style>
