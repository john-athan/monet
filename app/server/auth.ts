// Who is asking: the fleet's accounts module (server/accounts, docs/accounts.md) configured for Monet. Passkeys,
// links, roles, sessions, paired devices and rate limits live there; this file only says what is Monet's.
import { db } from "./db";
import { createAccounts, type Principal } from "./accounts";
import { THEMES } from "./household";
import type { Theme } from "../shared/types";

export type { Principal };
export const ORIGIN = process.env.MONET_ORIGIN ?? "https://monet.kaleve.dev";

/** The Mac may also export originals for its second copy; Android may not read anything back. */
const DEVICES = { android: "upload,index", mac: "upload,index,export" };

export const accounts = createAccounts({
  db, table: "owner", app: "Monet", origin: ORIGIN, cookie: "__Host-monet", lang: "de",
  setupToken: process.env.MONET_SETUP_TOKEN || null, devices: DEVICES,
  // a new person brings their style along from the invite (web form or `monet invite <name> --theme ernst`)
  onCreate: (id, input) => { if (THEMES.includes(input.theme as Theme)) db.query("UPDATE owner SET theme = ? WHERE id = ?").run(input.theme as string, id); },
  // photos someone else dropped into a library before its owner joined, albums, named people: never deleted with the account
  hasData: id => !!db.query("SELECT 1 FROM item WHERE owner_id = ? UNION ALL SELECT 1 FROM album WHERE owner_id = ? UNION ALL SELECT 1 FROM person WHERE owner_id = ? LIMIT 1").get(id, id, id),
  deviceInfo: id => {
    const r = db.query("SELECT count(*) AS n, max(uploaded_at) AS last FROM item WHERE device_id = ?").get(id) as { n: number; last: number | null };
    return { uploads: r.n, lastUpload: r.last };
  },
});

export const principalFor = accounts.principal;
export const can = accounts.can;
export const clientIp = accounts.clientIp;
export const sameOrigin = accounts.sameOrigin;
export const limited = accounts.limited;
