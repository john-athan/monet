<script lang="ts">
  // A place or an album: the cover picture, a Didot name, how many.
  import Link from "./Link.svelte";
  import Pic from "./Pic.svelte";
  import { count } from "../lib/format";
  import { coverUrl } from "../lib/files.svelte";
  // files: how many files carry it too (Dinge, docs/together.md); doc: a file's cover when no photo has one
  let { href, name, n, cover, sub = "", files = 0, doc = null }: { href: string; name: string; n: number; cover: number | null; sub?: string; files?: number; doc?: number | null } = $props();
  const what = $derived([n || !files ? count(n, "Foto", "Fotos") : "", files ? count(files, "Datei", "Dateien") : ""].filter(Boolean).join(", "));
</script>
<Link {href} class="cover">
  <span class="pic">{#if cover}<Pic id={cover} w={1} h={1} square sizes="(min-width: 900px) 220px, 46vw" />{:else if doc}<img class="doc" src={coverUrl(doc)} alt="" loading="lazy" />{/if}</span>
  <span class="t"><span class="n">{name}</span><span class="tnum c">{sub ? sub + ", " : ""}{what}</span></span>
</Link>
<style>
  :global(.cover) { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .pic { display: block; aspect-ratio: 1; border-radius: 16px; overflow: hidden; background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--rule); }
  :global(.cover:hover) .pic { filter: brightness(1.05) saturate(1.05); }
  .doc { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top; }
  .t { display: flex; flex-direction: column; line-height: 1.2; }
  .n { font-family: var(--font-display); font-size: 22px; } .c { font-size: 13px; color: var(--muted); }
</style>
