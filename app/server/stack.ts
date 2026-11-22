// Stacks: takes of the same shot shown as one photo with a count. Two ways in:
//  - a burst (ingest.updateBurst): same camera within 2 s, decided at upload, before any vector exists;
//  - a variation (here): same camera within STACK_GAP_MS of a neighbour and an image vector at least STACK_SIM
//    alike, decided once the vector arrives. Both share item.burst_id, so the timeline, ranking and the detail
//    strip treat them alike.
// The owner can take a photo out of its stack; `unstacked` then keeps it out for good, whatever the vectors say.
import { db, metaGet, metaSet } from "./db";
import { joinStack, rankBurst } from "./ingest";
import { blobVec, dot } from "./util";
import { CLIP_MODEL } from "./search";

/** Calibrated on a month of real holiday photos on 2026-11-21 with SigLIP 2 vectors: all 48 pairs
 *  from one camera within 30 s, judged by eye. At 0.90 fifteen retakes stack (canyon 0.981, harbour 0.955, sunset
 *  0.921, the same pool from two angles 0.913) and one pan along the same cliff does too (0.931, the price); the alley
 *  taken twice (0.888) and two night harbour shots (0.869, 0.851) stay apart, a safe miss. Mirror against scratch
 *  on one car, 5 s apart, is 0.853. CLIP at its old 0.88 found 12 of the retakes. The margin stays
 *  thin, which is why a stack can always be undone. */
export const STACK_SIM = 0.9;
export const STACK_GAP_MS = 30_000;

type Row = { id: number; owner_id: number; kind: string; camera: string | null; taken_at: number; burst_id: number | null; unstacked: number };

/** Joins `itemId` with its similar neighbours, merging their stacks. Safe to run again. */
export function stackSimilar(itemId: number): boolean {
  const it = db.query("SELECT id, owner_id, kind, camera, taken_at, burst_id, unstacked FROM item WHERE id = ? AND deleted_at IS NULL").get(itemId) as Row | null;
  // no camera (WhatsApp, screenshots, downloads): two such files are no evidence of one shot
  if (!it || it.kind !== "photo" || !it.camera || it.unstacked) return false;
  const own = db.query("SELECT vec FROM clip WHERE item_id = ? AND model = ?").get(itemId, CLIP_MODEL) as { vec: Uint8Array } | null;
  if (!own) return false;
  const v = blobVec(own.vec);
  // only vectors of the same model compare: while a library is re-analysed both kinds sit in the table
  const near = db.query(`SELECT i.id, i.burst_id, c.vec FROM item i JOIN clip c ON c.item_id = i.id AND c.model = ?
    WHERE i.owner_id = ? AND i.kind = 'photo' AND i.camera = ? AND i.id != ? AND i.unstacked = 0 AND i.deleted_at IS NULL
      AND i.taken_at BETWEEN ? AND ?`).all(CLIP_MODEL, it.owner_id, it.camera, it.id, it.taken_at - STACK_GAP_MS, it.taken_at + STACK_GAP_MS) as { id: number; burst_id: number | null; vec: Uint8Array }[];
  const match = near.filter(n => dot(v, blobVec(n.vec), 0) >= STACK_SIM);
  return match.length ? joinStack(it, match) : false;
}

/** Takes one photo out of its stack and keeps it out. The rest of the stack stays together and is ranked again. */
export function unstack(owner: number, itemId: number): boolean {
  const it = db.query("SELECT burst_id FROM item WHERE id = ? AND owner_id = ?").get(itemId, owner) as { burst_id: number | null } | null;
  if (!it) return false;
  db.transaction(() => {
    db.query("UPDATE item SET burst_id = NULL, burst_rank = NULL, unstacked = 1 WHERE id = ?").run(itemId);
    if (it.burst_id != null) {
      const left = db.query("SELECT id FROM item WHERE burst_id = ? AND deleted_at IS NULL").all(it.burst_id) as { id: number }[];
      // a stack of one is no stack: its last member becomes a plain photo again
      if (left.length <= 1) db.query("UPDATE item SET burst_id = NULL, burst_rank = NULL WHERE burst_id = ?").run(it.burst_id);
      else {
        // the stack is named after its smallest member; if that was the one leaving, rename it
        const keep = Math.min(...left.map(l => l.id));
        if (keep !== it.burst_id) db.query("UPDATE item SET burst_id = ? WHERE burst_id = ?").run(keep, it.burst_id);
        rankBurst(keep);
      }
    }
  })();
  return true;
}

/** Once per rule version: stack the library that was analysed before this rule existed. */
export function restackAll(): number {
  const key = `stack_rule_${CLIP_MODEL}_${STACK_SIM}_${STACK_GAP_MS}`;
  if (metaGet(key)) return 0;
  let n = 0;
  for (const r of db.query("SELECT i.id FROM item i JOIN clip c ON c.item_id = i.id AND c.model = ? WHERE i.kind = 'photo' AND i.deleted_at IS NULL ORDER BY i.taken_at").all(CLIP_MODEL) as { id: number }[]) if (stackSimilar(r.id)) n++;
  metaSet(key, "1");
  return n;
}
