// Small helpers every module shares. Nothing here knows about the database or HTTP routes.
import { timingSafeEqual } from "node:crypto";

export const now = () => Date.now();
export const b64u = {
  enc: (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString("base64url"),
  dec: (s: string) => new Uint8Array(Buffer.from(s, "base64url")),
};
export const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
export async function sha256(d: Uint8Array | string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", typeof d === "string" ? new TextEncoder().encode(d) : d));
}
export const sha256hex = async (d: Uint8Array | string) => hex(await sha256(d));
export const randomToken = (bytes = 32) => b64u.enc(crypto.getRandomValues(new Uint8Array(bytes)));

/** Compares secrets in constant time (both are hashed first so lengths do not leak). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  return timingSafeEqual(x, y);
}

/** base64 (std or url-safe) little-endian float32 vector. Returns null when the length is wrong. */
export function decodeVec(s: unknown, dim: number): Float32Array | null {
  if (typeof s !== "string") return null;
  const bytes = Buffer.from(s, "base64");
  if (bytes.length !== dim * 4) return null;
  const v = new Float32Array(dim);
  new Uint8Array(v.buffer).set(bytes);
  for (const x of v) if (!Number.isFinite(x)) return null;
  return v;
}
export const vecBlob = (v: Float32Array) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
export const blobVec = (b: Uint8Array) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
export function normalise(v: Float32Array): Float32Array {
  let n = 0; for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  const o = new Float32Array(v.length); for (let i = 0; i < v.length; i++) o[i] = v[i] / n;
  return o;
}
export function dot(a: Float32Array, b: Float32Array, off = 0): number {
  let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[off + i];
  return s;
}

export const json = <T>(s: string | null | undefined, fallback: T): T => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };

/* ---------- time ---------- */
const BERLIN = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
/** Offset of Europe/Berlin at a UTC instant, in minutes (60 or 120). */
export function berlinOffsetMin(utcMs: number): number {
  const p = Object.fromEntries(BERLIN.formatToParts(new Date(utcMs)).map(x => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}
/** A wall-clock time with no zone, read as Europe/Berlin (the owner's home), to UTC ms. DST gaps resolve forward. */
export function berlinWallToUtc(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let off = berlinOffsetMin(guess - 2 * 3600_000);
  let t = guess - off * 60000;
  off = berlinOffsetMin(t);
  t = guess - off * 60000;
  return t;
}
/** Local calendar day (YYYY-MM-DD) of a UTC instant: with the item's own offset when known, else Europe/Berlin. */
export function localDay(utcMs: number, tzMin: number | null): string {
  const off = tzMin ?? berlinOffsetMin(utcMs);
  return new Date(utcMs + off * 60000).toISOString().slice(0, 10);
}
export const todayBerlin = (t = now()) => localDay(t, null);

/* ---------- http ---------- */
export const J = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });
export const fail = (status: number, message: string, extra: Record<string, unknown> = {}) => J({ error: message, ...extra }, status);
export class HttpError extends Error { constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message); } }

/** Runs a command with a timeout; returns stdout as bytes. Throws with stderr on failure. */
export async function run(cmd: string[], timeoutMs = 60_000, env?: Record<string, string>): Promise<Uint8Array> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore", env: env ? { ...process.env, ...env } : undefined });
  const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
  try {
    const [out, err, code] = await Promise.all([new Response(p.stdout).arrayBuffer(), new Response(p.stderr).text(), p.exited]);
    if (code !== 0) throw new Error(`${cmd[0]} exited ${code}${p.killed ? " (timeout)" : ""}: ${err.trim().slice(0, 300)}`);
    return new Uint8Array(out);
  } finally { clearTimeout(timer); }
}
export const runText = async (cmd: string[], t?: number, env?: Record<string, string>) => new TextDecoder().decode(await run(cmd, t, env));
