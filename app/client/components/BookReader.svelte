<script lang="ts">
  // An EPUB: one spine document at a time in a sandboxed iframe (no scripts, same origin so its pictures load), a table of
  // contents to jump, previous and next chapter. The chapter number lives in the URL hash (#c3), so a reload keeps the place.
  import type { BookOut, DocDetail } from "../../shared/types";
  import { api } from "../lib/api";
  import { app } from "../lib/state.svelte";
  import Icon from "./Icon.svelte";
  import Loading from "./Loading.svelte";
  let { detail }: { detail: DocDetail } = $props();

  let book = $state<BookOut | null>(null), error = $state("");
  let ch = $state(0), frag = $state(""), other = $state(""), toc = $state(false);
  let frame: HTMLIFrameElement | undefined = $state();

  const fromHash = () => { const m = /^#c(\d+)$/.exec(location.hash); return m ? Number(m[1]) - 1 : 0; };
  $effect(() => {
    if (!detail) return;
    const my = detail.id; book = null; error = ""; frag = ""; other = "";
    api<BookOut>(`/api/docs/${my}/book`).then(b => {
      if (my !== detail?.id) return;
      book = b; ch = Math.min(Math.max(0, fromHash()), Math.max(0, b.spine.length - 1)); toc = app.wide;
    }).catch(e => { if (my === detail?.id) error = e.message || "Das Buch konnte nicht geladen werden."; });
  });
  const n = $derived(book?.spine.length ?? 0);
  // the table of contents, or the spine's own titles when the book has none
  const entries = $derived(book ? (book.toc.length ? book.toc : book.spine.map((s, i) => ({ title: s.title || `Kapitel ${i + 1}`, href: s.href, depth: 0 }))) : []);
  // a path inside the book to a URL: spaces and the like are escaped, escapes that are there stay
  const url = (h: string) => h.replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@/%]/g, encodeURIComponent);
  const shown = $derived(book ? other || book.spine[ch]?.href || "" : "");
  const src = $derived(shown && detail ? `/media/doc/${detail.id}/book/${url(shown)}${frag ? `#${url(frag)}` : ""}` : "");
  const title = $derived(`${detail.title}, ${book?.spine[ch]?.title || `Kapitel ${ch + 1}`}`);

  // keep the place in the hash without adding history entries
  $effect(() => { if (book) { try { history.replaceState(history.state, "", `${location.pathname}${location.search}#c${ch + 1}`); } catch {} } });

  const norm = (h: string) => { try { return decodeURIComponent(h); } catch { return h; } };
  function go(i: number, f = "") {
    if (!book || i < 0 || i >= n) return;
    ch = i; frag = f; other = "";
  }
  const prev = () => go(ch - 1), next = () => go(ch + 1);
  function open(href: string) {
    if (!book) return;
    const [path, f = ""] = href.split("#");
    const i = book.spine.findIndex(s => norm(s.href) === norm(path));
    if (i >= 0) go(i, f); else { other = path; frag = f; }
    if (!app.wide) toc = false;
  }
  const active = (href: string) => norm(href.split("#")[0]) === norm(shown);

  // arrows turn the page while the iframe has no focus; once you click into the chapter its own keys are passed on
  function key(e: KeyboardEvent) {
    if ((e.key !== "ArrowLeft" && e.key !== "ArrowRight") || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if ((e.target as Element | null)?.closest?.("input, textarea, select, [contenteditable]")) return;
    e.preventDefault(); if (e.key === "ArrowLeft") prev(); else next();
  }
  $effect(() => { addEventListener("keydown", key); return () => removeEventListener("keydown", key); });
  function loaded() {
    try { frame?.contentDocument?.addEventListener("keydown", key); } catch { /* not readable: the buttons still work */ }
  }
</script>

<div class="reader">
  {#if error}
    <div class="msg" role="alert"><p>{error}</p></div>
  {:else if !book}
    <Loading text="Das Buch kommt" />
  {:else}
    <div class="bar">
      <button type="button" class="b" aria-pressed={toc} aria-controls="buch-inhalt" aria-label="Inhalt" onclick={() => (toc = !toc)}><Icon name="inhalt" size={20} sw={1.9} /><span class="lbl">Inhalt</span></button>
      <span class="grow"></span>
      <button type="button" class="b" aria-label="Vorheriges Kapitel" disabled={ch <= 0} onclick={prev}><Icon name="back" size={20} sw={2} /><span class="lbl">Vorheriges Kapitel</span></button>
      <span class="pos tnum" aria-live="polite">Kapitel {ch + 1} von {n}</span>
      <button type="button" class="b" aria-label="Nächstes Kapitel" disabled={ch >= n - 1} onclick={next}><span class="lbl">Nächstes Kapitel</span><Icon name="chevron" size={20} sw={2} /></button>
    </div>
    <div class="main">
      {#if toc}
        <nav id="buch-inhalt" class="toc" aria-label="Inhalt">
          <ul>
            {#each entries as e}
              <li><button type="button" style="padding-left:{14 + Math.min(e.depth, 5) * 16}px" aria-current={active(e.href) ? "true" : undefined} onclick={() => open(e.href)}>{e.title}</button></li>
            {/each}
          </ul>
        </nav>
      {/if}
      <div class="page">
        <iframe bind:this={frame} {title} {src} sandbox="allow-same-origin" onload={loaded}></iframe>
      </div>
    </div>
  {/if}
</div>

<style>
  .reader { flex: 1; min-height: 0; display: flex; flex-direction: column; min-width: 0; }
  .bar { flex: none; display: flex; align-items: center; gap: 4px; padding: 4px 10px; border-bottom: 1px solid var(--rule); background: var(--surface); }
  .grow { flex: 1; }
  .b { display: inline-flex; align-items: center; gap: 6px; min-width: 44px; height: 44px; padding: 0 10px; border: 0; border-radius: 22px; background: transparent; color: var(--ink); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; justify-content: center; }
  .b:hover:not(:disabled) { background: var(--surface-2); }
  .b:disabled { opacity: .35; cursor: default; }
  .b[aria-pressed=true] { background: var(--water-soft); }
  .lbl { display: none; }
  @media (min-width: 700px) { .lbl { display: inline; } }
  .pos { padding: 0 6px; font-size: 14px; color: var(--muted); white-space: nowrap; }
  .main { flex: 1; min-height: 0; display: flex; position: relative; }
  .toc { flex: none; width: 300px; overflow: auto; overscroll-behavior: contain; border-right: 1px solid var(--rule); background: var(--surface); padding: 6px 0 24px; }
  .toc ul { list-style: none; margin: 0; padding: 0; }
  .toc button { display: block; width: 100%; min-height: 40px; padding-top: 8px; padding-bottom: 8px; padding-right: 14px; border: 0; background: transparent; color: var(--ink); font: inherit; font-size: 14px; line-height: 1.3; text-align: left; cursor: pointer; overflow-wrap: anywhere; }
  .toc button:hover { background: var(--surface-2); }
  .toc button[aria-current] { background: var(--water-soft); font-weight: 650; }
  .page { flex: 1; min-width: 0; display: flex; }
  iframe { flex: 1; width: 100%; height: 100%; border: 0; background: var(--ground); }
  /* on a phone the contents cover the page until you pick something */
  @media (max-width: 899px) { .toc { position: absolute; inset: 0; z-index: 2; width: auto; border-right: 0; } }
  .msg { margin: auto; padding: 24px; color: var(--muted); text-align: center; }
</style>
