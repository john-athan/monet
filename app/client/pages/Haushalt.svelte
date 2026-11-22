<script lang="ts">
  // Haushalt: your name and your style, and the people who share this Monet. Everyone sees everyone's photos;
  // each person changes only their own. Whoever verwaltet invites, makes a new link for a lost phone, and takes
  // access away (the accounts module's rules, docs/accounts.md). A link makes a passkey for the person it names.
  import type { Theme } from "../../shared/types";
  import type { AccountLink, AccountMember } from "../../shared/accounts";
  import { api, post } from "../lib/api";
  import { house, loadHousehold, toast, genitive, within } from "../lib/state.svelte";
  import { THEMES, themeOf } from "../lib/theme";
  import { count } from "../lib/format";
  import Icon from "../components/Icon.svelte";
  import Link from "../components/Link.svelte";
  import Mark from "../components/Mark.svelte";

  const me = $derived(house.members.find(m => m.id === house.me));
  const others = $derived(house.members.filter(m => m.id !== house.me));
  let name = $state(""), named = false;
  $effect(() => { if (me && !named) { name = me.name; named = true; } });
  let guestName = $state(""), guestTheme = $state<Theme>("monet"), busy = $state(false);
  let link = $state<AccountLink | null>(null), linkFor = $state(""), asking = $state<string | null>(null);
  const until = (ms: number) => new Date(ms).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
  let accs = $state<AccountMember[]>([]);
  const acc = (id: number) => accs.find(a => a.id === id);
  const admin = $derived(acc(house.me)?.role === "admin");
  const admins = $derived(accs.filter(a => a.role === "admin").map(a => a.name));
  async function loadAll() { await loadHousehold(); try { accs = await api<AccountMember[]>("/api/members"); } catch {} }
  $effect(() => { loadAll(); });

  async function save(b: { name?: string; theme?: Theme }) {
    try { await api("/api/household/me", { method: "PATCH", json: b }); await loadHousehold(); } catch (e: any) { toast(e.message); }
  }
  async function rename(e: Event) { e.preventDefault(); if (name.trim() && name.trim() !== me?.name) { await save({ name: name.trim() }); toast("Dein Name ist gespeichert."); } }
  async function invite(e: Event) {
    e.preventDefault(); if (!guestName.trim()) return; busy = true;
    try { link = await post<AccountLink>("/api/members", { name: guestName.trim(), theme: guestTheme }); linkFor = guestName.trim(); guestName = ""; await loadAll(); }
    catch (err: any) { toast(err.message); } finally { busy = false; }
  }
  async function again(id: number, who: string) { try { link = await post<AccountLink>(`/api/members/${id}/link`); linkFor = who; asking = null; await loadAll(); } catch (e: any) { toast(e.message); } }
  async function setRole(id: number, role: "admin" | "member") { try { await api(`/api/members/${id}`, { method: "PATCH", json: { role } }); asking = null; await loadAll(); } catch (e: any) { toast(e.message); } }
  async function remove(id: number, who: string) {
    try {
      const r = await api<{ result: "deleted" | "revoked" }>(`/api/members/${id}`, { method: "DELETE" });
      if (link?.member === id) link = null;
      asking = null; await loadAll();
      toast(r.result === "deleted" ? `Die Einladung für ${who} ist zurückgezogen.` : `${who} hat keinen Zugang mehr. Die Fotos bleiben.`);
    } catch (e: any) { toast(e.message); }
  }
  const ask = (k: string) => (asking = asking === k ? null : k);
  const standing = (id: number, joined: boolean) => {
    const a = acc(id);
    if (!a) return joined ? "" : "eingeladen, noch kein Passkey";
    const r = a.role === "admin" ? ", verwaltet" : "";
    if (a.status === "active") return r;
    if (a.status === "invited") return a.link ? `${r}, eingeladen bis ${until(a.link.expiresAt)}` : `${r}, eingeladen`;
    return `${r}, ohne Zugang`;
  };
  const linkText = $derived(!link ? "" : link.purpose === "join" ? `Schick ${linkFor} diesen Link. Er gilt bis ${until(link.expiresAt)} und nur einmal; damit legt ${linkFor} den eigenen Passkey an.`
    : link.purpose === "recover" ? `Schick ${linkFor} diesen Link. Er gilt bis ${until(link.expiresAt)} und nur einmal; der neue Passkey ersetzt die bisherigen von ${linkFor} und meldet alle Browser ab.`
    : `Öffne diesen Link auf dem anderen Gerät. Er gilt eine Stunde und nur einmal.`);
  async function copy() { if (!link) return; try { await navigator.clipboard.writeText(link.link); toast("Der Link ist kopiert."); } catch { toast("Kopieren ging nicht. Markiere den Link von Hand."); } }
</script>

<div class="page">
  <header><Link href="/" class="back"><Icon name="back" size={20} sw={2} />Fotos</Link></header>
  <div class="in">
    <div class="head">
      <h1>Haushalt</h1>
      <p class="sub">Alle hier sehen die Fotos der anderen. Ändern kann jede und jeder nur die eigenen.</p>
    </div>

    <section aria-labelledby="h-stil">
      <h2 id="h-stil" class="h">Dein Stil</h2>
      <p class="m">So sehen deine Fotos aus, für dich und für alle, die sie ansehen.</p>
      <div class="styles" role="radiogroup" aria-label="Dein Stil" style="--ring:var(--sun)">
        {#each THEMES as t (t.key)}
          <button type="button" role="radio" aria-checked={me?.theme === t.key} class="style" style={t.swatch} onclick={() => save({ theme: t.key })}>
            <span class="scene" aria-hidden="true">
              <Mark size={64} theme={t.key} />
              <span class="bars"><span style="background:var(--teich)"></span><span style="background:var(--esszimmer)"></span><span style="background:var(--garten)"></span><span style="background:var(--atelier)"></span></span>
            </span>
            <span class="nm">{t.painter}</span>
            <span class="mo">{t.motif}</span>
            {#if me?.theme === t.key}<span class="on"><Icon name="check" size={14} sw={2.6} />Dein Stil</span>{/if}
          </button>
        {/each}
      </div>
    </section>

    <div class="cols">
      <section aria-labelledby="h-name" class="col">
        <h2 id="h-name" class="h">Dein Name</h2>
        <form onsubmit={rename}><input type="text" bind:value={name} maxlength="40" aria-label="Dein Name" /><button type="submit" class="ghost">Speichern</button></form>
        <p class="m small">Unter diesem Namen sehen die anderen deine Fotos.</p>
      </section>

      <section aria-labelledby="h-wer" class="col">
        <h2 id="h-wer" class="h">Wer dabei ist</h2>
        <div class="list">
          {#if me}
            <div class="row">
              <Mark size={36} theme={me.theme} /><span class="tx"><b>{me.name}</b><span class="m small">Du, {themeOf(me.theme).painter}, {count(me.count, "Foto", "Fotos")}{standing(me.id, true)}</span></span>
              {#if admin && admins.length > 1}{#if asking === `r${me.id}`}<button type="button" class="danger" onclick={() => setRole(me.id, "member")}>Wirklich abgeben</button>{:else}<button type="button" class="quiet" onclick={() => ask(`r${me.id}`)}>Verwaltung abgeben</button>{/if}{/if}
            </div>
          {/if}
          {#each others as m (m.id)}
            {@const a = acc(m.id)}
            <div class="row">
              <Mark size={36} theme={m.theme} />
              <span class="tx"><b>{m.name}</b><span class="m small">{themeOf(m.theme).painter}{m.joined || m.count ? `, ${count(m.count, "Foto", "Fotos")}` : ""}{standing(m.id, m.joined)}</span></span>
              {#if m.joined || m.count}<Link href={within("/", m.id)} raw class="chipb">{genitive(m.name)} Fotos</Link>{/if}
              {#if admin && a}
                <span class="acts">
                  <button type="button" class="quiet" onclick={() => again(m.id, m.name)}>{a.status === "active" ? "Neuer Passkey" : "Neuer Link"}</button>
                  {#if a.status === "active"}<button type="button" class="quiet" onclick={() => setRole(m.id, a.role === "admin" ? "member" : "admin")}>{a.role === "admin" ? "Verwaltung nehmen" : "Verwalten lassen"}</button>{/if}
                  {#if asking === `x${m.id}`}<button type="button" class="danger" onclick={() => remove(m.id, m.name)}>{a.status === "active" ? "Wirklich Zugang nehmen" : "Wirklich zurückziehen"}</button>
                  {:else if a.status !== "none"}<button type="button" class="quiet" onclick={() => ask(`x${m.id}`)}>{a.status === "active" ? "Zugang nehmen" : "Zurückziehen"}</button>{/if}
                </span>
              {/if}
            </div>
          {/each}
        </div>
        {#if admin}
          <form onsubmit={invite} class="inv">
            <input type="text" bind:value={guestName} maxlength="40" placeholder="Name" aria-label="Name der neuen Person" />
            <select bind:value={guestTheme} aria-label="Stil der neuen Person">{#each THEMES as t}<option value={t.key}>{t.painter}</option>{/each}</select>
            <button type="submit" class="ghost" disabled={busy || !guestName.trim()}>Einladen</button>
          </form>
        {:else if admins.length}
          <p class="m small">Einladen und einen neuen Passkey für ein verlorenes Telefon geben kann, wer hier verwaltet: {admins.join(", ")}.</p>
        {/if}
        {#if link}
          <div class="link" role="status">
            <p>{linkText}</p>
            <code>{link.link}</code>
            <button type="button" class="ghost" onclick={copy}>Link kopieren</button>
          </div>
        {/if}
      </section>
    </div>
  </div>
</div>

<style>
  .page { padding: 18px 24px 48px; min-height: 100dvh; }
  header { max-width: 1180px; margin: 0 auto; display: flex; align-items: center; }
  header :global(.back) { height: 44px; display: inline-flex; align-items: center; gap: 6px; padding: 0 12px 0 6px; border-radius: 22px; font-weight: 600; }
  header :global(.back:hover) { background: var(--surface-2); }
  .in { max-width: 1180px; margin: 0 auto; display: flex; flex-direction: column; gap: 36px; padding-top: 14px; }
  .head { display: flex; flex-direction: column; gap: 6px; }
  h1 { font-size: clamp(36px, 7vw, 52px); line-height: 1.05; } .sub { font-size: 17px; color: var(--muted); }
  .h { font-size: 30px; margin-bottom: 6px; } .m { color: var(--muted); } .small { font-size: 13px; }
  .styles { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 12px; }
  .style { position: relative; flex: 1 1 260px; max-width: 420px; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 0 0 16px; border: 0; border-radius: 18px; overflow: hidden; text-align: left; background: var(--surface); color: var(--ink); box-shadow: inset 0 0 0 1px var(--rule); }
  .style[aria-checked=true] { box-shadow: inset 0 0 0 2.5px var(--ink), 0 0 0 3px var(--ring); }
  .style:hover { filter: brightness(1.02); }
  .scene { width: 100%; display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; padding: 18px 18px 14px; background: var(--ground); margin-bottom: 8px; }
  .bars { display: flex; gap: 5px; } .bars span { width: 16px; height: 40px; border-radius: 3px; }
  .nm { padding: 0 18px; font-family: var(--font-display); font-size: 26px; line-height: 1.1; } .mo { padding: 0 18px; font-size: 14px; color: var(--muted); }
  .on { position: absolute; top: 12px; right: 12px; display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 10px; border-radius: 13px; background: var(--ink); color: var(--surface); font-size: 12.5px; font-weight: 650; }
  .cols { display: flex; flex-wrap: wrap; gap: 28px; align-items: flex-start; }
  .col { flex: 1 1 400px; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
  .list { border-radius: 18px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--rule); }
  .row { display: flex; align-items: center; gap: 14px; padding: 14px 18px; flex-wrap: wrap; } .row + .row { border-top: 1px solid var(--rule); }
  .tx { flex: 1; min-width: 140px; display: flex; flex-direction: column; } .tx b { font-weight: 650; }
  .acts { display: flex; flex-wrap: wrap; gap: 2px; flex-basis: 100%; padding-left: 50px; }
  .danger { min-height: 40px; padding: 0 14px; border: 0; border-radius: 20px; background: var(--sun); color: var(--deep); font-weight: 700; font-size: 14px; }
  form { display: flex; flex-wrap: wrap; gap: 8px; }
  input, select { flex: 1 1 140px; min-width: 0; height: 44px; padding: 0 14px; border: 0; border-radius: 12px; background: var(--surface); color: var(--ink); box-shadow: inset 0 0 0 1px var(--rule); font: inherit; font-size: 16px; }
  select { flex: 0 1 180px; }
  .ghost { min-height: 44px; padding: 0 16px; border: 0; border-radius: 22px; background: transparent; box-shadow: inset 0 0 0 1.5px var(--rule); font-weight: 650; } .ghost:hover { background: var(--surface-2); } .ghost:disabled { opacity: .5; }
  .quiet { min-height: 40px; padding: 0 12px; border: 0; border-radius: 20px; background: transparent; color: var(--muted); font-weight: 600; font-size: 14px; } .quiet:hover { background: var(--surface-2); color: var(--ink); }
  .list :global(.chipb) { min-height: 36px; display: inline-flex; align-items: center; padding: 0 14px; border-radius: 18px; background: var(--surface-2); font-size: 13.5px; font-weight: 650; }
  .list :global(.chipb:hover) { background: var(--surface-3); }
  .link { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; padding: 16px 18px; border-radius: 18px; background: var(--ess-soft); box-shadow: inset 0 0 0 1px var(--ess-rule); }
  code { display: block; max-width: 100%; overflow-x: auto; padding: 10px 12px; border-radius: 10px; background: var(--surface); font-size: 13px; white-space: nowrap; }
  @media (max-width: 899px) { .page { padding: 12px 14px 40px; } }
</style>
