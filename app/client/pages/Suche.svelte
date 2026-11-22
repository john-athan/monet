<script lang="ts">
  // Suche: the text becomes chips (each removable), the picture words are embedded in the browser, results come back.
  import { onMount } from "svelte";
  import type { Chip, ItemSummary, SearchOut } from "../../shared/types";
  import { app, go, setQuery, view, viewing, member, house, genitive } from "../lib/state.svelte";
  import { people, loadPeople } from "../lib/stores.svelte";
  import { gone } from "../lib/actions.svelte";
  import { embed, parseText, searchChips } from "../lib/search.svelte";
  import { justify, WIDE } from "../lib/layout";
  import { count, num } from "../lib/format";
  import Tile from "../components/Tile.svelte";
  import Icon from "../components/Icon.svelte";
  import Loading from "../components/Loading.svelte";

  const q = $derived(new URLSearchParams(app.query).get("q") ?? "");
  let chips = $state<Chip[]>([]), out = $state<SearchOut | null>(null), sort = $state<"best" | "date">("best");
  let busy = $state(false), error = $state(""), note = $state<"" | "loading" | "failed">("");
  // the whole household or only the library on screen; remembered on this device
  const readAll = () => { try { return localStorage.getItem("monet-suche-alle") === "1"; } catch { return false; } };
  let everyone = $state(readAll());
  const guest = $derived(viewing() != null ? member(viewing()) : undefined);
  const shared = $derived(house.members.filter(m => m.joined || m.count > 0).length > 1);
  function setEveryone(v: boolean) {
    if (everyone === v) return;
    everyone = v; try { v ? localStorage.setItem("monet-suche-alle", "1") : localStorage.removeItem("monet-suche-alle"); } catch {}
    run(q);
  }
  let seq = 0, debounce: ReturnType<typeof setTimeout>;
  const items = $derived((out?.items ?? []).filter(i => !gone.has(i.id)));
  $effect(() => { view.ids = items.map(i => i.id); });
  onMount(() => { loadPeople(); });

  async function run(text: string, given?: Chip[]) {
    const my = ++seq; error = "";
    if (!text.trim() && !given?.length) { chips = []; out = null; busy = false; note = ""; return; }
    busy = true;
    try {
      const all = everyone && shared;
      const cs = given ?? (await parseText(text, all)).chips;
      if (my !== seq) return;
      chips = cs;
      // the picture words are embedded in the browser; a warm model answers within the grace, a cold one (565 MB) does not,
      // and then the names, places, dates and labels show at once and the picture search reorders them when it is ready
      const content = cs.find(c => c.kind === "content");
      const pv = content ? embed(content.value) : null;
      const vec = pv ? await Promise.race([pv.catch(() => undefined), new Promise<undefined>(r => setTimeout(r, 300))]) : undefined;
      if (my !== seq) return;
      out = await searchChips(cs, sort, 120, all, vec);
      if (my !== seq) return;
      busy = false; note = pv && !vec ? "loading" : "";
      if (!pv || vec) return;
      let late: string;
      try { late = await pv; } catch { if (my === seq) note = "failed"; return; }
      if (my !== seq) return;
      const r = await searchChips(cs, sort, 120, all, late);
      if (my === seq) { out = r; note = ""; }
    } catch (e: any) { if (my === seq) { error = e.message; busy = false; } }
  }
  // the text in the URL is the truth; typing waits 250 ms
  $effect(() => { const text = q; clearTimeout(debounce); debounce = setTimeout(() => run(text), 250); return () => clearTimeout(debounce); });
  function setSort(s: "best" | "date") { if (sort === s) return; sort = s; run(q, chips); }
  function remove(c: Chip) {
    const rest = chips.filter(x => x !== c);
    // the text becomes what is left, so the page and the chips tell the same story
    setQuery(rest.length ? "q=" + encodeURIComponent(rest.map(x => x.label).join(" ")) : "");
    chips = rest;
  }
  function relax() {
    const p = chips.find(c => c.kind === "person"); if (p) remove(p);
  }
  const face = (c: Chip) => c.kind === "person" ? people.p?.named.find(n => String(n.id) === c.value)?.face ?? null : null;
  const icon = (k: string) => k === "date" ? "kalender" : k === "place" ? "ort" : k === "content" ? "bild" : "suche";
  let ww = $state(0);
  const wideRows = $derived(app.wide && ww ? justify(items, ww, WIDE.target) : []);
  let phoneInput: HTMLInputElement | undefined = $state();
  const type = (v: string) => setQuery(v ? "q=" + encodeURIComponent(v) : "");
</script>

{#snippet whose()}
  {#if shared}
    <div role="group" aria-label="Wessen Fotos" class="sort whose">
      <button type="button" aria-pressed={!everyone} onclick={() => setEveryone(false)}>{guest ? `Nur ${genitive(guest.name)}` : "Nur meine"}</button>
      <button type="button" aria-pressed={everyone} onclick={() => setEveryone(true)}>Alle im Haushalt</button>
    </div>
  {/if}
{/snippet}

{#snippet chipRow()}
  {#if chips.length}
    <div role="list" class="chips" aria-label="So hat Monet die Suche verstanden">
      {#each chips as c (c.kind + c.value)}
        {@const f = face(c)}
        <span role="listitem" class="chip" class:soft={c.kind === "content"} class:pl={!f}>
          {#if f}<img class="av" src="/media/face/{f}" alt="" width="28" height="28" />{:else}<Icon name={icon(c.kind)} size={16} />{/if}{c.label}
          <button type="button" class="x" aria-label={c.kind === "content" ? `Bildinhalt ${c.label} entfernen` : `Filter ${c.label} entfernen`} onclick={() => remove(c)}><Icon name="x" size={12} sw={2.6} /></button>
        </span>
      {/each}
    </div>
  {/if}
{/snippet}

{#snippet results()}
  {#if busy && !out}<Loading text="Monet sucht" />{/if}
  {#if error}<p class="msg" role="alert">{error}</p>{/if}
  {#if note === "loading"}<p class="msg quiet" role="status">Die Bildsuche lädt noch. Bis dahin zählen nur Namen, Orte, Daten und Text.</p>{/if}
  {#if note === "failed"}<p class="msg quiet" role="status">Die Bildsuche ist gerade nicht erreichbar. Namen, Orte, Daten und Text gelten trotzdem.</p>{/if}
  {#if out}
    <section aria-label="Treffer">
      <div class="top">
        <h2 class="tnum">{count(out.total, "Foto", "Fotos")}</h2>
        <div role="group" aria-label="Sortierung" class="sort">
          <button type="button" aria-pressed={sort === "best"} onclick={() => setSort("best")}>Beste Treffer</button>
          <button type="button" aria-pressed={sort === "date"} onclick={() => setSort("date")}>Nach Datum</button>
        </div>
      </div>
      {#if !items.length}<p class="msg">Dazu hat Monet nichts gefunden.</p>
      {:else if app.wide}
        <div class="rows">{#each wideRows as r}<div class="row" style="height:{r.h}px">{#each r.tiles as t}<div style="width:{t.w}px;height:{r.h}px"><Tile item={items[t.i]} sizes="{Math.round(t.w)}px" /></div>{/each}</div>{/each}</div>
      {:else}
        <div class="grid">
          {#each items as it, k (it.id)}<div class:hero={k === 0 && sort === "best" && items.length > 4}><Tile item={it} square sizes={k === 0 ? "66vw" : "34vw"} first={k < 6} /></div>{/each}
        </div>
      {/if}
    </section>
    {#if out.relaxed}
      <div class="more">
        <button type="button" onclick={relax}>
          <span class="two"><span style="background:{items[0]?.color ?? 'var(--surface-2)'}"></span><span style="background:{items[1]?.color ?? 'var(--water-soft)'}"></span></span>
          <span class="t"><b>{out.relaxed.label}</b><span class="tnum">{num(out.relaxed.count)} weitere Fotos</span></span>
          <Icon name="chevron" size={18} sw={2} />
        </button>
      </div>
    {/if}
  {:else if !busy && !error}
    <p class="msg quiet">Suche nach Personen, Orten, Jahreszeiten, Dingen auf dem Bild oder Text, der darauf steht. Zum Beispiel „Oma im Schnee 2019“.</p>
  {/if}
{/snippet}

{#if app.wide}
  <div class="w" bind:clientWidth={ww}>{@render whose()}{@render chipRow()}{@render results()}</div>
{:else}
  <header>
    <div class="bar">
      <button type="button" class="back" aria-label="Zurück zu Fotos" onclick={() => (history.length > 1 ? history.back() : go("/"))}><Icon name="back" size={22} sw={2} /></button>
      <label class="field">
        <Icon name="suche" size={19} sw={1.9} />
        <!-- svelte-ignore a11y_autofocus -->
        <input bind:this={phoneInput} type="search" aria-label="Fotos durchsuchen" placeholder="Personen, Orte, Dinge, Text" value={q} oninput={e => type(e.currentTarget.value)} autofocus />
        {#if q}<button type="button" class="clear" aria-label="Suche leeren" onclick={() => { type(""); phoneInput?.focus(); }}><Icon name="x" size={14} sw={2.4} /></button>{/if}
      </label>
    </div>
    <div class="pad">{@render whose()}{@render chipRow()}</div>
  </header>
  <div class="pt">{@render results()}</div>
{/if}

<style>
  header { padding: 18px 14px 0; display: flex; flex-direction: column; gap: 12px; }
  .bar { display: flex; align-items: center; gap: 6px; }
  .back { width: 44px; height: 44px; border: 0; background: transparent; display: grid; place-items: center; }
  .field { flex: 1; min-width: 0; height: 48px; display: flex; align-items: center; gap: 10px; padding: 0 6px 0 16px; border-radius: 24px; background: var(--surface); box-shadow: inset 0 0 0 1.5px var(--water); }
  .field :global(svg) { color: var(--muted); flex: none; }
  input { flex: 1; min-width: 0; border: 0; background: transparent; outline: none; font-size: 16px; }
  .clear { width: 36px; height: 36px; flex: none; border: 0; border-radius: 50%; background: var(--surface-2); display: grid; place-items: center; }
  .clear:hover, .x:hover { background: var(--surface-3); }
  .pad { padding-left: 46px; } .pt { padding-top: 18px; }
  .w { padding-top: 8px; } .w .chips { margin-bottom: 10px; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 4px 0 12px; border-radius: 18px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--rule); font-size: 14px; font-weight: 650; }
  .chip.soft { background: var(--water-soft); box-shadow: none; }
  .chip:not(.pl) { padding-left: 4px; gap: 7px; }
  .av { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; }
  .x { width: 28px; height: 28px; border: 0; border-radius: 50%; background: transparent; display: grid; place-items: center; color: var(--muted); position: relative; }
  .x::after { content: ""; position: absolute; inset: -8px; }
  .top { display: flex; align-items: center; justify-content: space-between; padding: 0 14px 10px; }
  .w .top { padding-left: 0; }
  h2 { font-size: 26px; line-height: 1; }
  .sort { display: flex; padding: 3px; border-radius: 19px; background: var(--surface-2); }
  .sort button { height: 36px; padding: 0 12px; border: 0; border-radius: 16px; background: transparent; color: var(--muted); font-size: 13px; font-weight: 650; }
  .sort button[aria-pressed=true] { background: var(--surface); color: var(--ink); box-shadow: 0 1px 2px rgb(34 48 94 / .14); }
  .whose { width: max-content; max-width: 100%; margin-bottom: 10px; }
  .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-auto-rows: auto; gap: 2px; }
  .grid > div { aspect-ratio: 1; min-width: 0; }
  .grid > .hero { grid-column: span 2; grid-row: span 2; }
  .rows { display: flex; flex-direction: column; gap: 4px; } .row { display: flex; gap: 4px; } .row > div { flex: none; }
  .msg { padding: 14px; } .quiet { color: var(--muted); font-size: 13px; padding: 0 14px 10px; } .w .msg { padding-left: 0; }
  .more { padding: 10px 8px 0; }
  .more button { width: 100%; display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 8px 10px; border: 0; border-radius: 14px; background: transparent; text-align: left; }
  .more button:hover { background: var(--surface-2); }
  .two { display: flex; } .two span { width: 40px; height: 40px; border-radius: 8px; box-shadow: 0 0 0 2px var(--ground); } .two span + span { margin-left: -14px; }
  .t { flex: 1; min-width: 0; display: flex; flex-direction: column; } .t b { font-weight: 650; } .t span { font-size: 13px; color: var(--muted); }
  .more :global(svg) { color: var(--muted); }
</style>
