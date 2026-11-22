// The household: everyone in one Monet deployment trusts everyone else (one family, one flat). Each person has
// their own library, their own passkeys and devices, and their own style; everybody may look at everybody's
// photos and search across them. Changing a library (delete, favourite, albums, names of people) stays with its
// owner: those writes keep their `owner_id = ?` checks, so another person's photo simply is not found there.
// Who belongs to the household, their roles and their links are the accounts module's (server/auth.ts).
import { db } from "./db";
import { HttpError } from "./util";
import type { HouseholdOut, Member, Theme } from "../shared/types";

export const THEMES: readonly Theme[] = ["monet", "ernst", "magritte"];

const exists = (id: number) => !!db.query("SELECT 1 FROM owner WHERE id = ?").get(id);
export const ownerIds = () => (db.query("SELECT id FROM owner ORDER BY id").all() as { id: number }[]).map(r => r.id);

export function members(): Member[] {
  const rows = db.query(`SELECT o.id, o.name, o.theme,
      (SELECT count(*) FROM item i WHERE i.owner_id = o.id AND i.deleted_at IS NULL AND i.thumbs_ok = 1 AND (i.burst_rank IS NULL OR i.burst_rank = 1)) AS n,
      (SELECT i.id FROM item i WHERE i.owner_id = o.id AND i.deleted_at IS NULL AND i.thumbs_ok = 1 ORDER BY i.taken_at DESC LIMIT 1) AS cover,
      EXISTS (SELECT 1 FROM auth_passkey k WHERE k.account_id = o.id) AS joined
    FROM owner o ORDER BY o.id`).all() as any[];
  return rows.map(r => ({ id: r.id, name: r.name, theme: THEMES.includes(r.theme) ? r.theme : "monet", count: r.n, cover: r.cover, joined: !!r.joined }));
}
export const household = (me: number): HouseholdOut => ({ me, members: members() });

/** Whose library a browser request reads: the one it names in `X-Monet-Of`, else its own. */
export function readerOf(own: number, named: string | null): number {
  if (!named) return own;
  const id = Number(named);
  if (!Number.isInteger(id) || id <= 0 || !exists(id)) throw new HttpError(404, "Diese Person gibt es hier nicht.");
  return id;
}

export function setProfile(owner: number, b: { name?: unknown; theme?: unknown }) {
  if (b.name !== undefined) {
    const n = String(b.name ?? "").trim().slice(0, 40);
    if (!n) throw new HttpError(400, "Der Name fehlt.");
    // names are unique, ignoring case, as the accounts module keeps them (`monet reset-passkeys <name>` finds one)
    if (db.query("SELECT 1 FROM owner WHERE lower(name) = lower(?) AND id != ?").get(n, owner)) throw new HttpError(409, "Diesen Namen gibt es hier schon.");
    db.query("UPDATE owner SET name = ? WHERE id = ?").run(n, owner);
  }
  if (b.theme !== undefined) {
    if (!THEMES.includes(b.theme as Theme)) throw new HttpError(400, "Diesen Stil gibt es nicht.");
    db.query("UPDATE owner SET theme = ? WHERE id = ?").run(b.theme as string, owner);
  }
}
