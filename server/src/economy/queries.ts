import { ECONOMY } from "@replicant/shared";
import { tx, GameError, type Db } from "../db/pool";
import { deliverArrivedHauls } from "./players";

/** Everything the player screen needs in one call. */
export async function getPlayerView(db: Db, playerId: string) {
  return tx(db, async (c) => {
    const pr = await c.query(
      `SELECT id, handle, credits, credits_escrow, location,
              CASE WHEN transit_until > now() THEN ceil(extract(epoch FROM transit_until - now()))::int ELSE 0 END AS transit_seconds,
              CASE WHEN last_salvage_at IS NULL THEN 0
                   ELSE greatest(0, ceil(extract(epoch FROM last_salvage_at + make_interval(secs => $2) - now())))::int END AS salvage_cooldown
       FROM players WHERE id = $1 FOR UPDATE`,
      [playerId, ECONOMY.salvageCooldownSeconds],
    );
    const player = pr.rows[0];
    if (!player) throw new GameError("Player not found.", 404);
    await deliverArrivedHauls(c, playerId);

    const inventory = await c.query(
      `SELECT district_id, item_id, qty, qty_escrow FROM inventories
       WHERE player_id = $1 AND qty > 0 ORDER BY district_id, item_id`,
      [playerId],
    );
    const orders = await c.query(
      `SELECT id, district_id, item_id, side, price, qty, remaining, created_at, expires_at FROM orders
       WHERE player_id = $1 AND status = 'open' ORDER BY created_at DESC`,
      [playerId],
    );
    const jobs = await c.query(
      `SELECT id, district_id, recipe_id, runs, started_at, finishes_at,
              greatest(0, ceil(extract(epoch FROM finishes_at - now())))::int AS seconds_left
       FROM industry_jobs WHERE player_id = $1 AND status = 'running' ORDER BY finishes_at`,
      [playerId],
    );
    const hauls = await c.query(
      `SELECT trip_id, from_id, to_id, item_id, qty, arrives_at FROM hauls
       WHERE player_id = $1 AND NOT delivered ORDER BY arrives_at`,
      [playerId],
    );
    return { player, inventory: inventory.rows, orders: orders.rows, jobs: jobs.rows, hauls: hauls.rows };
  });
}

/**
 * Faucet / sink dashboard (design doc section 15).
 * moneySupply should always equal ledgerCredits; if not, value leaked somewhere.
 */
export async function getEconomySummary(db: Db, hours = 24) {
  const bySource = await db.query(
    `SELECT kind, source, sum(credits)::bigint AS credits, sum(qty)::bigint AS qty, count(*)::int AS entries
     FROM ledger WHERE created_at > now() - make_interval(hours => $1)
     GROUP BY kind, source ORDER BY kind, source`,
    [hours],
  );
  const supply = await db.query<{ money_supply: number; players: number }>(
    "SELECT coalesce(sum(credits + credits_escrow), 0)::bigint AS money_supply, count(*)::int AS players FROM players",
  );
  const ledger = await db.query<{ ledger_credits: number }>(
    "SELECT coalesce(sum(credits), 0)::bigint AS ledger_credits FROM ledger WHERE kind IN ('faucet', 'sink')",
  );
  const s = supply.rows[0]!;
  const l = ledger.rows[0]!;
  return {
    hours,
    players: s.players,
    moneySupply: s.money_supply,
    ledgerCredits: l.ledger_credits,
    balanced: s.money_supply === l.ledger_credits,
    bySource: bySource.rows,
  };
}
