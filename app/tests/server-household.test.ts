// The household on the accounts module: an admin's invite link makes a second person with their own passkey and
// style, everyone may look at and search everyone's photos, only the owner changes their own, a reset touches one
// person, and only an admin invites or removes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { seedSession, SoftAuthenticator, startServer, type Srv } from "./helpers";

let srv: Srv, rpId: string, mia: string, ida: string, linaId: number;
beforeAll(async () => { srv = await startServer({ MONET_SETUP_TOKEN: "setup-secret" }); rpId = new URL(srv.origin).hostname; mia = await seedSession(srv); });
afterAll(() => srv.stop());

const cookieOf = (r: Response) => /__Host-monet=([^;]+)/.exec(r.headers.get("set-cookie") ?? "")?.[1] ?? null;
const j = (r: Response) => r.json() as Promise<any>;
async function register(auth: SoftAuthenticator, setupToken?: string) {
  const opt = await srv.fetch("/api/auth/register/options", { method: "POST", json: setupToken ? { token: setupToken } : {} });
  if (!opt.ok) return { opt };
  const options = await j(opt);
  const ver = await srv.fetch("/api/auth/register/verify", { method: "POST", json: { credential: await auth.register(options, srv.origin), name: "Telefon" } });
  return { opt, options, ver };
}
const tokenOf = (link: string) => link.split("#")[1];
let n = 0;
function photo(owner: number, day: string, name: string) {
  // after whatever the upload test added: ids come from the table, not from a counter
  const id = Math.max(100 + ++n, ((srv.db().query("SELECT max(id) AS m FROM item").get() as { m: number | null }).m ?? 0) + 1);
  srv.db().query(`INSERT INTO item (id, owner_id, sha256, kind, mime, ext, bytes, taken_at, taken_src, day, source, uploaded_at, orig_path, thumbs_ok, color, orig_name)
    VALUES (?, ?, ?, 'photo', 'image/jpeg', 'jpg', 10, ?, 'exif', ?, 'web', 1, 'x', 1, '#888888', ?)`).run(id, owner, String(id).padStart(64, "0"), Date.parse(day + "T12:00:00Z"), day, name);
  srv.db().query("INSERT INTO item_fts (rowid, ocr_text, labels, place, people, orig_name) VALUES (?, '', '', '', '', ?)").run(id, name);
  return id;
}

describe("household", () => {
  let jonaPhoto: number, linaPhoto: number;
  test("an invite makes a person with a link; the link registers their own passkey once", async () => {
    const r = await srv.fetch("/api/members", { method: "POST", cookie: mia, json: { name: "Ida", theme: "ernst" } });
    expect(r.status).toBe(200);
    const inv = await j(r);
    expect(inv.link).toStartWith(`${srv.origin}/setup#`);
    linaId = inv.member;
    expect(JSON.stringify(srv.db().query("SELECT * FROM auth_link").all())).not.toContain(tokenOf(inv.link)); // stored hashed
    const h = await j(await srv.fetch("/api/household", { cookie: mia }));
    expect(h.members.find((m: any) => m.id === linaId)).toMatchObject({ name: "Ida", theme: "ernst", joined: false });

    const key = await SoftAuthenticator.create(rpId);
    const { options, ver } = await register(key, tokenOf(inv.link));
    expect(options.user.displayName).toBe("Ida");
    expect(options.excludeCredentials).toEqual([]); // Mia's keys never block Ida's
    expect(ver!.status).toBe(200);
    ida = cookieOf(ver!)!;
    expect((await j(await srv.fetch("/api/household", { cookie: ida }))).me).toBe(linaId);
    expect((await register(await SoftAuthenticator.create(rpId), tokenOf(inv.link))).opt.status).toBe(403); // used up
    expect(srv.db().query("SELECT account_id FROM auth_passkey WHERE id = ?").get(key.id)).toEqual({ account_id: linaId });
    expect((await j(await srv.fetch("/api/members", { cookie: ida }))).map((m: any) => [m.name, m.role])).toEqual([["Test", "admin"], ["Ida", "member"]]);
  });
  test("everyone reads everyone's library; the timeline of another person needs X-Monet-Of", async () => {
    jonaPhoto = photo(1, "2024-05-01", "mia-baum.jpg");
    linaPhoto = photo(linaId, "2024-06-01", "ida-baum.jpg");
    const ids = (t: any) => t.days.flatMap((d: any) => d.items.map((i: any) => i.id));
    expect(ids(await j(await srv.fetch("/api/timeline", { cookie: mia })))).toEqual([jonaPhoto]);
    expect(ids(await j(await srv.fetch("/api/timeline", { cookie: mia, headers: { "x-monet-of": String(linaId) } })))).toEqual([linaPhoto]);
    expect((await srv.fetch("/api/timeline", { cookie: mia, headers: { "x-monet-of": "999" } })).status).toBe(404);
    const d = await j(await srv.fetch(`/api/items/${linaPhoto}`, { cookie: mia }));
    expect(d.owner).toBe(linaId);
  });
  test("only the owner changes a photo", async () => {
    expect((await srv.fetch(`/api/items/${linaPhoto}`, { method: "PATCH", cookie: mia, json: { favorite: true } })).status).toBe(404);
    expect((await srv.fetch(`/api/items/${linaPhoto}`, { method: "DELETE", cookie: mia })).status).toBe(404);
    expect((await srv.fetch(`/api/items/${linaPhoto}`, { method: "PATCH", cookie: ida, json: { favorite: true } })).status).toBe(200);
  });
  test("photos uploaded while looking at another person's library go into that library", async () => {
    if (!Bun.which("vips")) return;
    const dir = (await import("node:fs")).mkdtempSync((await import("node:path")).join((await import("node:os")).tmpdir(), "monet-hh-"));
    const out = `${dir}/a.jpg`; await Bun.spawn(["vips", "black", out, "64", "48"]).exited;
    const bytes = new Uint8Array(await Bun.file(out).arrayBuffer()), sha = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    const of = { "x-monet-of": String(linaId) };
    expect((await j(await srv.fetch("/api/upload/check", { method: "POST", cookie: mia, headers: of, json: { hashes: [sha] } }))).missing).toEqual([sha]);
    const r = await srv.fetch(`/api/upload/${sha}?offset=0&total=${bytes.length}&name=a.jpg`, { method: "PUT", cookie: mia, headers: of, body: bytes });
    expect(r.status).toBe(200);
    expect(srv.db().query("SELECT owner_id FROM item WHERE sha256 = ?").all(sha)).toEqual([{ owner_id: linaId }]);
    expect((await j(await srv.fetch("/api/upload/check", { method: "POST", cookie: mia, headers: of, json: { hashes: [sha] } }))).missing).toEqual([]);
    expect((await j(await srv.fetch("/api/upload/check", { method: "POST", cookie: mia, json: { hashes: [sha] } }))).missing).toEqual([sha]); // not in Mia's
    expect((await srv.fetch("/api/upload/check", { method: "POST", cookie: mia, headers: { "x-monet-of": "999" }, json: { hashes: [sha] } })).status).toBe(404);
  });
  test("search: one library by default, the whole household with everyone; other people's photos say whose", async () => {
    const q = async (cookie: string, everyone?: boolean, of?: number) => j(await srv.fetch("/api/search", { method: "POST", cookie, headers: of ? { "x-monet-of": String(of) } : {}, json: { chips: [{ kind: "text", label: "baum", value: "baum" }], everyone } }));
    expect((await q(mia)).items.map((i: any) => i.id)).toEqual([jonaPhoto]);
    const all = await q(mia, true);
    expect(all.items.map((i: any) => [i.id, i.owner]).sort()).toEqual([[jonaPhoto, undefined], [linaPhoto, linaId]].sort());
    const fromLina = await q(mia, true, linaId); // looking at Ida's library, Mia's own photo is the foreign one
    expect(fromLina.items.find((i: any) => i.id === jonaPhoto).owner).toBe(1);
  });
  test("each person sets their own name and style", async () => {
    expect((await srv.fetch("/api/household/me", { method: "PATCH", cookie: mia, json: { name: "Mia", theme: "monet" } })).status).toBe(200);
    expect((await srv.fetch("/api/household/me", { method: "PATCH", cookie: mia, json: { theme: "picasso" } })).status).toBe(400);
    const h = await j(await srv.fetch("/api/household", { cookie: ida }));
    expect(h.members.map((m: any) => [m.name, m.theme, m.joined])).toEqual([["Mia", "monet", false], ["Ida", "ernst", true]]);
  });
  test("a reset for one person replaces only their passkeys and sessions", async () => {
    // Mia was signed in without a passkey (seeded); one from that session first, then the reset replaces it
    const jonaKey = await SoftAuthenticator.create(rpId);
    const add = await srv.fetch("/api/auth/register/options", { method: "POST", cookie: mia, json: {} });
    expect((await srv.fetch("/api/auth/register/verify", { method: "POST", cookie: mia, json: { credential: await jonaKey.register(await j(add), srv.origin), name: "Mac" } })).status).toBe(200);
    const before = srv.db().query("SELECT count(*) AS n FROM auth_passkey WHERE account_id = ?").get(linaId);
    const out = await srv.cli("reset-passkeys", "Mia");
    expect(out).toContain("for Mia");
    const { ver } = await register(await SoftAuthenticator.create(rpId), /#(\S+)/.exec(out)![1]);
    expect(ver!.status).toBe(200);
    mia = cookieOf(ver!)!;
    expect(srv.db().query("SELECT count(*) AS n FROM auth_passkey WHERE account_id = ?").get(linaId)).toEqual(before);
    expect(srv.db().query("SELECT count(*) AS n FROM auth_passkey WHERE id = ?").get(jonaKey.id)).toEqual({ n: 0 });
    expect((await srv.fetch("/api/household", { cookie: ida })).status).toBe(200); // Ida stays signed in
  });
  test("only an admin invites and removes; an invite nobody used is deleted outright", async () => {
    expect((await srv.fetch("/api/members", { method: "POST", cookie: ida, json: { name: "Gast" } })).status).toBe(403);
    const inv = await j(await srv.fetch("/api/members", { method: "POST", cookie: mia, json: { name: "Gast" } }));
    expect((await srv.fetch(`/api/members/${inv.member}`, { method: "DELETE", cookie: ida })).status).toBe(403);
    expect(await j(await srv.fetch(`/api/members/${inv.member}`, { method: "DELETE", cookie: mia }))).toEqual({ ok: true, result: "deleted" });
    expect((await register(await SoftAuthenticator.create(rpId), tokenOf(inv.link))).opt.status).toBe(403);
  });
  test("removing someone with photos keeps their library and takes their access", async () => {
    const inv = await j(await srv.fetch("/api/members", { method: "POST", cookie: mia, json: { name: "Nils" } }));
    const pic = photo(inv.member, "2024-07-01", "nils.jpg");
    expect(await j(await srv.fetch(`/api/members/${inv.member}`, { method: "DELETE", cookie: mia }))).toEqual({ ok: true, result: "revoked" });
    expect(srv.db().query("SELECT owner_id FROM item WHERE id = ?").get(pic)).toEqual({ owner_id: inv.member });
    expect((await register(await SoftAuthenticator.create(rpId), tokenOf(inv.link))).opt.status).toBe(403);
  });
  test("an invite opened where someone is signed in makes the new person's passkey and switches the browser to them", async () => {
    const inv = await j(await srv.fetch("/api/members", { method: "POST", cookie: mia, json: { name: "Mara", theme: "magritte" } }));
    const before = srv.db().query("SELECT count(*) AS n FROM auth_passkey WHERE account_id = ?").get(linaId);
    const opt = await srv.fetch("/api/auth/register/options", { method: "POST", cookie: ida, json: { token: tokenOf(inv.link) } });
    const options = await j(opt);
    expect(options.user.displayName).toBe("Mara");
    const key = await SoftAuthenticator.create(rpId);
    const ver = await srv.fetch("/api/auth/register/verify", { method: "POST", cookie: ida, json: { credential: await key.register(options, srv.origin), name: "Telefon" } });
    expect(ver.status).toBe(200);
    const mara = cookieOf(ver)!;
    expect((await j(await srv.fetch("/api/household", { cookie: mara }))).me).toBe(inv.member);
    expect(srv.db().query("SELECT account_id FROM auth_passkey WHERE id = ?").get(key.id)).toEqual({ account_id: inv.member });
    expect(srv.db().query("SELECT count(*) AS n FROM auth_passkey WHERE account_id = ?").get(linaId)).toEqual(before); // no key for Ida
    expect((await srv.fetch("/api/household", { cookie: ida })).status).toBe(401); // that browser's old session ended
    const h = await j(await srv.fetch("/api/household", { cookie: mara }));
    expect(h.members.find((m: any) => m.name === "Mara").theme).toBe("magritte");
  });
  test("monet invite prints a link from the command line", async () => {
    const out = await srv.cli("invite", "Oma", "--theme", "ernst");
    expect(out).toContain(`${srv.origin}/setup#`);
    expect(srv.db().query("SELECT theme, role FROM owner WHERE name = 'Oma'").get()).toEqual({ theme: "ernst", role: "member" });
    expect(await srv.cli("members")).toContain("Oma  member  invited");
  });
});
