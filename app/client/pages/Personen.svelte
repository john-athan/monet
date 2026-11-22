<script lang="ts">
  // Personen: the yellow naming card for the first nameless face group, a merge suggestion, the named people.
  import { onMount } from "svelte";
  import { people, loadPeople, loadLists } from "../lib/stores.svelte";
  import { post } from "../lib/api";
  import { toast } from "../lib/state.svelte";
  import { num, count } from "../lib/format";
  import PageHead from "../components/PageHead.svelte";
  import Link from "../components/Link.svelte";
  import Loading from "../components/Loading.svelte";
  import Known from "../components/Known.svelte";
  import SameName, { namesakes } from "../components/SameName.svelte";
  onMount(() => { loadPeople(true); });
  const read = (k: string) => { try { return JSON.parse(sessionStorage.getItem(k) ?? "[]") as string[]; } catch { return []; } };
  let later = $state<string[]>(read("monet-spaeter")), no = $state<string[]>(read("monet-nein"));
  const save = (k: string, v: string[]) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const p = $derived(people.p);
  const card = $derived(p?.unnamed.find(u => !later.includes(String(u.id))) ?? null);
  const sug = $derived(p?.suggestions.find(s => !no.includes(`${s.unnamed}-${s.named}`) && p!.unnamed.some(u => u.id === s.unnamed) && p!.named.some(n => n.id === s.named)) ?? null);
  const sugNamed = $derived(sug ? p!.named.find(n => n.id === sug.named)! : null), sugUn = $derived(sug ? p!.unnamed.find(u => u.id === sug.unnamed)! : null);
  let name = $state(""), busy = $state(false);
  const when = (iso: string, place: string | null) => {
    const d = new Date(iso + "T12:00:00Z"), same = d.getUTCFullYear() === new Date().getFullYear();
    return `${new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", ...(same ? {} : { year: "numeric" }), timeZone: "UTC" }).format(d)}${place ? " in " + place : ""}`;
  };
  async function act(fn: () => Promise<unknown>, done?: string) {
    busy = true;
    try { await fn(); await loadPeople(true); loadLists(); if (done) toast(done); } catch (e: any) { toast(e.message); } finally { busy = false; name = ""; }
  }
  // a name someone already has asks first: usually the face grouping found the same person twice
  let asking = $state<string | null>(null);
  const matches = $derived(asking && card && p ? namesakes(p.named, asking, card.id) : []);
  const nameIt = (e: Event) => {
    e.preventDefault(); const n = name.trim(); if (!n || !card || !p) return;
    if (namesakes(p.named, n, card.id).length) { asking = n; return; }
    act(() => post(`/api/people/${card.id}`, { name: n }), `${n} ist benannt.`);
  };
  const intoNamesake = (into: { id: number; name: string }) => { const c = card; asking = null; if (c) act(() => post("/api/people/merge", { from: c.id, into: into.id }), `Zu ${into.name} hinzugefügt.`); };
  const newNamesake = () => { const n = asking, c = card; asking = null; if (n && c) act(() => post(`/api/people/${c.id}`, { name: n }), `${n} ist benannt.`); };
  const skip = () => { if (!card) return; asking = null; later = [...later, String(card.id)]; save("monet-spaeter", later); name = ""; };
  const hide = () => { if (card) act(() => post(`/api/people/${card.id}`, { hidden: true }), "Ausgeblendet."); };
  const yes = () => { if (sug) act(() => post("/api/people/merge", { from: sug.unnamed, into: sug.named }), `Zu ${sugNamed!.name} hinzugefügt.`); };
  // one face in the card is not this person: it leaves the group, or goes straight to someone already named
  let picked = $state<number | null>(null);
  $effect(() => { if (card && picked != null && !card.faces.includes(picked)) picked = null; });
  const pick = (f: number) => { picked = picked === f ? null : f; };
  const moveTo = (to: { id: number; name: string } | null) => {
    const f = picked; picked = null;
    if (f != null) act(() => post(`/api/faces/${f}`, { personId: to?.id ?? null }), to ? `Zu ${to.name} verschoben.` : "Aus der Gruppe genommen.");
  };
  const nope = () => { if (sug) { no = [...no, `${sug.unnamed}-${sug.named}`]; save("monet-nein", no); } };
</script>

<PageHead title="Personen" room="--esszimmer" sub={p ? `${num(p.named.length)} mit Namen, ${num(p.unnamed.length)} noch ohne` : ""} />
{#if !p}<Loading text="Die Gesichter kommen" />{:else}
  <div class="page">
    {#if card}
      <section aria-label="Eine Person benennen" class="card">
        <div class="who">
          <img class="big" src="/media/face/{card.faces[0]}" alt="" width="88" height="88" />
          <div class="tx"><h2>Wer ist das?</h2><p class="tnum m">Auf {count(card.count, "Foto", "Fotos")}, zuletzt am {when(card.last.date, card.last.place)}</p></div>
        </div>
        <div class="crops">{#each card.faces.slice(0, 6) as f, i (f)}<button type="button" class="crop" class:on={picked === f} aria-pressed={picked === f} aria-label="Gesicht {i + 1} von {Math.min(6, card.faces.length)}: gehört nicht dazu?" onclick={() => pick(f)}><img src="/media/face/{f}" alt="" width="60" height="60" /></button>{/each}</div>
        {#if picked != null}
          <div class="fix" role="group" aria-label="Dieses Gesicht">
            <button type="button" class="out" disabled={busy} onclick={() => moveTo(null)}>Gehört nicht dazu</button>
            {#if p.named.length}
              <p class="m">Oder ist es jemand von diesen?</p>
              <Known named={p.named} {busy} onpick={moveTo} />
            {/if}
          </div>
        {/if}
        <form onsubmit={nameIt}>
          <label>Name<input type="text" bind:value={name} oninput={() => (asking = null)} placeholder="z. B. Tante Vroni" autocomplete="off" /></label>
          <div class="btns">
            <button type="submit" class="ink" disabled={busy || !name.trim()}>Benennen</button>
            <button type="button" class="ghost" onclick={skip}>Später</button>
            <button type="button" class="ghost" disabled={busy} onclick={hide}>Ausblenden</button>
          </div>
          {#if asking && matches.length}<SameName name={asking} {matches} {busy} onmerge={intoNamesake} onnew={newNamesake} />{/if}
        </form>
      </section>
    {/if}
    {#if sug && sugNamed && sugUn}
      <section aria-label="Zusammenführen" class="merge">
        <span class="pair"><img src="/media/face/{sugNamed.face}" alt="" width="40" height="40" /><img src="/media/face/{sugUn.faces[0]}" alt="" width="40" height="40" /></span>
        <p><b>Auch {sugNamed.name}?</b> <span class="m">{count(sug.count, "Foto", "Fotos")} könnten dazugehören</span></p>
        <button type="button" class="s2" disabled={busy} onclick={yes}>Ja</button>
        <button type="button" class="s0" onclick={nope}>Nein</button>
      </section>
    {/if}
    {#if p.named.length}
      <section aria-label="Benannte Personen" class="people">
        {#each p.named as n (n.id)}
          <Link href="/personen/{n.id}" class="who2">
            {#if n.face}<img class="ring" src="/media/face/{n.face}" alt="" width="84" height="84" />{:else}<span class="ring ph"></span>{/if}
            <span class="nm"><span class="n">{n.name}</span><span class="tnum c">{count(n.count, "Foto", "Fotos")}</span></span>
          </Link>
        {/each}
      </section>
    {:else if !card}<p class="m pad">Sobald die Gesichter erkannt sind, erscheinen sie hier.</p>{/if}
  </div>
{/if}

<style>
  .page { display: flex; flex-direction: column; }
  .m { color: var(--muted); } .pad { padding: 14px; }
  .card { margin: 10px 14px 0; padding: 16px; border-radius: 20px; background: var(--ess-soft); box-shadow: inset 0 0 0 1px var(--ess-rule); display: flex; flex-direction: column; gap: 14px; }
  .who { display: flex; gap: 14px; align-items: center; }
  .big { width: 88px; height: 88px; flex: none; border-radius: 50%; object-fit: cover; box-shadow: 0 0 0 3px var(--surface); }
  .tx { display: flex; flex-direction: column; gap: 2px; } h2 { font-size: 28px; line-height: 1.05; } .tx p { font-size: 13.5px; }
  .crops { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 6px; } .crop { padding: 0; border: 0; border-radius: 50%; background: none; cursor: pointer; }
  .crops img { display: block; width: 100%; height: auto; aspect-ratio: 1; border-radius: 50%; object-fit: cover; }
  .crop:hover img { box-shadow: 0 0 0 3px var(--surface); } .crop.on img { box-shadow: 0 0 0 3px var(--esszimmer); }
  .fix { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 12px; border-radius: 16px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--rule); }
  .fix p { font-size: 13.5px; }
  .out { min-height: 44px; padding: 0 16px; border: 0; border-radius: 22px; background: var(--surface-2); font-weight: 650; } .out:hover:not(:disabled) { background: var(--surface-3); }
  .out:disabled { opacity: .5; }
  form { display: flex; flex-direction: column; gap: 14px; } label { display: flex; flex-direction: column; gap: 5px; font-size: 13px; font-weight: 650; }
  input { height: 46px; padding: 0 14px; border: 0; border-radius: 12px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--ess-rule); font-size: 16px; font-weight: 400; }
  .btns { display: flex; gap: 8px; }
  .btns button { height: 46px; border: 0; border-radius: 23px; font-weight: 650; padding: 0 16px; }
  .ink { flex: 1; background: var(--ink); color: var(--on-ink); } .ink:hover:not(:disabled) { background: var(--water); } .ink:disabled { opacity: .5; }
  .ghost { background: transparent; box-shadow: inset 0 0 0 1.5px var(--ess-rule); } .ghost:hover { background: var(--surface); }
  .merge { margin: 12px 14px 0; display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 16px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--rule); }
  .pair { display: flex; flex: none; } .pair img { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; box-shadow: 0 0 0 2px var(--surface); } .pair img + img { margin-left: -10px; }
  .merge p { flex: 1; min-width: 0; font-size: 14px; line-height: 1.3; } .merge b { font-weight: 650; }
  .merge button { min-height: 44px; border: 0; border-radius: 22px; font-size: 14px; font-weight: 650; }
  .s2 { padding: 0 16px; background: var(--surface-2); } .s2:hover { background: var(--surface-3); } .s0 { padding: 0 12px; background: transparent; color: var(--muted); }
  .people { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px 8px; padding: 20px 14px 0; }
  .people :global(.who2) { display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .ring { width: 84px; height: 84px; border-radius: 50%; object-fit: cover; background: var(--surface-2); }
  .people :global(.who2:hover .ring) { box-shadow: 0 0 0 3px var(--esszimmer); }
  .nm { display: flex; flex-direction: column; align-items: center; line-height: 1.2; } .n { font-weight: 650; } .c { font-size: 12.5px; color: var(--muted); }
  @media (min-width: 900px) {
    .card, .merge { margin-left: 0; margin-right: 0; max-width: 640px; }
    .people { grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); padding: 24px 0 0; gap: 22px 12px; }
    .ring { width: 112px; height: 112px; }
  }
</style>
