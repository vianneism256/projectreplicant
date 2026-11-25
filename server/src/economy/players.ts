import { ECONOMY } from "@replicant/shared";
import { GameError, type Tx } from "../db/pool";
import { writeLedger } from "./ledger";
import { addItems } from "./inventory";

export interface PlayerRow {
  id: string;
  handle: string;
  credits: number;
  credits_escrow: number;
  location: string;
  last_salvage_at: Date | null;
  transit_until: Date | null;
}

export async function createPlayer(c: Tx, handle: string): Promise<PlayerRow> {
  const clean = handle.trim();
  if (!/^[A-Za-z0-9_-]{3,20}$/.test(clean)) {
    throw new GameError("Handle must be 3–20 letters, numbers, _ or -.");
  }
  const existing = await c.query("SELECT 1 FROM players WHERE lower(handle) = lower($1)", [clean]);
  if (existing.rowCount) throw new GameError("That handle is taken.");

  const r = await c.query<PlayerRow>(
    `INSERT INTO players (handle, credits, location) VALUES ($1, $2, $3) RETURNING *`,
    [clean, ECONOMY.starterGrant, ECONOMY.startingDistrict],
  );
  const p = r.rows[0]!;
  await writeLedger(c, { kind: "faucet", source: "starter_grant", playerId: p.id, credits: ECONOMY.starterGrant });
  return p;
}

/**
 * Locks the player row for this transaction, delivers any finished hauls,
 * and (unless allowTransit) refuses to act while travelling.
 */
export async function lockPlayer(c: Tx, playerId: string, opts: { allowTransit?: boolean } = {}): Promise<PlayerRow> {
  const r = await c.query<PlayerRow>("SELECT * FROM players WHERE id = $1 FOR UPDATE", [playerId]);
  const p = r.rows[0];
  if (!p) throw new GameError("Player not found.", 404);
  await deliverArrivedHauls(c, playerId);
  if (!opts.allowTransit) {
    const t = await c.query<{ secs: number }>(
      "SELECT ceil(extract(epoch FROM transit_until - now()))::int AS secs FROM players WHERE id = $1 AND transit_until > now()",
      [playerId],
    );
    if (t.rowCount) throw new GameError(`You're in transit to ${p.location}. Arriving in ${t.rows[0]!.secs}s.`);
  }
  return p;
}

/** Moves cargo from finished hauls into the destination district's storage. */
export async function deliverArrivedHauls(c: Tx, playerId: string): Promise<void> {
  const r = await c.query<{ to_id: string; item_id: string; qty: number }>(
    `UPDATE hauls SET delivered = true
     WHERE player_id = $1 AND NOT delivered AND arrives_at <= now()
     RETURNING to_id, item_id, qty`,
    [playerId],
  );
  for (const h of r.rows) await addItems(c, playerId, h.to_id, h.item_id, h.qty);
}

/** Takes credits from a player's free balance. Throws if they can't afford it. */
export async function spendCredits(c: Tx, playerId: string, amount: number, what: string): Promise<void> {
  if (amount <= 0) return;
  const r = await c.query("UPDATE players SET credits = credits - $2 WHERE id = $1 AND credits >= $2", [playerId, amount]);
  if (r.rowCount !== 1) throw new GameError(`Not enough credits for ${what} (need ${amount.toLocaleString()} cr).`);
}
