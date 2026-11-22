<script lang="ts">
  // Fotos: the whole library as days. Phone per Phone-Fotos, desktop per Desktop-Fotos.
  import { tick, onMount } from "svelte";
  import { app, sel, selectEnd, view, light, viewing, member, house, genitive, within } from "../lib/state.svelte";
  import { tl, loadMore, band, loadBand, status, lists, refreshTimeline } from "../lib/stores.svelte";
  import { gone } from "../lib/actions.svelte";
  import { ids } from "../lib/layout";
  import { up } from "../lib/upload.svelte";
  import { clock, ago, word, num } from "../lib/format";
  import Timeline from "../components/Timeline.svelte";
  import Band from "../components/Band.svelte";
  import Link from "../components/Link.svelte";
  import Icon from "../components/Icon.svelte";
  import Pic from "../components/Pic.svelte";
  import Loading from "../components/Loading.svelte";
  import { arrive, visibleIds } from "../lib/motion";

  const days = $derived(tl.days.map(d => ({ ...d, items: d.items.filter(i => !gone.has(i.id)) })).filter(d => d.items.length));
  $effect(() => { view.ids = ids(days); });
  let t: Timeline | undefined = $state();

  onMount(() => {
    if (!tl.loaded) loadMore(16).then(() => loadMore(24));
    if (!band.loaded) loadBand();
    band.jump = jumpTo;
    // during and after an upload the new photos paint themselves in, the ones already there stay as they are
    const fresh = () => {
      const seen = new Set(visibleIds());
      refreshTimeline().then(ok => ok && tick().then(() => arrive(id => !seen.has(id)))); loadBand();
    };
    addEventListener("monet-uploaded", fresh);
    return () => { band.jump = null; removeEventListener("monet-uploaded", fresh); };
  });

  let token = 0;
  async function jumpTo(ym: string) {
    const my = ++token;
    const find = () => days.findIndex(d => d.date.slice(0, 7) <= ym);
    let i = find();
    while (i < 0 && tl.next && my === token) { if (!await loadMore(60)) { await new Promise(r => setTimeout(r, 120)); } i = find(); }
    if (my !== token) return;
    await tick();
    t?.scrollToDay(i < 0 ? days.length - 1 : i);
  }
  const onpos = (date: string) => { band.current = date.slice(0, 7); };

  // after two screens down a button leads back to the newest photos
  let far = $state(false);
  $effect(() => {
    const check = () => { far = scrollY > innerHeight * 2; };
    check(); addEventListener("scroll", check, { passive: true });
    return () => removeEventListener("scroll", check);
  });
  const toTop = () => scrollTo({ top: 0, behavior: "auto" });

  const sunk = $derived(status.s);
  const pending = $derived(sunk ? Math.max(0, sunk.stages.thumbs.total - sunk.stages.thumbs.done) : 0);
  const line = $derived.by(() => {
    const busy = up.total > 0 && up.done + up.skipped + up.failed < up.total;
    if (busy) return `Lädt hoch: ${num(up.done + up.skipped + up.failed)} von ${num(up.total)}`;
    if (!sunk) return "Gesichert";
    const same = sunk.lastUpload && new Date(sunk.lastUpload).toDateString() === new Date().toDateString();
    const base = sunk.lastUpload ? (same ? `Bis ${clock(sunk.lastUpload)} alles gesichert` : `Zuletzt gesichert ${ago(sunk.lastUpload)}`) : "Noch nichts gesichert";
    return pending ? `${base}, ${word(pending)} ${pending === 1 ? "Foto folgt" : "Fotos folgen"}` : base;
  });
  const serie = $derived(lists.series[0]);
  const guest = $derived(viewing() != null ? member(viewing()) : undefined);
  const joined = $derived(house.members.filter(m => m.id === house.me || m.joined || m.count > 0));
</script>

{#if app.wide}
  {#if tl.loaded && !days.length}
    <p class="empty">Noch keine Fotos hier. Ziehe Fotos in das Fenster oder wähle oben „Importieren“.</p>
  {/if}
  <Timeline bind:this={t} {days} wide {onpos} onend={() => loadMore()} />
{:else}
  <header>
    <div class="row">
      <div class="ttl">
        <span aria-hidden="true" class="dab" style="left:-2px;bottom:2px;width:70px;height:10px;background:var(--teich);opacity:.55;transform:rotate(-3deg)"></span>
        <span aria-hidden="true" class="dab" style="left:40px;bottom:-1px;width:46px;height:8px;background:var(--water);opacity:.45;transform:rotate(4deg)"></span>
        <h1>{guest ? `${genitive(guest.name)} Fotos` : "Fotos"}</h1>
      </div>
      <span class="acts">
        <button type="button" class="pill" onclick={() => (sel.on ? selectEnd() : (sel.on = true))}>{sel.on ? "Fertig" : "Auswählen"}</button>
        <Link href="/haushalt" class="set" aria-label="Einstellungen: Stil, Haushalt, Geräte"><Icon name="stil" size={22} /></Link>
      </span>
    </div>
    {#if !guest}<Link href="/geraete" class="status"><Icon name="cloud" size={16} />{line}</Link>{/if}
    {#if joined.length > 1}
      <div class="house" role="list" aria-label="Wessen Fotos">
        {#each joined as m (m.id)}
          <span role="listitem"><Link href={within("/", m.id)} raw class="hm" aria-current={(viewing() ?? house.me) === m.id ? "true" : undefined}>{m.id === house.me ? "Meine" : m.name}</Link></span>
        {/each}
      </div>
    {/if}
  </header>
  {#if serie && serie.items.length}
    <Link href="/serie/{serie.key}" class="serie" aria-label="Serie: {serie.title}, {serie.subtitle}">
      <span class="st"><span class="t">{serie.title}</span><span class="s tnum">{serie.subtitle}</span></span>
      <span class="hung">
        {#each serie.items.slice(0, 6) as s}
          <span class="f"><span class="pic"><Pic id={s.id} w={4} h={5} sizes="60px" /></span><span class="tnum y">{s.year}</span></span>
        {/each}
      </span>
    </Link>
  {/if}
  <div class="tlwrap">
    {#if tl.loaded && !days.length}<p class="empty">Noch keine Fotos hier. Importiere welche auf der Seite Geräte.</p>{/if}
    <Timeline bind:this={t} {days} wide={false} {onpos} onend={() => loadMore()} />
  </div>
  {#if !tl.loaded}<Loading text="Die Fotos kommen" />{/if}
  {#if tl.error}<p class="empty" role="alert">{tl.error}</p>{/if}
  {#if band.loaded}<Band vertical />{/if}
  <Link href="/suche" class="searchpill"><Icon name="suche" size={20} sw={1.9} />Personen, Orte, Dinge, Text</Link>
{/if}
{#if far && !sel.on}
  <button type="button" class="top" class:phone={!app.wide} aria-label="Nach oben, zu den neuesten Fotos" title="Nach oben" onclick={toTop}><Icon name="hoch" size={22} sw={2} /></button>
{/if}

<style>
  header { padding: 22px 18px 6px; display: flex; flex-direction: column; gap: 4px; }
  .row { display: flex; align-items: flex-end; justify-content: space-between; }
  .ttl { position: relative; } h1 { position: relative; font-size: 40px; line-height: 1; }
  .acts { display: flex; gap: 6px; }
  .acts :global(.set) { width: 44px; height: 44px; display: grid; place-items: center; border-radius: 22px; background: var(--surface-2); color: var(--ink); }
  .pill { height: 44px; padding: 0 14px; border: 0; border-radius: 22px; background: var(--surface-2); font-size: 14px; font-weight: 650; }
  .house { display: flex; gap: 6px; padding-top: 6px; overflow-x: auto; }
  .house :global(.hm) { min-height: 36px; display: inline-flex; align-items: center; padding: 0 14px; border-radius: 18px; background: var(--surface-2); color: var(--muted); font-size: 14px; font-weight: 650; white-space: nowrap; }
  .house :global(.hm[aria-current]) { background: var(--ink); color: var(--on-ink); }
  header :global(.status) { display: flex; align-items: center; gap: 6px; min-height: 28px; font-size: 13px; color: var(--muted); }
  :global(.serie) { display: flex; flex-direction: column; gap: 8px; margin: 10px 14px 4px; padding: 12px 12px 10px; border-radius: 16px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--rule); }
  .st { display: flex; flex-direction: column; line-height: 1.15; } .t { font-family: var(--font-display); font-size: 22px; } .s { font-size: 12.5px; color: var(--muted); }
  .hung { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 5px; }
  .f { display: flex; flex-direction: column; align-items: center; gap: 3px; }
  .pic { display: block; width: 100%; aspect-ratio: 4 / 5; border-radius: 3px; overflow: hidden; box-shadow: 0 1px 2px rgb(34 48 94 / .18); }
  :global(.serie:hover) .pic { transform: translateY(-1px); }
  .y { font-size: 11px; color: var(--muted); }
  .tlwrap { padding-right: 22px; }
  .empty { padding: 28px 18px; color: var(--muted); }
  :global(.searchpill) { position: fixed; z-index: 15; left: 14px; right: 14px; bottom: calc(max(18px, env(safe-area-inset-bottom)) + 76px + var(--player-h, 0px)); height: 50px; display: flex; align-items: center; gap: 10px; padding: 0 18px; border-radius: 25px; background: var(--glass); backdrop-filter: blur(20px) saturate(1.4); -webkit-backdrop-filter: blur(20px) saturate(1.4); box-shadow: inset 0 0 0 1px var(--rule), var(--shadow); color: var(--muted); font-size: 15px; }
  .top { position: fixed; z-index: 16; right: 28px; bottom: calc(28px + var(--player-h, 0px)); width: 48px; height: 48px; display: grid; place-items: center; border: 0; border-radius: 24px; background: var(--glass); backdrop-filter: blur(20px) saturate(1.4); -webkit-backdrop-filter: blur(20px) saturate(1.4); box-shadow: inset 0 0 0 1px var(--rule), var(--shadow); color: var(--ink); cursor: pointer; }
  .top:hover { box-shadow: inset 0 0 0 1.5px var(--water), var(--shadow); }
  .top.phone { right: 26px; bottom: calc(max(18px, env(safe-area-inset-bottom)) + 136px + var(--player-h, 0px)); }
  :global(.searchpill:hover) { box-shadow: inset 0 0 0 1.5px var(--water), var(--shadow); }
</style>
