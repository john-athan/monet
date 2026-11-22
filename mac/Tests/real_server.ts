// Starts the real Monet server (app/server/main.ts) on a temp dir with a seeded browser session, creates a
// pairing code the way the Geräte page would, prints {origin, code, dir} as one JSON line and stays up.
// Test only: it reuses app/tests/helpers.ts (the WebAuthn-free path the server tests use).
import { startServer, seedSession } from "../../app/tests/helpers";
const srv = await startServer();
const cookie = await seedSession(srv);
const r = await srv.fetch("/api/devices/pair", { method: "POST", cookie });
const { code } = await r.json() as { code: string };
console.log(JSON.stringify({ origin: srv.origin, code, dir: srv.dir, cookie }));
process.on("SIGTERM", async () => { await srv.stop(); process.exit(0); });
process.on("SIGINT", async () => { await srv.stop(); process.exit(0); });
await new Promise(() => {});
