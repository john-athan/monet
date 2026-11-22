<script lang="ts">
  // txt, tex and md as text. The file's text is only ever put into text nodes, never into markup.
  import type { DocDetail } from "../../shared/types";
  import { parseMarkdown, type Block, type Inline } from "../lib/markdown";
  import { num } from "../lib/format";
  import Loading from "./Loading.svelte";
  let { detail, plain = false }: { detail: DocDetail; /** monospace, wrapped, whatever the format (other files) */ plain?: boolean } = $props();

  const CAP = 1_500_000;
  let text = $state<string | null>(null), error = $state(""), cut = $state(false);
  const md = $derived(!plain && (detail.format === "md" || detail.format === "markdown"));
  const blocks = $derived(md && text !== null ? parseMarkdown(text) : []);

  $effect(() => {
    const my = detail.id; text = null; error = ""; cut = false;
    const ctl = new AbortController();
    fetch(`/media/doc/${my}/text`, { credentials: "same-origin", signal: ctl.signal })
      .then(r => { if (!r.ok) throw new Error(); return r.text(); })
      .then(t => { cut = t.length > CAP; text = cut ? t.slice(0, CAP) : t; })
      .catch(e => { if (e?.name !== "AbortError") error = "Der Text konnte nicht geladen werden."; });
    return () => ctl.abort();
  });
</script>

{#snippet inl(nodes: Inline[])}
  {#each nodes as n}
    {#if n.t === "text"}{n.v}
    {:else if n.t === "code"}<code>{n.v}</code>
    {:else if n.t === "strong"}<strong>{@render inl(n.c)}</strong>
    {:else if n.t === "em"}<em>{@render inl(n.c)}</em>
    {:else if n.t === "br"}<br />
    {:else if n.t === "link"}{@render inl(n.c)}{#if n.href} <span class="url">({n.href})</span>{/if}{/if}
  {/each}
{/snippet}

{#snippet blk(list: Block[])}
  {#each list as b}
    {#if b.t === "h"}
      {#if b.level === 1}<h1>{@render inl(b.c)}</h1>
      {:else if b.level === 2}<h2>{@render inl(b.c)}</h2>
      {:else if b.level === 3}<h3>{@render inl(b.c)}</h3>
      {:else}<h4>{@render inl(b.c)}</h4>{/if}
    {:else if b.t === "p"}<p>{@render inl(b.c)}</p>
    {:else if b.t === "hr"}<hr />
    {:else if b.t === "code"}<!-- svelte-ignore a11y_no_noninteractive_tabindex --><pre class="code" tabindex="0"><code>{b.v}</code></pre>
    {:else if b.t === "quote"}<blockquote>{@render blk(b.c)}</blockquote>
    {:else if b.t === "list"}
      {#if b.ordered}<ol start={b.start}>{#each b.items as it}<li>{@render blk(it)}</li>{/each}</ol>
      {:else}<ul>{#each b.items as it}<li>{@render blk(it)}</li>{/each}</ul>{/if}
    {/if}
  {/each}
{/snippet}

<div class="scroll">
  {#if error}<p class="note" role="alert">{error}</p>
  {:else if text === null}<Loading text="Text wird geladen" />
  {:else}
    <article class:md aria-label="Text von {detail.title}">
      {#if md}{@render blk(blocks)}{:else}<pre class="plain">{text}</pre>{/if}
      {#if cut}<p class="note">Zeigt die ersten {num(CAP)} Zeichen. Alles steht im Original.</p>{/if}
    </article>
  {/if}
</div>

<style>
  .scroll { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; }
  article { box-sizing: border-box; max-width: 760px; margin: 0 auto; padding: 24px 20px 64px; }
  .plain { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 14px/1.65 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; tab-size: 4; }
  .md { font-size: 16px; line-height: 1.65; overflow-wrap: anywhere; }
  .md :is(h1, h2, h3, h4) { line-height: 1.2; margin: 1.5em 0 .5em; }
  .md :is(h1, h2, h3, h4):first-child { margin-top: 0; }
  .md h1 { font-size: 32px; } .md h2 { font-size: 25px; } .md h3 { font-size: 20px; } .md h4 { font-size: 17px; font-family: var(--font-body); font-weight: 650; }
  .md p { margin: 0 0 1em; }
  .md :is(ul, ol) { margin: 0 0 1em; padding-left: 1.5em; }
  .md li > :is(p) { margin-bottom: .4em; } .md li > :last-child { margin-bottom: 0; }
  .md li :is(ul, ol) { margin: .3em 0 0; }
  .md blockquote { margin: 0 0 1em; padding: 2px 0 2px 16px; border-left: 3px solid var(--rule); color: var(--muted); }
  .md blockquote > :last-child { margin-bottom: 0; }
  .md hr { border: 0; border-top: 1px solid var(--rule); margin: 1.6em 0; }
  code { font: .88em ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--surface-2); padding: .1em .35em; border-radius: 6px; }
  .code { margin: 0 0 1em; padding: 14px 16px; border-radius: 14px; background: var(--surface-2); overflow: auto; font-size: 13.5px; line-height: 1.55; }
  .code code { background: none; padding: 0; font-size: inherit; white-space: pre; }
  .url { color: var(--muted); font-size: .9em; }
  .note { padding: 18px 0; color: var(--muted); font-size: 14px; }
</style>
