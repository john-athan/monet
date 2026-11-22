import { test, expect } from "bun:test";
import { Sha256, hashFile } from "../client/lib/sha256";

const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b instanceof Uint8Array ? b.buffer.slice(b.byteOffset, b.byteOffset + b.length) : b)].map(x => x.toString(16).padStart(2, "0")).join("");
const web = async (d: Uint8Array) => hex(await crypto.subtle.digest("SHA-256", d));

test("known vectors", () => {
  expect(new Sha256().hex()).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  expect(new Sha256().update(new TextEncoder().encode("abc")).hex()).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  expect(new Sha256().update(new TextEncoder().encode("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).hex()).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
});

test("matches WebCrypto on random buffers of every awkward length", async () => {
  for (const n of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 4096, 65537, 1_000_003]) {
    const d = new Uint8Array(n); for (let i = 0; i < n; i += 65536) crypto.getRandomValues(d.subarray(i, Math.min(n, i + 65536)));
    expect(new Sha256().update(d).hex()).toBe(await web(d));
  }
});

test("matches WebCrypto when fed in random slices", async () => {
  const d = new Uint8Array(300_000); for (let i = 0; i < d.length; i += 65536) crypto.getRandomValues(d.subarray(i, Math.min(d.length, i + 65536)));
  for (let round = 0; round < 8; round++) {
    const s = new Sha256(); let at = 0;
    while (at < d.length) { const n = 1 + Math.floor(Math.random() * 9000); s.update(d.subarray(at, at + n)); at += n; }
    expect(s.hex()).toBe(await web(d));
  }
});

test("hashFile streams a Blob", async () => {
  const d = new Uint8Array(5_000_000); for (let i = 0; i < d.length; i += 65536) crypto.getRandomValues(d.subarray(i, Math.min(d.length, i + 65536)));
  let last = 0;
  expect(await hashFile(new Blob([d]), n => { last = n; })).toBe(await web(d));
  expect(last).toBe(d.length);
});
