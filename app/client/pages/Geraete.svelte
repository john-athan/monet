<script lang="ts">
  // Geräte und Sicherung per Desktop-Geraete: where the photos live, which devices send them, how far the analysis is.
  import type { DeviceOut } from "../../shared/types";
  import type { AccountLink, AccountPasskey, AccountSession } from "../../shared/accounts";
  import { api, post } from "../lib/api";
  import { app, go, toast } from "../lib/state.svelte";
  import { status, loadStatus } from "../lib/stores.svelte";
  import { darkroomStatus } from "../lib/ml-api";
  import { deviceLabel, logout as signOut, register, passkeyMessage, passkeysSupported } from "../lib/passkeys";
  import { ago, bytes, num, count } from "../lib/format";
  import Icon from "../components/Icon.svelte";
  import Link from "../components/Link.svelte";
  import ImportSheet from "../components/ImportSheet.svelte";

  let devices = $state<DeviceOut[]>([]), sessions = $state<AccountSession[]>([]), creds = $state<AccountPasskey[]>([]);
  let importing = $state(false), asking = $state<string | null>(null), pair = $state<{ code: string; expiresAt: number } | null>(null), now = $state(Date.now());
  let keyName = $state(deviceLabel()), busy = $state(false), addLink = $state<AccountLink | null>(null);
  const s = $derived(status.s);
  async function load() {
    loadStatus();
    [devices, sessions, creds] = await Promise.all([api<DeviceOut[]>("/api/devices").catch(() => []), api<AccountSession[]>("/api/sessions").catch(() => []), api<AccountPasskey[]>("/api/passkeys").catch(() => [])]);
  }
  $effect(() => { load(); const t = setInterval(() => { now = Date.now(); }, 1000); return () => clearInterval(t); });

  const live = $derived(devices.filter(d => !d.revokedAt));
  const mac = $derived(live.find(d => d.kind === "mac"));
  const chain = $derived([
    { name: "Telefon und Mac", holds: "Laden neue Fotos hoch, sobald sie entstehen.", state: s?.lastUpload ? `Zuletzt ${ago(s.lastUpload)}` : "Noch nichts hochgeladen", c: "--atelier" },
    // the originals live on the server's own disk since the switch to the larger server (no Storage Box); the host
    // backs the whole server up every night and keeps seven, which is the only nightly backup there is
    { name: "Dein Server", holds: s ? `Alle Originale, unverändert, dazu Vorschaubilder und Suche. ${num(s.items)} Fotos und Videos, ${bytes(s.bytes)}.` : "Alle Originale, unverändert, dazu Vorschaubilder und Suche.", state: "Hetzner sichert den Server jede Nacht, die letzten sieben Stände bleiben", c: "--water" },
    { name: "Festplatte am Mac", holds: "Zweite Kopie der Originale, an einem anderen Ort.", state: s?.secondCopy?.last ? `Zuletzt ${ago(s.secondCopy.last)}, ${num(s.secondCopy.n)} Dateien` : mac ? "Noch keine Kopie gemacht" : "Noch kein Mac verbunden", c: "--esszimmer" },
  ]);
  const stages = $derived(s ? [
    { name: "Vorschaubilder", ...s.stages.thumbs }, { name: "Bildinhalt für die Suche", ...s.stages.clip }, { name: "Gesichter", ...s.stages.faces },
    { name: "Text in Bildern", ...s.stages.ocr }, { name: "Dinge im Bild", ...s.stages.labels },
  ].map(x => ({ ...x, pct: x.total ? Math.floor((x.done / x.total) * 1000) / 10 : 100 })) : []);
  const dr = $derived($darkroomStatus);
  const drText = $derived(dr.state === "working" ? `Arbeitet: ${num(dr.pending)} ${dr.pending === 1 ? "Foto wartet" : "Fotos warten"}, ${num(dr.done)} fertig` : dr.state === "loading" ? "Lädt die Modelle" : dr.state === "paused" ? "Pausiert, solange die Seite im Hintergrund ist" : dr.state === "error" ? "Hat ein Problem, versucht es später wieder" : app.wide ? "Wartet auf neue Fotos" : "Läuft nur auf dem Computer, solange die Seite offen ist");
  const roles = (d: DeviceOut) => [d.scopes.includes("upload") ? "lädt hoch" : "", d.scopes.includes("index") ? "analysiert" : "", d.kind === "mac" ? "zweite Kopie" : ""].filter(Boolean);
  const seen = (d: DeviceOut) => d.lastSeenAt && now - d.lastSeenAt < 120_000 ? "gerade aktiv" : ago(d.lastSeenAt);

  // On Android the backup lives in the Monet app (it opens this page full screen); its backup screen is one tap away.
  // Without the app installed, Chrome stays on this page instead of going to the store.
  const android = /Android/.test(navigator.userAgent);
  const backupLink = `intent://sicherung#Intent;scheme=monet;package=dev.kaleve.monet;S.browser_fallback_url=${encodeURIComponent(location.href)};end`;
  async function newPair() { try { pair = await post("/api/devices/pair"); } catch (e: any) { toast(e.message); } }
  const left = $derived(pair ? Math.max(0, Math.floor((pair.expiresAt - now) / 1000)) : 0);
  const code = $derived(pair ? pair.code.replace(/(.{4})(?=.)/g, "$1 ") : "");
  async function remove(kind: "devices" | "sessions" | "passkeys", id: string | number) {
    try { await api(`/api/${kind}/${id}`, { method: "DELETE" }); asking = null; await load(); } catch (e: any) { toast(e.message); }
  }
  async function addKey(e: Event) {
    e.preventDefault(); busy = true;
    try { await register(keyName.trim() || "Passkey"); toast("Der Passkey ist hinzugefügt."); await load(); } catch (err: any) { toast(passkeyMessage(err, "de")); } finally { busy = false; }
  }
  // for a device that cannot use this one's passkey (no phone nearby for the QR code): a link that adds one more, for an hour
  async function newAddLink() { try { addLink = await post<AccountLink>("/api/account/link"); } catch (e: any) { toast(e.message); } }
  async function copyLink() { if (!addLink) return; try { await navigator.clipboard.writeText(addLink.link); toast("Der Link ist kopiert."); } catch { toast("Kopieren ging nicht. Markiere den Link von Hand."); } }
  async function logout() { try { await signOut(); } catch {} app.loggedIn = false; go("/login", true); }
  const ask = (k: string) => (asking = asking === k ? null : k);
</script>

<div class="page">
  <header><Link href="/" class="back"><Icon name="back" size={20} sw={2} />Fotos</Link><span class="sp"></span><Link href="/haushalt" class="back">Haushalt und Stil<Icon name="chevron" size={18} sw={2} /></Link></header>
  <div class="in">
    <div class="head">
      <div class="ttl">
        <span aria-hidden="true" class="dab" style="left:-4px;bottom:6px;width:46%;height:13px;background:var(--atelier);opacity:.35;transform:rotate(-1.5deg)"></span>
        <span aria-hidden="true" class="dab" style="left:38%;bottom:2px;width:40%;height:11px;background:var(--water);opacity:.25;transform:rotate(1.5deg)"></span>
        <h1>Geräte und Sicherung</h1>
      </div>
      <p class="sub">Speicherorte, Geräte und Bildanalyse.</p>
    </div>

    <section aria-label="Wo deine Fotos liegen" class="chain">
      {#each chain as c, i}
        <div class="link">
          <div class="blk">
            <span class="paint"><span class="dab" style="left:0;top:2px;width:40px;height:10px;background:var({c.c});transform:rotate(-4deg)"></span><span class="dab" style="left:22px;top:5px;width:30px;height:8px;background:var({c.c});opacity:.6;transform:rotate(3deg)"></span></span>
            <h2>{c.name}</h2><p>{c.holds}</p><p class="tnum m">{c.state}</p>
          </div>
          {#if i < chain.length - 1}<Icon name="pfeil" size={34} sw={1.8} />{/if}
        </div>
      {/each}
    </section>

    <div class="cols">
      <section aria-label="Geräte" class="col a">
        <div class="hh"><h2 class="h">Geräte</h2><button type="button" class="ghost" onclick={newPair}>Gerät verbinden</button></div>
        {#if pair}
          <div class="pair" role="status">
            {#if left > 0}
              <p class="m">Gib diesen Code im Gerät ein. Er gilt noch <b class="tnum">{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</b> Minuten und nur einmal.</p>
              <p class="code tnum" aria-label="Code: {pair.code.split('').join(' ')}">{code}</p>
              <div class="steps">
                <div><h3>Am Mac</h3><ol><li>Öffne Monet in der Menüleiste und wähle „Gerät verbinden“.</li><li>Trage die Adresse <b>{location.origin}</b> und den Code ein.</li></ol></div>
                <div><h3>Auf Android</h3><ol><li>Öffne die Monet-App und tippe auf „Verbinden“.</li><li>Trage die Adresse <b>{location.origin}</b> und den Code ein.</li><li>Erlaube den Zugriff auf deine Fotos.</li></ol></div>
              </div>
            {:else}
              <p class="m">Der Code ist abgelaufen.</p><button type="button" class="ghost" onclick={newPair}>Neuen Code erzeugen</button>
            {/if}
          </div>
        {/if}
        <div class="list">
          {#each live as d (d.id)}
            <div class="dev">
              <span class="ic"><Icon name={d.kind === "mac" ? "laptop" : "telefon"} size={20} /></span>
              <span class="tx">
                <span class="nm"><b>{d.name}</b><span class="tnum m s">{seen(d)}</span></span>
                <span class="d">{d.uploads ? `${count(d.uploads, "Datei", "Dateien")} hochgeladen.` : "Hat noch nichts hochgeladen."}</span>
                <span class="roles">{#each roles(d) as r}<span>{r}</span>{/each}</span>
              </span>
              {#if asking === `d${d.id}`}<button type="button" class="danger" onclick={() => remove("devices", d.id)}>Wirklich entfernen</button>{:else}<button type="button" class="quiet" onclick={() => ask(`d${d.id}`)} aria-label="{d.name} entfernen">Entfernen</button>{/if}
            </div>
          {:else}<p class="m pad">Noch kein Gerät verbunden. Tippe auf „Gerät verbinden“.</p>{/each}
          <div class="dev">
            <span class="ic"><Icon name="tablet" size={20} /></span>
            <span class="tx"><span class="nm"><b>Dieser Browser</b></span><span class="d">Zum Ansehen und Importieren. Die Suche läuft auf dem Server.</span><span class="roles"><button type="button" class="chipb" onclick={() => (importing = true)}>Fotos importieren</button>{#if android}<a class="chipb" href={backupLink}>Sicherung auf diesem Telefon</a>{/if}</span></span>
          </div>
        </div>
      </section>

      <section aria-label="Bildanalyse" class="col b">
        <h2 class="h">Bildanalyse</h2>
        <div class="box">
          {#each stages as st}
            <div class="stage">
              <span class="sl"><span class="b">{st.name}</span><span class="tnum m">{num(st.done)} von {num(st.total)}</span></span>
              <span role="meter" aria-label={st.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={st.pct} class="meter"><span style="width:{st.pct}%;background:{st.pct >= 100 ? 'var(--water)' : 'var(--sun)'}"></span></span>
            </div>
          {/each}
          <div class="stage">
            <span class="sl"><span class="b">Dunkelkammer in diesem Browser</span></span>
            <p class="m small" role="status">{drText}</p>
          </div>
          <p class="m small">Gesichter und Dinge erkennt ein Browser mit offener Monet-Seite oder das MacBook. Text in Bildern liest der Server selbst, dazu übernimmt er die Suche und das Gruppieren der Gesichter.</p>
        </div>
      </section>
    </div>

    <div class="cols">
      <section aria-label="Sitzungen" class="col a">
        <h2 class="h">Sitzungen</h2>
        <div class="list">
          {#each sessions as x (x.id)}
            <div class="dev">
              <span class="ic"><Icon name={x.kind === "device" ? "telefon" : "laptop"} size={20} /></span>
              <span class="tx"><span class="nm"><b>{x.device ?? x.userAgent ?? "Browser"}</b>{#if x.current}<span class="tag">dieses Gerät</span>{/if}</span><span class="d tnum">Angemeldet {ago(x.createdAt)}, zuletzt aktiv {ago(x.lastSeenAt)}</span></span>
              {#if !x.current}{#if asking === `s${x.id}`}<button type="button" class="danger" onclick={() => remove("sessions", x.id)}>Wirklich abmelden</button>{:else}<button type="button" class="quiet" onclick={() => ask(`s${x.id}`)}>Abmelden</button>{/if}{/if}
            </div>
          {/each}
        </div>
      </section>
      <section aria-label="Passkeys" class="col b">
        <h2 class="h">Passkeys</h2>
        <div class="list">
          {#each creds as c (c.id)}
            <div class="dev">
              <span class="ic"><Icon name="check" size={20} /></span>
              <span class="tx"><span class="nm"><b>{c.name}</b></span><span class="d tnum">Angelegt {ago(c.createdAt)}, zuletzt benutzt {ago(c.lastUsedAt)}</span></span>
              {#if creds.length > 1}{#if asking === `c${c.id}`}<button type="button" class="danger" onclick={() => remove("passkeys", c.id)}>Wirklich entfernen</button>{:else}<button type="button" class="quiet" onclick={() => ask(`c${c.id}`)}>Entfernen</button>{/if}{:else}<span class="m s">der letzte bleibt</span>{/if}
            </div>
          {/each}
        </div>
        {#if passkeysSupported()}
          <form onsubmit={addKey}><input type="text" bind:value={keyName} aria-label="Name des neuen Passkeys" /><button type="submit" class="ghost" disabled={busy}>Weiteren Passkey hinzufügen</button></form>
        {/if}
        {#if addLink && addLink.expiresAt > now}
          <div class="pair" role="status">
            <p class="m">Öffne diesen Link auf dem anderen Gerät. Er gilt eine Stunde und nur einmal und legt dort einen weiteren Passkey für dich an.</p>
            <code>{addLink.link}</code>
            <button type="button" class="ghost" onclick={copyLink}>Link kopieren</button>
          </div>
        {:else}
          <button type="button" class="quiet out" onclick={newAddLink}>Link für ein Gerät ohne diesen Passkey</button>
        {/if}
        <button type="button" class="quiet out" onclick={logout}>Hier abmelden</button>
      </section>
    </div>
  </div>
</div>
<ImportSheet bind:open={importing} />

<style>
  .page { padding: 18px 24px 48px; min-height: 100dvh; }
  header { max-width: 1180px; margin: 0 auto; display: flex; align-items: center; }
  header :global(.back) { height: 44px; display: inline-flex; align-items: center; gap: 6px; padding: 0 12px 0 6px; border-radius: 22px; font-weight: 600; }
  header :global(.back:hover) { background: var(--surface-2); }
  header .sp { flex: 1; }
  .in { max-width: 1180px; margin: 0 auto; display: flex; flex-direction: column; gap: 36px; padding-top: 14px; }
  .head { display: flex; flex-direction: column; gap: 6px; } .ttl { position: relative; width: max-content; max-width: 100%; }
  h1 { position: relative; font-size: clamp(36px, 7vw, 52px); line-height: 1.05; } .sub { font-size: 17px; color: var(--muted); }
  .m { color: var(--muted); } .s { font-size: 13px; } .small { font-size: 13px; } .pad { padding: 16px 18px; }
  .chain { display: flex; flex-wrap: wrap; align-items: stretch; }
  .link { flex: 1 1 220px; display: flex; align-items: center; min-width: 0; }
  .link > :global(svg) { flex: none; color: var(--muted); }
  .blk { flex: 1; min-width: 0; padding: 16px 18px; border-radius: 18px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--rule); display: flex; flex-direction: column; gap: 6px; height: 100%; }
  .paint { position: relative; height: 14px; width: 54px; } .blk h2 { font-size: 24px; line-height: 1.1; } .blk p { font-size: 14px; } .blk p.m { font-size: 13px; }
  .cols { display: flex; flex-wrap: wrap; gap: 28px; align-items: flex-start; }
  .col { min-width: 0; display: flex; flex-direction: column; gap: 10px; } .a { flex: 1 1 520px; } .b { flex: 1 1 400px; }
  .hh { display: flex; align-items: center; justify-content: space-between; gap: 12px; } .h { font-size: 30px; }
  .list, .box { border-radius: 18px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--rule); }
  .box { display: flex; flex-direction: column; gap: 14px; padding: 18px; }
  .dev { display: flex; gap: 14px; padding: 16px 18px; align-items: flex-start; } .dev + .dev { border-top: 1px solid var(--rule); }
  .ic { width: 40px; height: 40px; flex: none; border-radius: 12px; background: var(--surface-2); display: grid; place-items: center; }
  .tx { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; } .nm { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; } .nm b { font-weight: 650; } .d { font-size: 14px; }
  .roles { display: flex; gap: 6px; flex-wrap: wrap; padding-top: 2px; }
  .roles > span, .tag { height: 24px; padding: 0 9px; display: inline-flex; align-items: center; border-radius: 12px; background: var(--surface-2); font-size: 12.5px; font-weight: 600; }
  .chipb { display: inline-flex; align-items: center; color: inherit; text-decoration: none; min-height: 32px; padding: 0 12px; border: 0; border-radius: 16px; background: var(--surface-2); font-size: 13px; font-weight: 650; } .chipb:hover { background: var(--surface-3); }
  .ghost { min-height: 44px; padding: 0 16px; border: 0; border-radius: 22px; background: transparent; box-shadow: inset 0 0 0 1.5px var(--rule); font-weight: 650; } .ghost:hover { background: var(--surface-2); } .ghost:disabled { opacity: .5; }
  .quiet { min-height: 44px; padding: 0 12px; border: 0; border-radius: 22px; background: transparent; color: var(--muted); font-weight: 600; font-size: 14px; } .quiet:hover { background: var(--surface-2); color: var(--ink); }
  .danger { min-height: 44px; padding: 0 14px; border: 0; border-radius: 22px; background: var(--sun); color: var(--deep); font-weight: 700; font-size: 14px; }
  .out { align-self: flex-start; }
  .stage { display: flex; flex-direction: column; gap: 5px; } .sl { display: flex; justify-content: space-between; gap: 10px; font-size: 14px; } .sl .m { white-space: nowrap; } .b { font-weight: 600; }
  .meter { position: relative; height: 10px; border-radius: 5px; background: var(--surface-2); overflow: hidden; display: block; } .meter span { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 5px; }
  .pair { padding: 18px; border-radius: 18px; background: var(--ess-soft); box-shadow: inset 0 0 0 1px var(--ess-rule); display: flex; flex-direction: column; gap: 12px; }
  .code { font-family: var(--font-display); font-size: clamp(40px, 9vw, 64px); line-height: 1; letter-spacing: .04em; }
  .steps { display: flex; flex-wrap: wrap; gap: 20px; } .steps > div { flex: 1 1 220px; } h3 { font-size: 20px; margin-bottom: 4px; }
  ol { margin: 0; padding-left: 20px; font-size: 14px; display: flex; flex-direction: column; gap: 3px; }
  form { display: flex; flex-wrap: wrap; gap: 8px; }
  code { display: block; max-width: 100%; overflow-x: auto; padding: 10px 12px; border-radius: 10px; background: var(--surface); font-size: 13px; white-space: nowrap; }
  input { flex: 1 1 140px; min-width: 0; height: 44px; padding: 0 14px; border: 0; border-radius: 12px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--rule); font-size: 16px; }
  @media (max-width: 899px) { .page { padding: 12px 14px 40px; } .link > :global(svg) { display: none; } .chain { gap: 10px; } }
</style>
