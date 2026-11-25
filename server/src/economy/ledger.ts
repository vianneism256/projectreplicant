import type { LedgerKind } from "@replicant/shared";
import type { Tx } from "../db/pool";

export interface LedgerEntry {
  kind: LedgerKind;
  /** What caused it: 'starter_grant', 'salvage', 'broker_fee', 'sales_tax', 'facility_fee', 'refine_loss', ... */
  source: string;
  playerId?: string;
  districtId?: string;
  /** Credits created (+) or destroyed (-). */
  credits?: number;
  itemId?: string;
  /** Items created (+) or destroyed (-). */
  qty?: number;
  ref?: string;
}

/**
 * Every value change goes through here (design doc section 15).
 * Invariant: total credits held by players == sum of ledger credits.
 */
export async function writeLedger(c: Tx, e: LedgerEntry): Promise<void> {
  await c.query(
    `INSERT INTO ledger (kind, source, player_id, district_id, credits, item_id, qty, ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [e.kind, e.source, e.playerId ?? null, e.districtId ?? null, e.credits ?? 0, e.itemId ?? null, e.qty ?? 0, e.ref ?? null],
  );
}
