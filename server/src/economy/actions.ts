import { DISTRICTS_BY_ID, ECONOMY, RECIPES_BY_ID, getItem, routeSeconds } from "@replicant/shared";
import { GameError, tx, type Db } from "../db/pool";
import { addItems, removeItems } from "./inventory";
import { writeLedger } from "./ledger";
import { lockPlayer, spendCredits } from "./players";

export type Rng = () => number;

// ---------------------------------------------------------------- Salvage (item faucet)

export interface SalvageResult {
  itemId: string;
  qty: number;
  districtId: string;
}

/** Pulls random raw resources from the player's district salvage table. */
export async function salvage(db: Db, playerId: string, rng: Rng = Math.random): Promise<SalvageResult> {
  return tx(db, async (c) => {
    const p = await lockPlayer(c, playerId);
    const cd = await c.query<{ secs: number }>(
      `SELECT ceil(extract(epoch FROM last_salvage_at + make_interval(secs => $2) - now()))::int AS secs
       FROM players WHERE id = $1 AND last_salvage_at + make_interval(secs => $2) > now()`,
      [playerId, ECONOMY.salvageCooldownSeconds],
    );
    if (cd.rowCount) throw new GameError(`Salvage is on cooldown for ${cd.rows[0]!.secs}s.`);

    const district = DISTRICTS_BY_ID.get(p.location);
    if (!district || district.salvage.length === 0) throw new GameError("Nothing to salvage here.");

    const total = district.salvage.reduce((s, e) => s + e.weight, 0);
    let roll = rng() * total;
    let entry = district.salvage[district.salvage.length - 1]!;
    for (const e of district.salvage) {
      roll -= e.weight;
      if (roll < 0) {
        entry = e;
        break;
      }
    }
    const qty = entry.min + Math.floor(rng() * (entry.max - entry.min + 1));

    await addItems(c, playerId, district.id, entry.itemId, qty);
    await c.query("UPDATE players SET last_salvage_at = now() WHERE id = $1", [playerId]);
    await writeLedger(c, { kind: "faucet", source: "salvage", playerId, districtId: district.id, itemId: entry.itemId, qty });
    return { itemId: entry.itemId, qty, districtId: district.id };
  });
}

// ---------------------------------------------------------------- Industry (transforms + sinks)

export interface JobRow {
  id: number;
  district_id: string;
  recipe_id: string;
  runs: number;
  status: string;
  started_at: Date;
  finishes_at: Date;
}

/** Starts an industry job at an NPC facility in the player's district. Inputs are consumed now. */
export async function startJob(db: Db, playerId: string, recipeId: string, runs: number): Promise<JobRow & { facilityFee: number }> {
  const recipe = RECIPES_BY_ID.get(recipeId);
  if (!recipe) throw new GameError(`Unknown recipe: ${recipeId}`);
  if (!Number.isInteger(runs) || runs < 1 || runs > ECONOMY.maxRunsPerJob) {
    throw new GameError(`Runs must be 1–${ECONOMY.maxRunsPerJob}.`);
  }

  return tx(db, async (c) => {
    const p = await lockPlayer(c, playerId);
    const district = DISTRICTS_BY_ID.get(p.location)!;
    if (!district.npcFacilities) throw new GameError(`No ${recipe.facility} in ${district.name}. NPC facilities are in the Arcologies.`);

    let inputValue = 0;
    for (const input of recipe.inputs) {
      const qty = input.qty * runs;
      await removeItems(c, playerId, district.id, input.itemId, qty);
      await writeLedger(c, { kind: "transform", source: "industry_input", playerId, districtId: district.id, itemId: input.itemId, qty: -qty });
      inputValue += getItem(input.itemId).baseValue * qty;
    }

    const facilityFee = Math.ceil(inputValue * ECONOMY.facilityFeeRate);
    await spendCredits(c, playerId, facilityFee, "the facility fee");
    if (facilityFee > 0) {
      await writeLedger(c, { kind: "sink", source: "facility_fee", playerId, districtId: district.id, credits: -facilityFee, ref: `recipe:${recipeId}` });
    }

    const r = await c.query<JobRow>(
      `INSERT INTO industry_jobs (player_id, district_id, recipe_id, runs, finishes_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))
       RETURNING id, district_id, recipe_id, runs, status, started_at, finishes_at`,
      [playerId, district.id, recipeId, runs, recipe.seconds * runs],
    );
    return { ...r.rows[0]!, facilityFee };
  });
}

export interface CollectResult {
  jobId: number;
  outputs: { itemId: string; qty: number; lost: number }[];
}

/** Collects a finished job. Outputs land in the job's district. Refining yield loss is an item sink. */
export async function collectJob(db: Db, playerId: string, jobId: number): Promise<CollectResult> {
  return tx(db, async (c) => {
    await lockPlayer(c, playerId, { allowTransit: true });
    const r = await c.query<JobRow & { secs_left: number }>(
      `SELECT *, ceil(extract(epoch FROM finishes_at - now()))::int AS secs_left FROM industry_jobs
       WHERE id = $1 AND player_id = $2 FOR UPDATE`,
      [jobId, playerId],
    );
    const job = r.rows[0];
    if (!job) throw new GameError("Job not found.", 404);
    if (job.status !== "running") throw new GameError("That job was already collected.");
    if (job.secs_left > 0) throw new GameError(`Job finishes in ${job.secs_left}s.`);

    const recipe = RECIPES_BY_ID.get(job.recipe_id)!;
    const outputs: CollectResult["outputs"] = [];
    for (const out of recipe.outputs) {
      const full = out.qty * job.runs;
      const qty = recipe.baseYield !== undefined ? Math.floor(full * recipe.baseYield) : full;
      const lost = full - qty;
      await addItems(c, playerId, job.district_id, out.itemId, qty);
      await writeLedger(c, { kind: "transform", source: "industry_output", playerId, districtId: job.district_id, itemId: out.itemId, qty, ref: `job:${jobId}` });
      if (lost > 0) {
        await writeLedger(c, { kind: "sink", source: "refine_loss", playerId, districtId: job.district_id, itemId: out.itemId, qty: -lost, ref: `job:${jobId}` });
      }
      outputs.push({ itemId: out.itemId, qty, lost });
    }
    await c.query("UPDATE industry_jobs SET status = 'collected' WHERE id = $1", [jobId]);
    return { jobId, outputs };
  });
}

// ---------------------------------------------------------------- Hauling and travel

export interface HaulResult {
  tripId: string | null;
  from: string;
  to: string;
  arrivesInSeconds: number;
  volume: number;
}

/**
 * Travels to a neighbouring district, carrying cargo from the current district.
 * The player can't act until arrival; cargo lands at the destination on arrival.
 * An empty cargo list is plain travel.
 */
export async function haul(db: Db, playerId: string, to: string, cargo: { itemId: string; qty: number }[]): Promise<HaulResult> {
  if (!DISTRICTS_BY_ID.has(to)) throw new GameError("Unknown destination.");
  for (const x of cargo) {
    getItem(x.itemId);
    if (!Number.isInteger(x.qty) || x.qty <= 0) throw new GameError("Cargo quantities must be whole numbers above 0.");
  }

  return tx(db, async (c) => {
    const p = await lockPlayer(c, playerId);
    const from = p.location;
    if (from === to) throw new GameError("You're already there.");
    const seconds = routeSeconds(from, to);
    if (seconds === undefined) throw new GameError(`No direct route from ${DISTRICTS_BY_ID.get(from)!.name} to ${DISTRICTS_BY_ID.get(to)!.name}.`);

    const volume = cargo.reduce((s, x) => s + getItem(x.itemId).volume * x.qty, 0);
    if (volume > ECONOMY.courierVanCapacity) {
      throw new GameError(`Too much cargo: ${volume} units, your van holds ${ECONOMY.courierVanCapacity}.`);
    }

    let tripId: string | null = null;
    for (const x of cargo) {
      await removeItems(c, playerId, from, x.itemId, x.qty);
      const r: { rows: { trip_id: string }[] } = await c.query<{ trip_id: string }>(
        `INSERT INTO hauls (player_id, from_id, to_id, item_id, qty, arrives_at, trip_id)
         VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6), COALESCE($7::uuid, gen_random_uuid()))
         RETURNING trip_id`,
        [playerId, from, to, x.itemId, x.qty, seconds, tripId],
      );
      tripId = r.rows[0]!.trip_id;
    }

    await c.query(
      "UPDATE players SET location = $2, transit_until = now() + make_interval(secs => $3) WHERE id = $1",
      [playerId, to, seconds],
    );
    return { tripId, from, to, arrivesInSeconds: seconds, volume };
  });
}
