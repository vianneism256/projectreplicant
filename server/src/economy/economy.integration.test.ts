/**
 * Integration tests against a real Postgres. Set TEST_DATABASE_URL to run them
 * (docker compose creates `replicant_test`). The test schema is wiped on every run.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPool, tx, type Db } from "../db/pool";
import { migrate } from "../db/migrate";
import { createPlayer } from "./players";
import { addItems } from "./inventory";
import { collectJob, haul, salvage, startJob } from "./actions";
import { getEconomySummary, getPlayerView } from "./queries";
import { cancelOrder, expireOrders, getMarket, placeOrder } from "../market/marketService";
import { buildApp } from "../app";

const url = process.env.TEST_DATABASE_URL;
let db: Db;

async function reset() {
  await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(db);
}

async function newPlayer(handle: string): Promise<string> {
  return (await tx(db, (c) => createPlayer(c, handle))).id;
}

async function give(playerId: string, districtId: string, itemId: string, qty: number) {
  await tx(db, (c) => addItems(c, playerId, districtId, itemId, qty));
}

async function wallet(playerId: string) {
  const r = await db.query<{ credits: number; credits_escrow: number; location: string }>(
    "SELECT credits, credits_escrow, location FROM players WHERE id = $1",
    [playerId],
  );
  return r.rows[0]!;
}

async function stock(playerId: string, districtId: string, itemId: string) {
  const r = await db.query<{ qty: number; qty_escrow: number }>(
    "SELECT qty, qty_escrow FROM inventories WHERE player_id = $1 AND district_id = $2 AND item_id = $3",
    [playerId, districtId, itemId],
  );
  return r.rows[0] ?? { qty: 0, qty_escrow: 0 };
}

async function expectBalanced() {
  const s = await getEconomySummary(db, 24);
  expect(s.moneySupply).toBe(s.ledgerCredits);
}

describe.skipIf(!url)("economy (Postgres)", () => {
  beforeAll(async () => {
    db = createPool(url!);
  });
  afterAll(async () => {
    await db?.end();
  });
  beforeEach(reset);

  it("gives new players the starter grant and logs it as a faucet", async () => {
    const alice = await newPlayer("alice");
    expect(await wallet(alice)).toMatchObject({ credits: 5000, credits_escrow: 0, location: "arc-helix" });
    const s = await getEconomySummary(db);
    expect(s.bySource).toContainEqual(expect.objectContaining({ kind: "faucet", source: "starter_grant", credits: 5000 }));
    await expectBalanced();
    await expect(newPlayer("ALICE")).rejects.toThrow("taken");
    await expect(newPlayer("a")).rejects.toThrow("Handle");
  });

  it("escrows, matches and settles a trade with fees", async () => {
    const alice = await newPlayer("alice");
    const bob = await newPlayer("bob");
    await give(alice, "arc-helix", "scrap_metal", 100);

    const sell = await placeOrder(db, { playerId: alice, itemId: "scrap_metal", side: "sell", price: 10, qty: 50 });
    expect(sell).toMatchObject({ status: "open", filled: 0, remaining: 50, brokerFee: 5 });
    expect(await wallet(alice)).toMatchObject({ credits: 4995 });
    expect(await stock(alice, "arc-helix", "scrap_metal")).toEqual({ qty: 100, qty_escrow: 50 });

    const buy = await placeOrder(db, { playerId: bob, itemId: "scrap_metal", side: "buy", price: 12, qty: 30 });
    expect(buy).toMatchObject({ status: "filled", filled: 30, remaining: 0, brokerFee: 4 });
    expect(buy.fills[0]).toMatchObject({ price: 10, qty: 30, salesTax: 6, sellerProceeds: 294, buyerRefund: 60 });

    // Bob paid 360 + 4 fee, got 60 back for price improvement.
    expect(await wallet(bob)).toMatchObject({ credits: 4696, credits_escrow: 0 });
    expect(await stock(bob, "arc-helix", "scrap_metal")).toEqual({ qty: 30, qty_escrow: 0 });
    // Alice received 300 - 6 tax.
    expect(await wallet(alice)).toMatchObject({ credits: 5289 });
    expect(await stock(alice, "arc-helix", "scrap_metal")).toEqual({ qty: 70, qty_escrow: 20 });

    const m = await getMarket(db, "arc-helix", "scrap_metal");
    expect(m.asks).toEqual([{ price: 10, qty: 20, orders: 1 }]);
    expect(m.recentTrades).toHaveLength(1);

    const s = await getEconomySummary(db);
    expect(s.moneySupply).toBe(10_000 - 5 - 4 - 6);
    await expectBalanced();
  });

  it("refunds escrow on cancel but keeps the broker fee", async () => {
    const alice = await newPlayer("alice");
    await give(alice, "arc-helix", "scrap_metal", 10);
    const sell = await placeOrder(db, { playerId: alice, itemId: "scrap_metal", side: "sell", price: 100, qty: 10 });
    const buy = await placeOrder(db, { playerId: alice, itemId: "copper_wire", side: "buy", price: 50, qty: 20 });
    expect(await wallet(alice)).toMatchObject({ credits: 5000 - 10 - 1000 - 10, credits_escrow: 1000 });

    await cancelOrder(db, alice, sell.orderId);
    await cancelOrder(db, alice, buy.orderId);
    expect(await wallet(alice)).toMatchObject({ credits: 5000 - 20, credits_escrow: 0 });
    expect(await stock(alice, "arc-helix", "scrap_metal")).toEqual({ qty: 10, qty_escrow: 0 });
    await expect(cancelOrder(db, alice, sell.orderId)).rejects.toThrow("no longer open");
    await expectBalanced();
  });

  it("rolls back everything when the player can't afford an order", async () => {
    const bob = await newPlayer("bob");
    await expect(placeOrder(db, { playerId: bob, itemId: "scrap_metal", side: "buy", price: 100, qty: 1000 })).rejects.toThrow(
      "Not enough credits",
    );
    await expect(placeOrder(db, { playerId: bob, itemId: "scrap_metal", side: "sell", price: 5, qty: 1 })).rejects.toThrow(
      "Not enough Scrap metal",
    );
    expect(await wallet(bob)).toMatchObject({ credits: 5000, credits_escrow: 0 });
    expect((await db.query("SELECT count(*)::int AS n FROM orders")).rows[0].n).toBe(0);
    await expectBalanced();
  });

  it("blocks contraband outside black markets and never self-trades", async () => {
    const alice = await newPlayer("alice");
    await expect(placeOrder(db, { playerId: alice, itemId: "reflex_booster", side: "buy", price: 10, qty: 1 })).rejects.toThrow(
      "contraband",
    );
    await give(alice, "arc-helix", "scrap_metal", 5);
    await placeOrder(db, { playerId: alice, itemId: "scrap_metal", side: "sell", price: 10, qty: 5 });
    const own = await placeOrder(db, { playerId: alice, itemId: "scrap_metal", side: "buy", price: 10, qty: 5 });
    expect(own.fills).toHaveLength(0);
    await expectBalanced();
  });

  it("salvages from the district table with a cooldown", async () => {
    const alice = await newPlayer("alice");
    const r = await salvage(db, alice, () => 0);
    expect(r).toEqual({ itemId: "scrap_metal", qty: 2, districtId: "arc-helix" });
    expect(await stock(alice, "arc-helix", "scrap_metal")).toEqual({ qty: 2, qty_escrow: 0 });
    await expect(salvage(db, alice, () => 0)).rejects.toThrow("cooldown");
    await db.query("UPDATE players SET last_salvage_at = now() - interval '1 hour'");
    await expect(salvage(db, alice, () => 0.999)).resolves.toMatchObject({ itemId: "silicon_dust", qty: 3 });
    const s = await getEconomySummary(db);
    expect(s.bySource).toContainEqual(expect.objectContaining({ kind: "faucet", source: "salvage", qty: 5 }));
  });

  it("runs an industry job: consumes inputs, charges a fee, applies refining loss", async () => {
    const alice = await newPlayer("alice");
    await give(alice, "arc-helix", "scrap_metal", 25);
    const job = await startJob(db, alice, "refine_alloy_plate", 2);
    expect(job.facilityFee).toBe(2); // ceil(20 scrap * 4 cr * 2%)
    expect(await stock(alice, "arc-helix", "scrap_metal")).toEqual({ qty: 5, qty_escrow: 0 });
    expect(await wallet(alice)).toMatchObject({ credits: 4998 });

    await expect(collectJob(db, alice, job.id)).rejects.toThrow("finishes in");
    await db.query("UPDATE industry_jobs SET finishes_at = now() - interval '1 second'");
    const out = await collectJob(db, alice, job.id);
    expect(out.outputs).toEqual([{ itemId: "alloy_plate", qty: 6, lost: 2 }]); // floor(8 * 0.8)
    expect(await stock(alice, "arc-helix", "alloy_plate")).toEqual({ qty: 6, qty_escrow: 0 });
    await expect(collectJob(db, alice, job.id)).rejects.toThrow("already collected");
    await expect(startJob(db, alice, "refine_alloy_plate", 1)).rejects.toThrow("Not enough Scrap metal");

    const s = await getEconomySummary(db);
    expect(s.bySource).toContainEqual(expect.objectContaining({ kind: "sink", source: "refine_loss", qty: -2 }));
    await expectBalanced();
  });

  it("hauls cargo between districts and blocks actions while in transit", async () => {
    const alice = await newPlayer("alice");
    await give(alice, "arc-helix", "scrap_metal", 2000);

    await expect(haul(db, alice, "wld-ashfields", [])).rejects.toThrow("No direct route");
    await expect(haul(db, alice, "spr-rustline", [{ itemId: "scrap_metal", qty: 1500 }])).rejects.toThrow("Too much cargo");

    const trip = await haul(db, alice, "spr-rustline", [{ itemId: "scrap_metal", qty: 400 }]);
    expect(trip).toMatchObject({ from: "arc-helix", to: "spr-rustline", arrivesInSeconds: 120, volume: 400 });
    expect(await stock(alice, "arc-helix", "scrap_metal")).toEqual({ qty: 1600, qty_escrow: 0 });
    await expect(salvage(db, alice)).rejects.toThrow("in transit");

    await db.query("UPDATE players SET transit_until = now() - interval '1 second'");
    await db.query("UPDATE hauls SET arrives_at = now() - interval '1 second'");
    const view = await getPlayerView(db, alice);
    expect(view.player.location).toBe("spr-rustline");
    expect(view.inventory).toContainEqual(expect.objectContaining({ district_id: "spr-rustline", item_id: "scrap_metal", qty: 400 }));
    await expect(startJob(db, alice, "refine_alloy_plate", 1)).rejects.toThrow("No refinery");
  });

  it("expires old orders and releases their escrow", async () => {
    const bob = await newPlayer("bob");
    await placeOrder(db, { playerId: bob, itemId: "scrap_metal", side: "buy", price: 10, qty: 10 });
    await db.query("UPDATE orders SET expires_at = now() - interval '1 second'");
    expect(await expireOrders(db)).toBe(1);
    expect(await wallet(bob)).toMatchObject({ credits: 4999, credits_escrow: 0 });
    await expectBalanced();
  });

  it("stays consistent under concurrent buyers", async () => {
    const seller = await newPlayer("seller");
    await give(seller, "arc-helix", "scrap_metal", 50);
    await placeOrder(db, { playerId: seller, itemId: "scrap_metal", side: "sell", price: 10, qty: 50 });
    const buyers = await Promise.all(Array.from({ length: 10 }, (_, i) => newPlayer(`buyer${i}`)));
    const results = await Promise.all(
      buyers.map((b) => placeOrder(db, { playerId: b, itemId: "scrap_metal", side: "buy", price: 10, qty: 8 })),
    );
    const filled = results.reduce((s, r) => s + r.filled, 0);
    expect(filled).toBe(50);
    expect(await stock(seller, "arc-helix", "scrap_metal")).toEqual({ qty: 0, qty_escrow: 0 });
    await expectBalanced();
  });

  it("serves the API", async () => {
    const app = buildApp(db);
    const created = await app.inject({ method: "POST", url: "/players", payload: { handle: "carol" } });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;

    const view = await app.inject({ method: "GET", url: `/players/${id}` });
    expect(view.json().player).toMatchObject({ handle: "carol", credits: 5000 });

    const bad = await app.inject({ method: "POST", url: `/players/${id}/orders`, payload: { itemId: "scrap_metal", side: "hold", price: 1, qty: 1 } });
    expect(bad.statusCode).toBe(400);

    const broke = await app.inject({ method: "POST", url: `/players/${id}/orders`, payload: { itemId: "scrap_metal", side: "sell", price: 1, qty: 1 } });
    expect(broke.statusCode).toBe(400);
    expect(broke.json().error).toMatch("Not enough");

    const sal = await app.inject({ method: "POST", url: `/players/${id}/salvage` });
    expect(sal.statusCode).toBe(200);

    const summary = await app.inject({ method: "GET", url: "/economy/summary" });
    expect(summary.json().balanced).toBe(true);
    await app.close();
  });
});
