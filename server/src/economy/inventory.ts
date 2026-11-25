import { getItem } from "@replicant/shared";
import { GameError, type Tx } from "../db/pool";

/** Adds items to a player's storage in a district. */
export async function addItems(c: Tx, playerId: string, districtId: string, itemId: string, qty: number): Promise<void> {
  if (qty <= 0) return;
  await c.query(
    `INSERT INTO inventories (player_id, district_id, item_id, qty) VALUES ($1, $2, $3, $4)
     ON CONFLICT (player_id, district_id, item_id) DO UPDATE SET qty = inventories.qty + EXCLUDED.qty`,
    [playerId, districtId, itemId, qty],
  );
}

/** Removes free (not escrowed) items. Throws if the player doesn't have enough. */
export async function removeItems(c: Tx, playerId: string, districtId: string, itemId: string, qty: number): Promise<void> {
  const r = await c.query(
    `UPDATE inventories SET qty = qty - $4
     WHERE player_id = $1 AND district_id = $2 AND item_id = $3 AND qty - qty_escrow >= $4`,
    [playerId, districtId, itemId, qty],
  );
  if (r.rowCount !== 1) throw new GameError(`Not enough ${getItem(itemId).name} here (need ${qty}).`);
}

/** Locks free items for a sell order. */
export async function escrowItems(c: Tx, playerId: string, districtId: string, itemId: string, qty: number): Promise<void> {
  const r = await c.query(
    `UPDATE inventories SET qty_escrow = qty_escrow + $4
     WHERE player_id = $1 AND district_id = $2 AND item_id = $3 AND qty - qty_escrow >= $4`,
    [playerId, districtId, itemId, qty],
  );
  if (r.rowCount !== 1) throw new GameError(`Not enough ${getItem(itemId).name} here to sell (need ${qty}).`);
}

/** Unlocks escrowed items (order cancelled or expired). */
export async function releaseItems(c: Tx, playerId: string, districtId: string, itemId: string, qty: number): Promise<void> {
  await c.query(
    `UPDATE inventories SET qty_escrow = qty_escrow - $4
     WHERE player_id = $1 AND district_id = $2 AND item_id = $3`,
    [playerId, districtId, itemId, qty],
  );
}

/** Removes escrowed items that were sold. */
export async function deliverEscrowedItems(c: Tx, playerId: string, districtId: string, itemId: string, qty: number): Promise<void> {
  const r = await c.query(
    `UPDATE inventories SET qty = qty - $4, qty_escrow = qty_escrow - $4
     WHERE player_id = $1 AND district_id = $2 AND item_id = $3 AND qty_escrow >= $4`,
    [playerId, districtId, itemId, qty],
  );
  if (r.rowCount !== 1) throw new Error(`Escrow mismatch for ${playerId} ${districtId} ${itemId}`);
}
