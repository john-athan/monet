import { test, expect } from "bun:test";
import { startServer } from "./helpers";

test("the asset links let the Android app open this origin full screen, without a login", async () => {
  const srv = await startServer();
  try {
    const r = await srv.fetch("/.well-known/assetlinks.json");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/json");
    const [s] = await r.json() as any[];
    expect(s.relation).toEqual(["delegate_permission/common.handle_all_urls"]);
    expect(s.target.package_name).toBe("dev.kaleve.monet");
    for (const f of s.target.sha256_cert_fingerprints) expect(f).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  } finally { await srv.stop(); }
});
