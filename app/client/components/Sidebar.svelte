<script lang="ts">
  import { SECTIONS, FILES, sectionOf, fileOf } from "../lib/nav";
  import { app, light, local, viewing, house, genitive, within } from "../lib/state.svelte";
  import Mark from "./Mark.svelte";
  import { lists, status } from "../lib/stores.svelte";
  import { darkroomStatus } from "../lib/ml-api";
  import { word, count } from "../lib/format";
  import Link from "./Link.svelte";
  import Icon from "./Icon.svelte";
  const cur = $derived(sectionOf(local()));
  const curFile = $derived(fileOf(local()));
  const others = $derived(house.members.filter(m => m.id !== house.me && (m.joined || m.count > 0)));
  const on = $derived(viewing());
  const dr = $derived($darkroomStatus);
  const pending = $derived(status.s ? Math.max(0, status.s.stages.thumbs.total - status.s.stages.thumbs.done) : 0);
  const line = $derived(
    dr.state === "working" ? `Diese Seite analysiert gerade ${dr.files ? (dr.pending === 1 ? "eine Datei" : count(dr.pending, "Datei", "Dateien")) : dr.pending === 1 ? "ein Foto" : count(dr.pending, "Foto", "Fotos")}.` :
    dr.state === "loading" ? "Die Dunkelkammer lädt ihre Modelle." :
    dr.state === "paused" ? "Die Dunkelkammer macht Pause." :
    dr.state === "error" ? "Die Dunkelkammer hat ein Problem." :
    pending ? `${word(pending)} ${pending === 1 ? "Vorschaubild folgt" : "Vorschaubilder folgen"} noch.` : "Alles ist angekommen und analysiert.");
</script>
<nav aria-label="Bereiche">
  {#each SECTIONS as s}
    <Link href={s.path} class="nav" style={s.key === cur ? "color:var(--ink)" : ""} aria-current={s.key === cur ? "page" : undefined}>
      <Icon name={s.key} size={20} />
      <span class="lab">{s.label}{#if s.key === cur}<span aria-hidden="true" class="dab stroke" style="left:-2px;right:-6px;bottom:-3px;height:6px;background:var({s.room});opacity:.7;transform:rotate(-3deg)"></span>{/if}</span>
    </Link>
  {/each}
  <h2 class="files">Dateien</h2>
  {#each FILES as f}
    <Link href={f.path} class="nav" style={f.key === curFile ? "color:var(--ink)" : ""} aria-current={f.key === curFile ? "page" : undefined}>
      <Icon name={f.icon} size={20} />
      <span class="lab">{f.label}{#if f.key === curFile}<span aria-hidden="true" class="dab stroke" style="left:-2px;right:-6px;bottom:-3px;height:6px;background:var({f.room});opacity:.7;transform:rotate(-3deg)"></span>{/if}</span>
    </Link>
  {/each}
  <h2><Link href="/haushalt" class="hh">Haushalt</Link></h2>
  {#if !others.length}<Link href="/haushalt" class="sub">Jemanden einladen</Link>{:else}
    <Link href="/" raw class="who" aria-current={on == null ? "true" : undefined}><Mark size={22} theme={house.members.find(m => m.id === house.me)?.theme} />Meine Fotos</Link>
    {#each others as m (m.id)}
      <Link href={within("/", m.id)} raw class="who" aria-current={on === m.id ? "true" : undefined}><Mark size={22} theme={m.theme} />{genitive(m.name)} Fotos</Link>
    {/each}
  {/if}
  {#if lists.moments.length}
    <h2><Link href="/momente" class="hh">Momente</Link></h2>
    {#each lists.moments.slice(0, 5) as m (m.key)}<Link href="/moment/{m.key}" class="sub">{m.title} <span class="yr tnum">{m.start.slice(0, 4)}</span></Link>{/each}
  {/if}
  {#if lists.series.length}
    <h2>Serien</h2>
    {#each lists.series.slice(0, 6) as s}<Link href="/serie/{s.key}" class="sub">{s.title}</Link>{/each}
  {/if}
  {#if lists.albums.length}
    <h2 class="b">Alben</h2>
    {#each lists.albums.slice(0, 6) as a}<Link href="/alben/{a.id}" class="sub">{a.name}</Link>{/each}
  {/if}
  <Link href="/geraete" class="box">
    <Icon name="check" size={18} sw={2.2} />
    <span><b>{pending ? "Wird gesichert" : "Alles gesichert"}</b><br><span class="m">{line}</span></span>
  </Link>
</nav>
<style>
  nav { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px 0; position: sticky; top: 8px; }
  nav :global(.nav) { display: flex; align-items: center; gap: 11px; height: 44px; padding: 0 10px; border-radius: 10px; color: var(--muted); font-weight: 600; }
  nav :global(.nav:hover) { background: var(--surface-2); color: var(--ink); }
  .lab { position: relative; }
  /* the mark of the current room is painted with one stroke */
  .lab .dab { animation: brush .333s cubic-bezier(.3,.7,.2,1) both; }
  @keyframes brush { from { clip-path: inset(0 100% 0 0 round 3px); } to { clip-path: inset(0 0 0 0 round 3px); } }
  h2 { font-size: 20px; padding: 20px 10px 4px; }
  h2 :global(.hh:hover) { text-decoration: underline; text-underline-offset: 4px; text-decoration-thickness: 1px; } h2.b { padding-top: 16px; }
  nav :global(.sub) { display: block; padding: 5px 10px; min-height: 32px; border-radius: 8px; font-size: 14px; }
  nav :global(.sub:hover) { background: var(--surface-2); }
  nav :global(.who) { display: flex; align-items: center; gap: 9px; min-height: 38px; padding: 4px 10px; border-radius: 10px; font-size: 14px; color: var(--muted); font-weight: 600; }
  nav :global(.who:hover) { background: var(--surface-2); color: var(--ink); }
  nav :global(.who[aria-current]) { color: var(--ink); background: var(--surface); box-shadow: inset 0 0 0 1px var(--rule); }
  nav :global(.box) { margin-top: 24px; display: flex; gap: 10px; padding: 12px; border-radius: 14px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--rule); font-size: 13.5px; line-height: 1.35; }
  nav :global(.box svg) { flex: none; margin-top: 1px; color: var(--water); }
  .box b { font-weight: 650; } .m { color: var(--muted); }
  .yr { color: var(--muted); font-size: 12.5px; }
</style>
