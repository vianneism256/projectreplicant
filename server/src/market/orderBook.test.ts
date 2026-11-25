import { describe, expect, it } from "vitest";
import { OrderBook } from "./orderBook";

const book = () => new OrderBook("arc-helix", "scrap_metal", { brokerFeeRate: 0.01, salesTaxRate: 0.02 });

describe("OrderBook", () => {
  it("rests an order that does not cross", () => {
    const b = book();
    const r = b.place({ id: "s1", playerId: "alice", side: "sell", price: 10, qty: 5 });
    expect(r.fills).toHaveLength(0);
    expect(r.order.remaining).toBe(5);
    expect(b.bestAsk()).toBe(10);
    expect(b.bestBid()).toBeUndefined();
  });

  it("matches a crossing buy at the resting sell price and refunds the difference", () => {
    const b = book();
    b.place({ id: "s1", playerId: "alice", side: "sell", price: 10, qty: 5 });
    const r = b.place({ id: "b1", playerId: "bob", side: "buy", price: 12, qty: 5 });
    expect(r.fills).toEqual([
      {
        buyOrderId: "b1",
        sellOrderId: "s1",
        buyerId: "bob",
        sellerId: "alice",
        price: 10,
        qty: 5,
        value: 50,
        salesTax: 1, // ceil(50 * 0.02)
        sellerProceeds: 49,
        buyerRefund: 10, // (12 - 10) * 5
      },
    ]);
    expect(r.order.remaining).toBe(0);
    expect(b.bestAsk()).toBeUndefined();
    expect(b.get("b1")).toBeUndefined();
  });

  it("uses price priority, then time priority", () => {
    const b = book();
    b.place({ id: "s1", playerId: "alice", side: "sell", price: 11, qty: 1 });
    b.place({ id: "s2", playerId: "carol", side: "sell", price: 10, qty: 1 });
    b.place({ id: "s3", playerId: "dave", side: "sell", price: 10, qty: 1 });
    const r = b.place({ id: "b1", playerId: "bob", side: "buy", price: 11, qty: 3 });
    expect(r.fills.map((f) => f.sellOrderId)).toEqual(["s2", "s3", "s1"]);
    expect(r.fills.map((f) => f.price)).toEqual([10, 10, 11]);
  });

  it("partially fills and rests the remainder", () => {
    const b = book();
    b.place({ id: "b1", playerId: "bob", side: "buy", price: 9, qty: 10 });
    const r = b.place({ id: "s1", playerId: "alice", side: "sell", price: 8, qty: 4 });
    expect(r.fills).toHaveLength(1);
    expect(r.fills[0]!.price).toBe(9); // resting buy's price
    expect(r.fills[0]!.buyerRefund).toBe(0);
    expect(b.get("b1")!.remaining).toBe(6);
    expect(b.depth("buy")).toEqual([{ price: 9, qty: 6, orders: 1 }]);
  });

  it("rests the unfilled part of an incoming order", () => {
    const b = book();
    b.place({ id: "s1", playerId: "alice", side: "sell", price: 10, qty: 2 });
    const r = b.place({ id: "b1", playerId: "bob", side: "buy", price: 10, qty: 5 });
    expect(r.order.remaining).toBe(3);
    expect(b.bestBid()).toBe(10);
    expect(b.bestAsk()).toBeUndefined();
  });

  it("never matches a player against their own order", () => {
    const b = book();
    b.place({ id: "s1", playerId: "alice", side: "sell", price: 10, qty: 2 });
    b.place({ id: "s2", playerId: "carol", side: "sell", price: 11, qty: 2 });
    const r = b.place({ id: "b1", playerId: "alice", side: "buy", price: 11, qty: 2 });
    expect(r.fills.map((f) => f.sellOrderId)).toEqual(["s2"]);
    expect(b.get("s1")!.remaining).toBe(2);
  });

  it("charges the broker fee on full order value, rounded up", () => {
    const b = book();
    const r = b.place({ id: "b1", playerId: "bob", side: "buy", price: 7, qty: 3 });
    expect(r.brokerFee).toBe(1); // ceil(21 * 0.01)
    const big = b.place({ id: "b2", playerId: "bob", side: "buy", price: 1000, qty: 10 });
    expect(big.brokerFee).toBe(100);
  });

  it("cancels an open order and returns its remaining quantity", () => {
    const b = book();
    b.place({ id: "b1", playerId: "bob", side: "buy", price: 9, qty: 10 });
    b.place({ id: "s1", playerId: "alice", side: "sell", price: 9, qty: 4 });
    const c = b.cancel("b1");
    expect(c?.remaining).toBe(6);
    expect(b.bestBid()).toBeUndefined();
    expect(b.cancel("b1")).toBeUndefined();
  });

  it("aggregates depth by price level", () => {
    const b = book();
    b.place({ id: "s1", playerId: "a", side: "sell", price: 10, qty: 2 });
    b.place({ id: "s2", playerId: "b", side: "sell", price: 10, qty: 3 });
    b.place({ id: "s3", playerId: "c", side: "sell", price: 12, qty: 1 });
    expect(b.depth("sell")).toEqual([
      { price: 10, qty: 5, orders: 2 },
      { price: 12, qty: 1, orders: 1 },
    ]);
  });

  it("rejects bad input", () => {
    const b = book();
    expect(() => b.place({ id: "x", playerId: "a", side: "buy", price: 0, qty: 1 })).toThrow();
    expect(() => b.place({ id: "x", playerId: "a", side: "buy", price: 1.5, qty: 1 })).toThrow();
    expect(() => b.place({ id: "x", playerId: "a", side: "buy", price: 1, qty: -1 })).toThrow();
    b.place({ id: "x", playerId: "a", side: "buy", price: 1, qty: 1 });
    expect(() => b.place({ id: "x", playerId: "a", side: "buy", price: 1, qty: 1 })).toThrow();
  });
});
