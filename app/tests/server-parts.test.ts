// Unfinished uploads do not pile up: a part untouched for a day is removed, a fresh one stays for its client to resume.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./helpers";

test("evictParts removes parts older than a day and keeps the rest", async () => {
  const dir = mkdtempSync(join(tmpdir(), "monet-parts-")), up = join(dir, "data", "up");
  mkdirSync(up, { recursive: true });
  const old = join(up, "a".repeat(64) + ".part"), fresh = join(up, "b".repeat(64) + ".part");
  writeFileSync(old, "x"); writeFileSync(fresh, "y");
  const twoDaysAgo = (Date.now() - 2 * 86400_000) / 1000;
  utimesSync(old, twoDaysAgo, twoDaysAgo);
  const p = Bun.spawn(["bun", "-e", `const { evictParts } = await import(${JSON.stringify(join(ROOT, "server/upload.ts"))}); console.log(evictParts());`],
    { cwd: ROOT, stdout: "pipe", stderr: "pipe", env: { ...process.env, MONET_DB: join(dir, "monet.db"), MONET_DATA: join(dir, "data"), MONET_ORIGINALS: join(dir, "originals") } });
  const out = await new Response(p.stdout).text(); await p.exited;
  expect(out.trim()).toBe("1");
  expect(existsSync(old)).toBe(false);
  expect(existsSync(fresh)).toBe(true);
  rmSync(dir, { recursive: true, force: true });
});
