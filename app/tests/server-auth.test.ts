// The accounts module mounted in Monet: WebAuthn with a software authenticator, sessions, same-origin, pairing and
// Monet's device scopes, rate limits. The module's own rules are in tests/accounts.test.ts; this is the real server.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pairDevice, seedSession, SoftAuthenticator, startServer, type Srv } from "./helpers";

let srv: Srv, rpId: string;
beforeAll(async () => { srv = await startServer({ MONET_SETUP_TOKEN: "setup-secret" }); rpId = new URL(srv.origin).hostname; });
afterAll(() => srv.stop());

const cookieOf = (r: Response) => /__Host-monet=([^;]+)/.exec(r.headers.get("set-cookie") ?? "")?.[1] ?? null;
const j = (r: Response) => r.json() as Promise<any>;

async function register(auth: SoftAuthenticator, setupToken?: string, cookie?: string, o: Parameters<SoftAuthenticator["register"]>[2] = {}) {
  const opt = await srv.fetch("/api/auth/register/options", { method: "POST", json: setupToken ? { token: setupToken } : {}, cookie });
  if (!opt.ok) return { opt };
  const options = await j(opt);
  const cred = await auth.register(options, srv.origin, o);
  const ver = await srv.fetch("/api/auth/register/verify", { method: "POST", json: { credential: cred, name: "Test-Key" }, cookie });
  return { opt, options, ver };
}
async function login(auth: SoftAuthenticator, o: Parameters<SoftAuthenticator["login"]>[2] = {}) {
  const opt = await j(await srv.fetch("/api/auth/login/options", { method: "POST" }));
  const cred = await auth.login(opt, srv.origin, o);
  return srv.fetch("/api/auth/login/verify", { method: "POST", json: { credential: cred } });
}

describe("passkeys", () => {
  let es: SoftAuthenticator, session: string;
  test("setup is open with the env token, closed to a wrong or missing one", async () => {
    expect(await j(await srv.fetch("/api/auth/state"))).toEqual({ setupOpen: true, loggedIn: false, device: false, hasCredential: false, me: null });
    expect((await srv.fetch("/api/auth/register/options", { method: "POST", json: {} })).status).toBe(403);
    expect((await srv.fetch("/api/auth/register/options", { method: "POST", json: { token: "wrong" } })).status).toBe(403);
  });
  test("the first ES256 passkey registers with the token and opens a session", async () => {
    es = await SoftAuthenticator.create(rpId, -7);
    const { options: o, ver } = await register(es, "setup-secret");
    expect(o.rp.id).toBe(rpId); expect(o.authenticatorSelection).toMatchObject({ residentKey: "required", userVerification: "required" });
    expect(o.pubKeyCredParams.map((p: any) => p.alg)).toEqual([-7, -257]);
    expect(ver!.status).toBe(200);
    session = cookieOf(ver!)!;
    expect(session).toBeTruthy();
    expect(ver!.headers.get("set-cookie")).toMatch(/Secure; HttpOnly; SameSite=Strict/);
    expect(await j(await srv.fetch("/api/auth/state", { cookie: session }))).toMatchObject({ loggedIn: true, setupOpen: false, hasCredential: true });
  });
  test("after the first credential the setup token no longer works", async () => {
    expect((await srv.fetch("/api/auth/register/options", { method: "POST", json: { token: "setup-secret" } })).status).toBe(403);
  });
  test("login with a discoverable credential gives a session; the library needs it", async () => {
    expect((await srv.fetch("/api/timeline")).status).toBe(401);
    const r = await login(es);
    expect(r.status).toBe(200);
    const c = cookieOf(r)!;
    expect((await srv.fetch("/api/timeline", { cookie: c })).status).toBe(200);
  });
  test("a signature from another key, a replayed challenge, a wrong origin, a missing UV flag and a backwards counter are all refused", async () => {
    const other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]) as CryptoKeyPair;
    expect((await login(es, { signWith: other.privateKey })).status).toBe(401);
    // replay: the same challenge twice
    const opt = await j(await srv.fetch("/api/auth/login/options", { method: "POST" }));
    const cred = await es.login(opt, srv.origin);
    const first = await srv.fetch("/api/auth/login/verify", { method: "POST", json: { credential: cred } });
    const again = await srv.fetch("/api/auth/login/verify", { method: "POST", json: { credential: cred } });
    expect(first.status).toBe(200); expect(again.status).toBe(400);
    // wrong origin inside the client data
    const opt2 = await j(await srv.fetch("/api/auth/login/options", { method: "POST" }));
    const evil = await es.login(opt2, "https://evil.example");
    expect((await srv.fetch("/api/auth/login/verify", { method: "POST", json: { credential: evil } })).status).toBe(400);
    expect((await login(es, { flags: 0x01 })).status).toBe(401);          // no user verification
    expect((await login(es, { type: "webauthn.create" })).status).toBe(400); // wrong ceremony
    const ok = await login(es); expect(ok.status).toBe(200);
    expect((await login(es, { count: 1 })).status).toBe(401);             // counter went backwards
    es.signCount = 100; expect((await login(es, { count: 100 })).status).toBe(200);
  });
  test("an unknown credential id is refused", async () => {
    const stranger = await SoftAuthenticator.create(rpId, -7);
    expect((await login(stranger)).status).toBe(401);
  });
  test("a second passkey (RS256) only from a logged-in browser; both can log in; the last one cannot be deleted", async () => {
    const rs = await SoftAuthenticator.create(rpId, -257);
    expect((await register(rs)).opt.status).toBe(403);
    const { ver } = await register(rs, undefined, session);
    expect(ver!.status).toBe(200);
    expect((await login(rs)).status).toBe(200);
    expect((await login(es, { count: 200 })).status).toBe(200);
    const list = await j(await srv.fetch("/api/passkeys", { cookie: session }));
    expect(list.length).toBe(2);
    expect((await srv.fetch(`/api/passkeys/${list[0].id}`, { method: "DELETE", cookie: session })).status).toBe(200);
    expect((await srv.fetch(`/api/passkeys/${list[1].id}`, { method: "DELETE", cookie: session })).status).toBe(409);
    // restore a state with the ES256 key for the next tests
    const { ver: v2 } = await register(es, undefined, session);
    expect(v2!.status).toBe(200);
  });
  test("registration refuses wrong rp id and a missing UV flag", async () => {
    const a = await SoftAuthenticator.create(rpId, -7);
    expect((await register(a, undefined, session, { rpId: "evil.example" })).ver!.status).toBe(400);
    const b = await SoftAuthenticator.create(rpId, -7);
    expect((await register(b, undefined, session, { flags: 0x41 })).ver!.status).toBe(401);
  });
  test("monet reset-passkeys prints a one-time link; its registration replaces all credentials; it works once", async () => {
    const out = await srv.cli("reset-passkeys");
    const token = /#(\S+)/.exec(out)![1];
    expect(out).toContain(`${srv.origin}/setup#`);
    expect(srv.db().query("SELECT purpose FROM auth_link WHERE used_at IS NULL").get()).toEqual({ purpose: "recover" });
    expect(JSON.stringify(srv.db().query("SELECT * FROM auth_link").all())).not.toContain(token); // stored hashed
    expect(await j(await srv.fetch("/api/auth/link", { method: "POST", json: { token } }))).toMatchObject({ purpose: "recover", name: "Ich" });
    const fresh = await SoftAuthenticator.create(rpId, -7);
    const { ver } = await register(fresh, token);
    expect(ver!.status).toBe(200);
    expect((await login(es, { count: 500 })).status).toBe(401); // the old key is gone
    expect((await login(fresh)).status).toBe(200);
    expect((await srv.fetch("/api/auth/register/options", { method: "POST", json: { token } })).status).toBe(403);
    expect((await j(await srv.fetch("/api/auth/state"))).setupOpen).toBe(false);
    expect(srv.db().query("SELECT count(*) AS n FROM auth_passkey").get()).toEqual({ n: 1 });
  });
  test("login and register are limited to 10 per minute per address", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await srv.fetch("/api/auth/login/options", { method: "POST", headers: { "x-forwarded-for": "10.200.0.1" } })).status);
    expect(codes.slice(0, 10).every(c => c === 200)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
  });
});

describe("sessions and same-origin", () => {
  let cookie: string;
  beforeAll(async () => { cookie = await seedSession(srv); });
  test("state-changing requests need a same-origin Origin or Sec-Fetch-Site", async () => {
    const post = (headers: Record<string, string>) => srv.fetch("/api/albums", { method: "POST", cookie, origin: null, headers, json: { name: "A" } });
    expect((await post({ origin: "https://evil.example" })).status).toBe(403);
    expect((await post({})).status).toBe(403);
    expect((await post({ "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await post({ "sec-fetch-site": "same-origin" })).status).toBe(200);
    expect((await post({ origin: srv.origin })).status).toBe(200);
  });
  test("reads work without an Origin; every response carries the security headers", async () => {
    const r = await srv.fetch("/api/albums", { cookie });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(r.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("strict-transport-security")).toContain("max-age=");
    expect((await srv.fetch("/nope-not-here.js")).headers.get("x-content-type-options")).toBe("nosniff");
  });
  test("static client, vendored ort and models: types, cache, isolation headers", async () => {
    mkdirSync(join(srv.dir, "dist/vendor/ort"), { recursive: true }); mkdirSync(join(srv.dir, "models"), { recursive: true });
    writeFileSync(join(srv.dir, "dist/index.html"), "<html></html>");
    writeFileSync(join(srv.dir, "dist/vendor/ort/ort.wasm"), new Uint8Array([0, 97, 115, 109]));
    writeFileSync(join(srv.dir, "dist/vendor/ort/ort.mjs"), "export {}");
    writeFileSync(join(srv.dir, "models/m.onnx"), "x");
    const wasm = await srv.fetch("/vendor/ort/ort.wasm");
    expect(wasm.headers.get("content-type")).toBe("application/wasm");
    expect(wasm.headers.get("cache-control")).toContain("immutable");
    expect((await srv.fetch("/vendor/ort/ort.mjs")).headers.get("content-type")).toContain("text/javascript");
    for (const path of ["/", "/people/3", "/vendor/ort/ort.wasm"]) {
      const r = await srv.fetch(path);
      expect(r.headers.get("cross-origin-opener-policy")).toBe("same-origin");
      expect(r.headers.get("cross-origin-embedder-policy")).toBe("require-corp");
      expect(r.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    }
    expect((await srv.fetch("/people/3")).headers.get("content-type")).toContain("text/html"); // client routing
    expect((await srv.fetch("/models/m.onnx")).status).toBe(401);
    const m = await srv.fetch("/models/m.onnx?v=2", { cookie });
    expect(m.status).toBe(200); expect(m.headers.get("content-type")).toBe("application/octet-stream");
    expect(m.headers.get("cache-control")).toContain("immutable");
    expect(m.headers.get("cross-origin-resource-policy")).toBe("same-origin");
  });
  test("sessions list shows the current one and can revoke another", async () => {
    const other = await seedSession(srv);
    const list = await j(await srv.fetch("/api/sessions", { cookie }));
    expect(list.filter((s: any) => s.current).length).toBe(1);
    const victim = list.find((s: any) => !s.current);
    expect((await srv.fetch(`/api/sessions/${victim.id}`, { method: "DELETE", cookie })).status).toBe(200);
    expect((await srv.fetch("/api/albums", { cookie: other })).status).toBe(401);
  });
  test("logout deletes the session", async () => {
    const c = await seedSession(srv);
    const r = await srv.fetch("/api/auth/logout", { method: "POST", cookie: c });
    expect(r.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await srv.fetch("/api/albums", { cookie: c })).status).toBe(401);
  });
});

describe("pairing and device scopes", () => {
  let cookie: string, android: { token: string; deviceId: number }, mac: { token: string; deviceId: number };
  beforeAll(async () => {
    cookie = await seedSession(srv);
    android = await pairDevice(srv, cookie, "android"); mac = await pairDevice(srv, cookie, "mac");
    // something for the device to try to damage
    const db = srv.db();
    db.query(`INSERT INTO item (id, owner_id, sha256, kind, mime, ext, bytes, taken_at, taken_src, day, source, uploaded_at, orig_path, thumbs_ok, color) VALUES (1, 1, ?, 'photo', 'image/jpeg', 'jpg', 10, 1600000000000, 'exif', '2020-09-13', 'web', 1, 'x', 1, '#888888')`).run("a".repeat(64));
    db.query("INSERT INTO person (id, owner_id, name, created_at) VALUES (1, 1, 'Oma', 1)").run();
  });
  test("a pairing code works once, is case and dash tolerant, and wrong codes are refused", async () => {
    const { code } = await j(await srv.fetch("/api/devices/pair", { method: "POST", cookie }));
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    const claim = (c: string, ip: string) => srv.fetch("/api/devices/claim", { method: "POST", origin: null, headers: { "x-forwarded-for": ip }, json: { code: c, name: "x", kind: "android" } });
    expect((await claim("AAAAAAAA", "10.1.0.1")).status).toBe(403);
    const ok = await claim(`${code.slice(0, 4)}-${code.slice(4).toLowerCase()}`, "10.1.0.1");
    expect(ok.status).toBe(200);
    expect((await claim(code, "10.1.0.1")).status).toBe(403);
    const row = srv.db().query("SELECT code_hash FROM auth_pairing ORDER BY rowid DESC LIMIT 1").get() as any;
    expect(row.code_hash).not.toContain(code); // hashed
  });
  test("the claim endpoint is limited to 5 per minute per address", async () => {
    const claim = () => srv.fetch("/api/devices/claim", { method: "POST", origin: null, headers: { "x-forwarded-for": "10.9.9.9" }, json: { code: "BADCODE2", name: "x", kind: "mac" } });
    const codes: number[] = []; for (let i = 0; i < 7; i++) codes.push((await claim()).status);
    expect(codes).toEqual([403, 403, 403, 403, 403, 429, 429]);
  });
  test("a device token can upload and index but not read, delete or edit people", async () => {
    const t = android.token;
    expect((await srv.fetch("/api/upload/check", { method: "POST", token: t, json: { hashes: ["b".repeat(64)] } })).status).toBe(200);
    expect((await srv.fetch("/api/index/pending", { token: t })).status).toBe(200);
    expect((await srv.fetch("/api/status", { token: t })).status).toBe(200);
    expect((await srv.fetch("/api/items/1", { method: "DELETE", token: t })).status).toBe(403);
    expect((await srv.fetch("/api/items/1", { method: "PATCH", token: t, json: { favorite: true } })).status).toBe(403);
    expect((await srv.fetch("/api/people/1", { method: "POST", token: t, json: { name: "Nope" } })).status).toBe(403);
    expect((await srv.fetch("/api/people/merge", { method: "POST", token: t, json: { from: 1, into: 2 } })).status).toBe(403);
    expect((await srv.fetch("/api/timeline", { token: t })).status).toBe(403);
    expect((await srv.fetch("/api/devices", { token: t })).status).toBe(403);
    expect((await srv.fetch("/api/devices/pair", { method: "POST", token: t })).status).toBe(403);
    expect((await srv.fetch("/api/passkeys/abc", { method: "DELETE", token: t })).status).toBe(403);
    expect((await srv.fetch("/media/1/o", { token: t })).status).toBe(403);
    expect((await srv.fetch("/api/export/list", { token: t })).status).toBe(403);
    expect(srv.db().query("SELECT name FROM person WHERE id = 1").get()).toEqual({ name: "Oma" });
    expect(srv.db().query("SELECT deleted_at FROM item WHERE id = 1").get()).toEqual({ deleted_at: null });
  });
  test("only the Mac may list originals for its second copy; a bad token is 401", async () => {
    expect((await srv.fetch("/api/export/list", { token: mac.token })).status).toBe(200);
    expect((await srv.fetch("/api/items/1", { method: "DELETE", token: mac.token })).status).toBe(403);
    expect((await srv.fetch("/api/status", { token: "nonsense" })).status).toBe(401);
  });
  test("a device session cookie keeps the device scopes", async () => {
    const r = await srv.fetch("/api/devices/session", { method: "POST", token: mac.token });
    expect(r.status).toBe(200);
    const c = cookieOf(r)!;
    expect((await srv.fetch("/api/index/pending", { cookie: c })).status).toBe(200);
    expect((await srv.fetch("/api/items/1", { method: "DELETE", cookie: c })).status).toBe(403);
    expect((await srv.fetch("/api/timeline", { cookie: c })).status).toBe(403);
    // the web client sees a device, not a login: it runs only the darkroom
    expect(await j(await srv.fetch("/api/auth/state", { cookie: c }))).toMatchObject({ loggedIn: false, device: true });
    // /api/devices/session needs the bearer token itself, a cookie is not enough
    expect((await srv.fetch("/api/devices/session", { method: "POST", cookie: c })).status).toBe(401);
  });
  test("revoking a device kills its token and its sessions at once", async () => {
    const r = await srv.fetch("/api/devices/session", { method: "POST", token: android.token });
    const c = cookieOf(r)!;
    expect((await srv.fetch(`/api/devices/${android.deviceId}`, { method: "DELETE", cookie })).status).toBe(200);
    expect((await srv.fetch("/api/status", { token: android.token })).status).toBe(401);
    expect((await srv.fetch("/api/status", { cookie: c })).status).toBe(401);
    const list = await j(await srv.fetch("/api/devices", { cookie }));
    expect(list.find((d: any) => d.id === android.deviceId).revokedAt).toBeGreaterThan(0);
  });
});

describe("routes that answer without a session", () => {
  test("the label vocabulary state and a JSON body that is not an object are refused", async () => {
    expect((await srv.fetch("/api/index/vocab?model=x")).status).toBe(401);
    const s = await seedSession(srv);
    expect((await srv.fetch("/api/albums", { method: "POST", json: null, cookie: s })).status).toBe(400);
  });
});
