// Test support: a real server process on a temp directory, a session made directly in its database, and a software
// WebAuthn authenticator built from WebCrypto (ES256 and RS256).
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..");
export const GEONAMES = join(ROOT, "data/geonames/cities15000.txt");

export type Srv = { origin: string; dir: string; env: Record<string, string>; cli: (...args: string[]) => Promise<string>; db: () => Database; stop: () => Promise<void>; fetch: (path: string, init?: RequestInit & { token?: string; cookie?: string; json?: unknown; origin?: string | null }) => Promise<Response> };

let n = 0;
export async function startServer(env: Record<string, string> = {}): Promise<Srv> {
  const dir = mkdtempSync(join(tmpdir(), "monet-test-"));
  for (let attempt = 0; attempt < 8; attempt++) {
    const port = 20000 + Math.floor(Math.random() * 30000), origin = `http://127.0.0.1:${port}`;
    const full = { ...process.env, PORT: String(port), HOST: "127.0.0.1", MONET_ORIGIN: origin, MONET_DB: join(dir, "monet.db"), MONET_DATA: join(dir, "data"), MONET_ORIGINALS: join(dir, "originals"),
      MONET_GEONAMES: GEONAMES, MONET_DIST: join(dir, "dist"), MONET_MODELS: join(dir, "models"), ...env } as Record<string, string>;
    const proc = Bun.spawn(["bun", join(ROOT, "server/main.ts")], { cwd: ROOT, stdout: "ignore", stderr: "pipe", env: full });
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      if (proc.exitCode != null) break;
      up = await fetch(origin + "/healthz").then(r => r.ok, () => false);
      if (!up) await Bun.sleep(100);
    }
    if (!up) { proc.kill(); continue; }
    let dbh: Database | null = null;
    return {
      origin, dir, env: full,
      cli: async (...args) => { const p = Bun.spawn(["bun", join(ROOT, "server/main.ts"), ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe", env: full }); const out = await new Response(p.stdout).text(); await p.exited; return out; },
      db: () => (dbh ??= new Database(join(dir, "monet.db"))),
      stop: async () => { proc.kill(); await proc.exited; dbh?.close(); rmSync(dir, { recursive: true, force: true }); },
      fetch: (path, init = {}) => {
        const { token, cookie, json, origin: o, ...rest } = init;
        // every call comes from its own "client address" unless the test names one, so the per-IP rate limits only bite where a test asks
        const headers: Record<string, string> = { "x-forwarded-for": `10.${(++n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`, ...(rest.headers as Record<string, string> ?? {}) };
        if (token) headers.authorization = `Bearer ${token}`;
        if (cookie) headers.cookie = `__Host-monet=${cookie}`;
        if (o !== null && !token && /^(POST|PUT|PATCH|DELETE)$/.test(rest.method ?? "")) headers.origin = o ?? origin;
        if (json !== undefined) { headers["content-type"] = "application/json"; (rest as any).body = JSON.stringify(json); }
        return fetch(origin + path, { ...rest, headers });
      },
    };
  }
  throw new Error("could not start the server");
}

/** A browser session written straight into the database (the login ceremony is tested separately). The first
 *  person made here is the household's admin, as the setup link would have made them. */
export async function seedSession(srv: Srv): Promise<string> {
  const db = srv.db();
  let owner = (db.query("SELECT id FROM owner LIMIT 1").get() as { id: number } | null)?.id;
  if (!owner) owner = (db.query("INSERT INTO owner (name, role, created_at) VALUES ('Test', 'admin', ?) RETURNING id").get(Date.now()) as { id: number }).id;
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const hash = new Bun.CryptoHasher("sha256").update(token).digest("hex");
  db.query("INSERT INTO auth_session (hash, account_id, kind, created_at, expires_at, last_seen_at) VALUES (?, ?, 'browser', ?, ?, ?)").run(hash, owner, Date.now(), Date.now() + 86400_000, Date.now());
  return token;
}

/** The real pairing flow: a logged-in session asks for a code, a device claims it. */
export async function pairDevice(srv: Srv, cookie: string, kind: "android" | "mac" = "android") {
  const code = await (await srv.fetch("/api/devices/pair", { method: "POST", cookie })).json() as { code: string };
  const r = await srv.fetch("/api/devices/claim", { method: "POST", json: { code: code.code, name: `Test ${kind}`, kind }, origin: null });
  return await r.json() as { token: string; deviceId: number };
}

/* ---------- CBOR encoder, just enough for an attestation object ---------- */
const head = (major: number, n: number): number[] => n < 24 ? [major << 5 | n] : n < 256 ? [major << 5 | 24, n] : [major << 5 | 25, n >> 8, n & 255];
export function cbor(v: any): Uint8Array {
  const out: number[] = [];
  const w = (x: any) => {
    if (typeof x === "number") out.push(...(x >= 0 ? head(0, x) : head(1, -1 - x)));
    else if (typeof x === "string") { const b = new TextEncoder().encode(x); out.push(...head(3, b.length), ...b); }
    else if (x instanceof Uint8Array) out.push(...head(2, x.length), ...x);
    else if (x instanceof Map) { out.push(...head(5, x.size)); for (const [k, val] of x) { w(k); w(val); } }
    else throw new Error("cbor: unsupported");
  };
  w(v); return new Uint8Array(out);
}
const b64u = (b: Uint8Array | ArrayBuffer) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString("base64url");
const unb64u = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));
const sha = async (d: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", d));
const concat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
function rawToDer(raw: Uint8Array) {
  const int = (b: Uint8Array) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; let v = b.slice(i); if (v[0] & 0x80) v = concat(new Uint8Array([0]), v); return concat(new Uint8Array([2, v.length]), v); };
  const body = concat(int(raw.slice(0, 32)), int(raw.slice(32)));
  return concat(new Uint8Array([0x30, body.length]), body);
}

export class SoftAuthenticator {
  signCount = 0;
  constructor(public alg: -7 | -257, public pair: CryptoKeyPair, public credId: Uint8Array, public rpId: string) {}
  static async create(rpId: string, alg: -7 | -257 = -7) {
    const pair = alg === -7
      ? await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair
      : await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
    return new SoftAuthenticator(alg, pair, crypto.getRandomValues(new Uint8Array(16)), rpId);
  }
  get id() { return b64u(this.credId); }
  private async cose(): Promise<Uint8Array> {
    const jwk = await crypto.subtle.exportKey("jwk", this.pair.publicKey);
    return this.alg === -7
      ? cbor(new Map<number, any>([[1, 2], [3, -7], [-1, 1], [-2, unb64u(jwk.x!)], [-3, unb64u(jwk.y!)]]))
      : cbor(new Map<number, any>([[1, 3], [3, -257], [-1, unb64u(jwk.n!)], [-2, unb64u(jwk.e!)]]));
  }
  private flagsAndCount(flags: number) { const c = new Uint8Array(5); c[0] = flags; new DataView(c.buffer).setUint32(1, this.signCount); return c; }
  async register(options: any, origin: string, o: { flags?: number; rpId?: string; origin?: string } = {}) {
    const clientData = new TextEncoder().encode(JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin: o.origin ?? origin, crossOrigin: false }));
    const idLen = new Uint8Array([this.credId.length >> 8, this.credId.length & 255]);
    const authData = concat(await sha(new TextEncoder().encode(o.rpId ?? this.rpId)), this.flagsAndCount(o.flags ?? 0x45), new Uint8Array(16), idLen, this.credId, await this.cose());
    const att = cbor(new Map<string, any>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]));
    return { id: this.id, rawId: this.id, type: "public-key", response: { clientDataJSON: b64u(clientData), attestationObject: b64u(att) } };
  }
  async login(options: any, origin: string, o: { flags?: number; type?: string; signWith?: CryptoKey; count?: number } = {}) {
    this.signCount = o.count ?? this.signCount + 1;
    const clientData = new TextEncoder().encode(JSON.stringify({ type: o.type ?? "webauthn.get", challenge: options.challenge, origin, crossOrigin: false }));
    const authData = concat(await sha(new TextEncoder().encode(this.rpId)), this.flagsAndCount(o.flags ?? 0x05));
    const signed = concat(authData, await sha(clientData));
    const key = o.signWith ?? this.pair.privateKey;
    const sig = new Uint8Array(await crypto.subtle.sign(this.alg === -7 ? { name: "ECDSA", hash: "SHA-256" } : { name: "RSASSA-PKCS1-v1_5" }, key, signed));
    return { id: this.id, rawId: this.id, type: "public-key", response: { clientDataJSON: b64u(clientData), authenticatorData: b64u(authData), signature: b64u(this.alg === -7 ? rawToDer(sig) : sig), userHandle: null } };
  }
}
