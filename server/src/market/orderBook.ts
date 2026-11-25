import { ECONOMY, feeOf } from "@replicant/shared";

export type Side = "buy" | "sell";

export interface NewOrder {
  id: string;
  playerId: string;
  side: Side;
  /** Limit price in credits per unit (positive integer). */
  price: number;
  /** Units (positive integer). */
  qty: number;
}

export interface Order extends NewOrder {
  remaining: number;
  /** Arrival sequence; lower = earlier (time priority). */
  seq: number;
}

export interface Fill {
  buyOrderId: string;
  sellOrderId: string;
  buyerId: string;
  sellerId: string;
  /** Trade price: always the resting order's price. */
  price: number;
  qty: number;
  value: number;
  /** Credit sink, paid by the seller. */
  salesTax: number;
  sellerProceeds: number;
  /** Credits returned to the buyer when a buy limit fills below its limit (released escrow). */
  buyerRefund: number;
}

export interface PlaceResult {
  /** The incoming order after matching. remaining === 0 means fully filled and not resting. */
  order: Order;
  fills: Fill[];
  /** Credit sink charged on placement, on the order's full value. */
  brokerFee: number;
}

export interface OrderBookOptions {
  brokerFeeRate?: number;
  /** NPC districts use the default. Player-owned districts set their own (a transfer, not a sink). */
  salesTaxRate?: number;
}

function assertPositiveInt(n: number, what: string): void {
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${what} must be a positive integer, got ${n}`);
}

/**
 * One order book per (district, item). Price-time priority matching.
 * Pure in-memory engine: escrow, wallets and persistence are handled by the caller.
 */
export class OrderBook {
  readonly districtId: string;
  readonly itemId: string;
  private readonly brokerFeeRate: number;
  private readonly salesTaxRate: number;
  private readonly buys: Order[] = []; // best (highest price, then earliest) first
  private readonly sells: Order[] = []; // best (lowest price, then earliest) first
  private readonly byId = new Map<string, Order>();
  private nextSeq = 1;

  constructor(districtId: string, itemId: string, opts: OrderBookOptions = {}) {
    this.districtId = districtId;
    this.itemId = itemId;
    this.brokerFeeRate = opts.brokerFeeRate ?? ECONOMY.brokerFeeRate;
    this.salesTaxRate = opts.salesTaxRate ?? ECONOMY.salesTaxRate;
  }

  place(input: NewOrder): PlaceResult {
    assertPositiveInt(input.price, "price");
    assertPositiveInt(input.qty, "qty");
    if (this.byId.has(input.id)) throw new Error(`Duplicate order id: ${input.id}`);

    const order: Order = { ...input, remaining: input.qty, seq: this.nextSeq++ };
    const brokerFee = feeOf(order.price * order.qty, this.brokerFeeRate);
    const fills: Fill[] = [];
    const opposite = order.side === "buy" ? this.sells : this.buys;

    let i = 0;
    while (order.remaining > 0 && i < opposite.length) {
      const resting = opposite[i]!;
      const crosses = order.side === "buy" ? resting.price <= order.price : resting.price >= order.price;
      if (!crosses) break;
      if (resting.playerId === order.playerId) {
        // Self-trade prevention: skip own resting orders.
        i++;
        continue;
      }

      const qty = Math.min(order.remaining, resting.remaining);
      const price = resting.price;
      const buy = order.side === "buy" ? order : resting;
      const sell = order.side === "sell" ? order : resting;
      const value = price * qty;
      const salesTax = feeOf(value, this.salesTaxRate);

      fills.push({
        buyOrderId: buy.id,
        sellOrderId: sell.id,
        buyerId: buy.playerId,
        sellerId: sell.playerId,
        price,
        qty,
        value,
        salesTax,
        sellerProceeds: value - salesTax,
        buyerRefund: (buy.price - price) * qty,
      });

      order.remaining -= qty;
      resting.remaining -= qty;
      if (resting.remaining === 0) {
        opposite.splice(i, 1);
        this.byId.delete(resting.id);
      } else {
        i++;
      }
    }

    if (order.remaining > 0) this.rest(order);
    return { order, fills, brokerFee };
  }

  /**
   * Rests an existing order without matching (used to rebuild a book from the database).
   * Call in priority order: arrival order decides time priority between equal prices.
   */
  load(existing: NewOrder & { remaining: number }): void {
    if (this.byId.has(existing.id)) throw new Error(`Duplicate order id: ${existing.id}`);
    assertPositiveInt(existing.remaining, "remaining");
    this.rest({ ...existing, seq: this.nextSeq++ });
  }

  /** Removes an open order. Returns it (with its unfilled remaining) so the caller can release escrow. */
  cancel(orderId: string): Order | undefined {
    const order = this.byId.get(orderId);
    if (!order) return undefined;
    const side = order.side === "buy" ? this.buys : this.sells;
    side.splice(side.indexOf(order), 1);
    this.byId.delete(orderId);
    return order;
  }

  get(orderId: string): Order | undefined {
    return this.byId.get(orderId);
  }

  bestBid(): number | undefined {
    return this.buys[0]?.price;
  }

  bestAsk(): number | undefined {
    return this.sells[0]?.price;
  }

  /** Aggregated depth per price level, best first. */
  depth(side: Side, levels = 10): { price: number; qty: number; orders: number }[] {
    const book = side === "buy" ? this.buys : this.sells;
    const out: { price: number; qty: number; orders: number }[] = [];
    for (const o of book) {
      const last = out[out.length - 1];
      if (last && last.price === o.price) {
        last.qty += o.remaining;
        last.orders++;
      } else {
        if (out.length === levels) break;
        out.push({ price: o.price, qty: o.remaining, orders: 1 });
      }
    }
    return out;
  }

  private rest(order: Order): void {
    const book = order.side === "buy" ? this.buys : this.sells;
    const better = order.side === "buy" ? (a: Order) => a.price < order.price : (a: Order) => a.price > order.price;
    // Insert after all orders at the same or better price (time priority).
    let idx = book.findIndex(better);
    if (idx === -1) idx = book.length;
    book.splice(idx, 0, order);
    this.byId.set(order.id, order);
  }
}
