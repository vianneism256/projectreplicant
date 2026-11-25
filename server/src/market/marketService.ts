import { DISTRICTS_BY_ID, ECONOMY, ITEMS_BY_ID, getItem } from "@replicant/shared";
import { GameError, tx, type Db, type Tx } from "../db/pool";
import { writeLedger } from "../economy/ledger";
import { addItems, deliverEscrowedItems, escrowItems, releaseItems } from "../economy/inventory";
import { lockPlayer, spendCredits } from "../economy/players";
import { KeyedMutex } from "../util/keyedMutex";
import { OrderBook, type Fill, type Side } from "./orderBook";

export interface PlaceOrderInput {
  playerId: string;
  itemId: string;
  side: Side;
  price: number;
  qty: number;
  days?: number;
}

export interface PlaceOrderResult {
  orderId: number;
  status: "open" | "filled";
  filled: number;
  remaining: number;
  brokerFee: number;
  fills: (Fill & { tradeId: number })[];
}

interface OrderRow {
  id: number;
  player_id: string;
  district_id: string;
  item_id: string;
  side: Side;
  price: number;
  qty: number;
  remaining: number;
}

const books = new KeyedMutex();

/** Fees for a book. Contraband trades on black markets are untaxed (design doc section 10). */
function ratesFor(districtId: string, itemId: string): { brokerFeeRate: number; salesTaxRate: number } {
  const district = DISTRICTS_BY_ID.get(districtId);
  if (district?.blackMarket && getItem(itemId).contraband) return { brokerFeeRate: 0, salesTaxRate: 0 };
  return { brokerFeeRate: ECONOMY.brokerFeeRate, salesTaxRate: ECONOMY.salesTaxRate };
}

/**
 * Places an order in the player's current district.
 * One transaction: pay the broker fee, escrow credits or items, match against
 * the locked opposite side of the book, and settle every fill.
 */
export async function placeOrder(db: Db, input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const { playerId, itemId, side } = input;
  if (!ITEMS_BY_ID.has(itemId)) throw new GameError(`Unknown item: ${itemId}`);
  if (side !== "buy" && side !== "sell") throw new GameError("Side must be 'buy' or 'sell'.");
  if (!Number.isInteger(input.price) || input.price <= 0) throw new GameError("Price must be a whole number above 0.");
  if (!Number.isInteger(input.qty) || input.qty <= 0) throw new GameError("Quantity must be a whole number above 0.");
  const days = input.days ?? 30;
  if (!Number.isInteger(days) || days < ECONOMY.minOrderDays || days > ECONOMY.maxOrderDays) {
    throw new GameError(`Order duration must be ${ECONOMY.minOrderDays}–${ECONOMY.maxOrderDays} days.`);
  }

  // Find the district first (outside the book lock) so we know which book to lock.
  const loc = await db.query<{ location: string }>("SELECT location FROM players WHERE id = $1", [playerId]);
  const districtId = loc.rows[0]?.location;
  if (!districtId) throw new GameError("Player not found.", 404);

  return books.run(`${districtId}:${itemId}`, () =>
    tx(db, async (c) => {
      const player = await lockPlayer(c, playerId);
      if (player.location !== districtId) throw new GameError("You moved; try again.");
      const district = DISTRICTS_BY_ID.get(districtId)!;
      const item = getItem(itemId);
      if (item.contraband && !district.blackMarket) {
        throw new GameError(`${item.name} is contraband and can only be traded on a black market.`);
      }

      const rates = ratesFor(districtId, itemId);
      const value = input.price * input.qty;
      const brokerFee = Math.ceil(value * rates.brokerFeeRate);

      // 1. Pay the broker fee and escrow what the order needs.
      if (side === "buy") {
        await spendCredits(c, playerId, value + brokerFee, "this buy order and its broker fee");
        await c.query("UPDATE players SET credits_escrow = credits_escrow + $2 WHERE id = $1", [playerId, value]);
      } else {
        await escrowItems(c, playerId, districtId, itemId, input.qty);
        await spendCredits(c, playerId, brokerFee, "the broker fee");
      }
      if (brokerFee > 0) {
        await writeLedger(c, { kind: "sink", source: "broker_fee", playerId, districtId, credits: -brokerFee, itemId });
      }

      // 2. Insert the order.
      const ins = await c.query<{ id: number }>(
        `INSERT INTO orders (player_id, district_id, item_id, side, price, qty, remaining, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6, now() + make_interval(days => $7)) RETURNING id`,
        [playerId, districtId, itemId, side, input.price, input.qty, days],
      );
      const orderId = ins.rows[0]!.id;

      // 3. Load and lock the crossing opposite orders, best first, and match.
      const opposite = side === "buy" ? "sell" : "buy";
      const crossing = await c.query<OrderRow>(
        `SELECT id, player_id, district_id, item_id, side, price, qty, remaining FROM orders
         WHERE district_id = $1 AND item_id = $2 AND side = $3 AND status = 'open' AND expires_at > now()
           AND ${side === "buy" ? "price <= $4" : "price >= $4"}
         ORDER BY price ${side === "buy" ? "ASC" : "DESC"}, id ASC
         FOR UPDATE`,
        [districtId, itemId, opposite, input.price],
      );
      const book = new OrderBook(districtId, itemId, rates);
      for (const o of crossing.rows) {
        book.load({ id: String(o.id), playerId: o.player_id, side: o.side, price: o.price, qty: o.qty, remaining: o.remaining });
      }
      const result = book.place({ id: String(orderId), playerId, side, price: input.price, qty: input.qty });

      // 4. Settle each fill.
      const fills: PlaceOrderResult["fills"] = [];
      for (const f of result.fills) {
        const tradeId = await settleFill(c, districtId, itemId, side, f);
        fills.push({ ...f, tradeId });
      }

      const filled = input.qty - result.order.remaining;
      const status = result.order.remaining === 0 ? "filled" : "open";
      await c.query("UPDATE orders SET remaining = $2, status = $3 WHERE id = $1", [orderId, result.order.remaining, status]);

      return { orderId, status, filled, remaining: result.order.remaining, brokerFee, fills };
    }),
  );
}

async function settleFill(c: Tx, districtId: string, itemId: string, incomingSide: Side, f: Fill): Promise<number> {
  const t = await c.query<{ id: number }>(
    `INSERT INTO trades (district_id, item_id, buy_order_id, sell_order_id, price, qty, sales_tax)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [districtId, itemId, Number(f.buyOrderId), Number(f.sellOrderId), f.price, f.qty, f.salesTax],
  );
  const tradeId = t.rows[0]!.id;

  // The resting order's remaining is updated here; the incoming order is updated by the caller.
  const restingId = Number(incomingSide === "buy" ? f.sellOrderId : f.buyOrderId);
  const upd = await c.query(
    `UPDATE orders SET remaining = remaining - $2,
       status = CASE WHEN remaining - $2 = 0 THEN 'filled'::order_status ELSE status END
     WHERE id = $1 AND status = 'open' AND remaining >= $2`,
    [restingId, f.qty],
  );
  if (upd.rowCount !== 1) throw new Error(`Resting order ${restingId} could not absorb fill`);

  // Buyer: release the escrow at their limit price, refund any price improvement, receive items.
  await c.query(
    "UPDATE players SET credits_escrow = credits_escrow - $2, credits = credits + $3 WHERE id = $1",
    [f.buyerId, f.value + f.buyerRefund, f.buyerRefund],
  );
  await addItems(c, f.buyerId, districtId, itemId, f.qty);

  // Seller: hand over the escrowed items, receive proceeds after tax.
  await deliverEscrowedItems(c, f.sellerId, districtId, itemId, f.qty);
  await c.query("UPDATE players SET credits = credits + $2 WHERE id = $1", [f.sellerId, f.sellerProceeds]);

  if (f.salesTax > 0) {
    await writeLedger(c, {
      kind: "sink",
      source: "sales_tax",
      playerId: f.sellerId,
      districtId,
      credits: -f.salesTax,
      itemId,
      ref: `trade:${tradeId}`,
    });
  }
  return tradeId;
}

/** Releases the escrow of an open order. Shared by cancel and expiry. */
async function releaseOrder(c: Tx, o: OrderRow): Promise<void> {
  if (o.side === "buy") {
    const amount = o.price * o.remaining;
    await c.query("UPDATE players SET credits_escrow = credits_escrow - $2, credits = credits + $2 WHERE id = $1", [o.player_id, amount]);
  } else {
    await releaseItems(c, o.player_id, o.district_id, o.item_id, o.remaining);
  }
}

/** Cancels a player's open order. The broker fee is not refunded. */
export async function cancelOrder(db: Db, playerId: string, orderId: number): Promise<{ released: number }> {
  const head = await db.query<{ district_id: string; item_id: string }>(
    "SELECT district_id, item_id FROM orders WHERE id = $1 AND player_id = $2",
    [orderId, playerId],
  );
  const o0 = head.rows[0];
  if (!o0) throw new GameError("Order not found.", 404);

  return books.run(`${o0.district_id}:${o0.item_id}`, () =>
    tx(db, async (c) => {
      await lockPlayer(c, playerId, { allowTransit: true });
      const r = await c.query<OrderRow>(
        `SELECT id, player_id, district_id, item_id, side, price, qty, remaining FROM orders
         WHERE id = $1 AND player_id = $2 AND status = 'open' FOR UPDATE`,
        [orderId, playerId],
      );
      const o = r.rows[0];
      if (!o) throw new GameError("That order is no longer open.");
      await releaseOrder(c, o);
      await c.query("UPDATE orders SET status = 'cancelled' WHERE id = $1", [orderId]);
      return { released: o.remaining };
    }),
  );
}

/** Expires orders past their end date and releases their escrow. Run on a timer. */
export async function expireOrders(db: Db): Promise<number> {
  return tx(db, async (c) => {
    const r = await c.query<OrderRow>(
      `SELECT id, player_id, district_id, item_id, side, price, qty, remaining FROM orders
       WHERE status = 'open' AND expires_at <= now()
       ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 500`,
    );
    for (const o of r.rows) {
      await releaseOrder(c, o);
      await c.query("UPDATE orders SET status = 'expired' WHERE id = $1", [o.id]);
    }
    return r.rowCount ?? 0;
  });
}

/** Market view for one item in one district. */
export async function getMarket(db: Db, districtId: string, itemId: string, levels = 10) {
  if (!DISTRICTS_BY_ID.has(districtId)) throw new GameError("Unknown district.", 404);
  if (!ITEMS_BY_ID.has(itemId)) throw new GameError("Unknown item.", 404);
  const depth = async (side: Side) =>
    (
      await db.query<{ price: number; qty: number; orders: number }>(
        `SELECT price, sum(remaining)::bigint AS qty, count(*)::int AS orders FROM orders
         WHERE district_id = $1 AND item_id = $2 AND side = $3 AND status = 'open' AND expires_at > now()
         GROUP BY price ORDER BY price ${side === "buy" ? "DESC" : "ASC"} LIMIT $4`,
        [districtId, itemId, side, levels],
      )
    ).rows;
  const trades = await db.query(
    `SELECT price, qty, executed_at FROM trades WHERE district_id = $1 AND item_id = $2
     ORDER BY executed_at DESC, id DESC LIMIT 20`,
    [districtId, itemId],
  );
  return { districtId, itemId, bids: await depth("buy"), asks: await depth("sell"), recentTrades: trades.rows };
}
