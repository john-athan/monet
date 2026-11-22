<script lang="ts">
  // The desktop header: mark, search, light, import. The upload progress is its own card (UploadCard).
  import { app, go, light, cycleLight, setQuery, local, theme } from "../lib/state.svelte";
  import { themeOf } from "../lib/theme";
  import { LIGHT_NAME } from "../lib/light";
  import Link from "./Link.svelte";
  import Mark from "./Mark.svelte";
  import Icon from "./Icon.svelte";
  let { onimport }: { onimport: () => void } = $props();
  const onSearch = $derived(local() === "/suche");
  const q = $derived(onSearch ? new URLSearchParams(app.query).get("q") ?? "" : "");
  let input: HTMLInputElement | undefined = $state();
  function type(v: string) {
    const s = v ? "q=" + encodeURIComponent(v) : "";
    onSearch ? setQuery(s) : go("/suche" + (s ? "?" + s : ""));
  }
  $effect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); input?.focus(); input?.select(); } };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  });
  const mode = $derived(app.lightMode === "auto" ? "folgt der Uhrzeit" : "von Hand gewählt");
</script>
<header data-vt="header">
  <Link href="/" class="logo"><Mark size={32} /><span>{themeOf(theme()).brand}</span></Link>
  <label class="search">
    <Icon name="suche" size={19} sw={1.9} />
    <input bind:this={input} type="search" aria-label="Fotos durchsuchen" placeholder="Personen, Orte, Dinge, Text in Bildern" value={q} oninput={e => type(e.currentTarget.value)} />
    <kbd>⌘K</kbd>
  </label>
  <span class="sp"></span>
  <button type="button" class="ghost" onclick={cycleLight} aria-label="Licht: {LIGHT_NAME[light()]}, {mode}. Wechseln.">
    <span class="sun" data-sun></span>{LIGHT_NAME[light()]}
  </button>
  <button type="button" class="ghost ring" onclick={onimport}>Importieren</button>
  <Link href="/haushalt" class="set" aria-label="Einstellungen: Stil, Haushalt, Geräte" title="Einstellungen"><Icon name="stil" size={22} /></Link>
</header>
<style>
  header { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; padding: 14px 24px 10px; }
  header :global(.logo) { display: flex; align-items: center; gap: 9px; width: 208px; }
  .logo span, header :global(.logo span) { font-family: var(--font-display); font-size: 27px; line-height: 1; }
  .search { flex: 1 1 360px; max-width: 620px; height: 44px; display: flex; align-items: center; gap: 10px; padding: 0 8px 0 16px; border-radius: 22px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--rule); }
  .search:focus-within { box-shadow: inset 0 0 0 1.5px var(--water); }
  .search :global(svg) { color: var(--muted); flex: none; }
  input { flex: 1; min-width: 0; border: 0; background: transparent; outline: none; font-size: 15px; }
  kbd { padding: 2px 7px; border-radius: 6px; background: var(--surface-2); font: 600 12px var(--font-body); color: var(--muted); }
  .sp { flex: 1; }
  .ghost { height: 44px; padding: 0 12px; border: 0; border-radius: 22px; background: transparent; display: inline-flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; color: var(--muted); }
  .ghost:hover { background: var(--surface-2); }
  .ghost.ring { padding: 0 16px; box-shadow: inset 0 0 0 1.5px var(--rule); font-size: 15px; font-weight: 650; color: var(--ink); }
  header :global(.set) { width: 44px; height: 44px; display: grid; place-items: center; border-radius: 22px; color: var(--muted); }
  header :global(.set:hover) { background: var(--surface-2); color: var(--ink); }
  .sun { width: 14px; height: 14px; border-radius: 50%; background: var(--sun); }
</style>
