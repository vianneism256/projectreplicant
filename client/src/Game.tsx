import { useCallback, useEffect, useMemo, useState } from "react";
import { DISTRICTS_BY_ID, ECONOMY, ITEMS, RECIPES, ROUTES, getItem, type RecipeDef } from "@replicant/shared";
import { api, type EconomySummary, type Market, type PlayerView } from "./api";
import { cr, districtName, itemName, secs } from "./format";

interface Toast {
  id: number;
  text: string;
  error?: boolean;
}

type Run = (fn: () => Promise<string | void>) => Promise<void>;

export function Game({ view, refresh, onLogout }: { view: PlayerView; refresh: () => Promise<void>; onLogout: () => void }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [selectedItem, setSelectedItem] = useState("scrap_metal");
  const [busy, setBusy] = useState(false);

  const toast = useCallback((text: string, error = false) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, error }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const run: Run = useCallback(
    async (fn) => {
      setBusy(true);
      try {
        const msg = await fn();
        if (msg) toast(msg);
      } catch (err) {
        toast((err as Error).message, true);
      } finally {
        setBusy(false);
        await refresh();
      }
    },
    [refresh, toast],
  );

  const p = view.player;
  const inTransit = p.transit_seconds > 0;

  return (
    <>
      <header className="topbar">
        <span className="brand">SPRAWLBORN</span>
        <div className="stat">
          <span>Runner</span>
          <span>{p.handle}</span>
        </div>
        <div className="stat">
          <span>Credits</span>
          <span>{cr(p.credits)}</span>
        </div>
        <div className="stat">
          <span>In orders</span>
          <span className="muted">{cr(p.credits_escrow)}</span>
        </div>
        <div className="stat">
          <span>Location</span>
          <span className={inTransit ? "warnText" : ""}>
            {inTransit ? `→ ${districtName(p.location)} (${secs(p.transit_seconds)})` : districtName(p.location)}
          </span>
        </div>
        <button
          className="primary"
          disabled={busy || inTransit || p.salvage_cooldown > 0}
          onClick={() =>
            run(async () => {
              const r = await api.salvage(p.id);
              return `Salvaged ${r.qty}× ${itemName(r.itemId)}`;
            })
          }
        >
          {p.salvage_cooldown > 0 ? `Salvage (${p.salvage_cooldown}s)` : "Salvage"}
        </button>
        <span className="spacer" />
        <span className="muted" style={{ fontSize: 11 }} title="Use this to log in from another browser">
          ID: {p.id}
        </span>
        <button onClick={onLogout}>Log out</button>
      </header>

      <main className="grid">
        <MarketPanel className="span8" view={view} itemId={selectedItem} setItemId={setSelectedItem} run={run} busy={busy} />
        <InventoryPanel className="span4" view={view} onPick={setSelectedItem} />
        <OrdersPanel className="span7" view={view} run={run} busy={busy} />
        <IndustryPanel className="span5" view={view} run={run} busy={busy} />
        <TravelPanel className="span7" view={view} run={run} busy={busy} />
        <EconomyPanel className="span5" />
      </main>

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.error ? " error" : ""}`}>
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Market

function MarketPanel({
  className,
  view,
  itemId,
  setItemId,
  run,
  busy,
}: {
  className: string;
  view: PlayerView;
  itemId: string;
  setItemId: (id: string) => void;
  run: Run;
  busy: boolean;
}) {
  const p = view.player;
  const district = DISTRICTS_BY_ID.get(p.location)!;
  const item = getItem(itemId);
  const [market, setMarket] = useState<Market | null>(null);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [price, setPrice] = useState(item.baseValue);
  const [qty, setQty] = useState(10);
  const [days, setDays] = useState(30);

  const loadMarket = useCallback(async () => {
    try {
      setMarket(await api.market(p.location, itemId));
    } catch {
      setMarket(null);
    }
  }, [p.location, itemId]);

  useEffect(() => {
    loadMarket();
    const t = setInterval(loadMarket, 3000);
    return () => clearInterval(t);
  }, [loadMarket]);

  useEffect(() => setPrice(getItem(itemId).baseValue), [itemId]);

  const held = view.inventory.find((r) => r.district_id === p.location && r.item_id === itemId);
  const free = held ? held.qty - held.qty_escrow : 0;
  const value = price * qty;
  const untaxed = item.contraband && district.blackMarket;
  const brokerFee = untaxed ? 0 : Math.ceil(value * ECONOMY.brokerFeeRate);
  const blocked = item.contraband && !district.blackMarket;

  const place = () =>
    run(async () => {
      const r = await api.placeOrder(p.id, { itemId, side, price, qty, days });
      await loadMarket();
      return r.filled > 0
        ? `${side === "buy" ? "Bought" : "Sold"} ${r.filled}× ${item.name}${r.remaining ? `, ${r.remaining} left on the book` : ""}`
        : `Order placed: ${side} ${qty}× ${item.name} @ ${cr(price)}`;
    });

  return (
    <section className={`panel ${className}`}>
      <h2>Market · {district.name}</h2>
      <div className="row" style={{ marginBottom: 12 }}>
        <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
          {ITEMS.map((i) => (
            <option key={i.id} value={i.id}>
              T{i.tier} · {i.name}
              {i.contraband ? " (contraband)" : ""}
            </option>
          ))}
        </select>
        <span className="muted">
          Base value {cr(item.baseValue)} · volume {item.volume} · you have {free} free here
        </span>
      </div>

      <div className="book">
        <div>
          <h3 className="buyText" style={{ fontSize: 13, marginBottom: 4 }}>Buy orders</h3>
          <table>
            <thead>
              <tr>
                <th className="num">Price</th>
                <th className="num">Qty</th>
                <th className="num">Orders</th>
              </tr>
            </thead>
            <tbody>
              {market?.bids.map((l) => (
                <tr key={l.price} className="clickable" onClick={() => { setSide("sell"); setPrice(l.price); }}>
                  <td className="num buyText">{l.price.toLocaleString()}</td>
                  <td className="num">{l.qty.toLocaleString()}</td>
                  <td className="num muted">{l.orders}</td>
                </tr>
              ))}
              {!market?.bids.length && (
                <tr>
                  <td colSpan={3} className="muted">No buyers</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div>
          <h3 className="sellText" style={{ fontSize: 13, marginBottom: 4 }}>Sell orders</h3>
          <table>
            <thead>
              <tr>
                <th className="num">Price</th>
                <th className="num">Qty</th>
                <th className="num">Orders</th>
              </tr>
            </thead>
            <tbody>
              {market?.asks.map((l) => (
                <tr key={l.price} className="clickable" onClick={() => { setSide("buy"); setPrice(l.price); }}>
                  <td className="num sellText">{l.price.toLocaleString()}</td>
                  <td className="num">{l.qty.toLocaleString()}</td>
                  <td className="num muted">{l.orders}</td>
                </tr>
              ))}
              {!market?.asks.length && (
                <tr>
                  <td colSpan={3} className="muted">No sellers</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>Click a price level to fill the order form against it.</p>

      <div className="stack" style={{ marginTop: 8 }}>
        <div className="row">
          <select value={side} onChange={(e) => setSide(e.target.value as "buy" | "sell")}>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
          <label>
            Qty <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Math.floor(+e.target.value)))} />
          </label>
          <label>
            Price <input type="number" min={1} value={price} onChange={(e) => setPrice(Math.max(1, Math.floor(+e.target.value)))} />
          </label>
          <label>
            Days <input type="number" min={1} max={90} value={days} onChange={(e) => setDays(Math.min(90, Math.max(1, Math.floor(+e.target.value))))} style={{ width: 70 }} />
          </label>
          <button className={side} disabled={busy || blocked || p.transit_seconds > 0} onClick={place}>
            {side === "buy" ? "Place buy" : "Place sell"}
          </button>
        </div>
        <span className="muted" style={{ fontSize: 12 }}>
          {blocked
            ? "Contraband: trade it on a black market (Rustline)."
            : `Total ${cr(value)} · broker fee ${cr(brokerFee)}${side === "sell" && !untaxed ? ` · ${ECONOMY.salesTaxRate * 100}% sales tax on each sale` : ""}`}
        </span>
      </div>

      <h2 style={{ marginTop: 14 }}>Recent trades</h2>
      <table>
        <tbody>
          {market?.recentTrades.slice(0, 8).map((t, i) => (
            <tr key={i}>
              <td className="num">{t.price.toLocaleString()} cr</td>
              <td className="num">{t.qty}×</td>
              <td className="muted">{new Date(t.executed_at).toLocaleTimeString()}</td>
            </tr>
          ))}
          {!market?.recentTrades.length && (
            <tr>
              <td className="muted">No trades yet</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

// ---------------------------------------------------------------- Inventory

function InventoryPanel({ className, view, onPick }: { className: string; view: PlayerView; onPick: (id: string) => void }) {
  const byDistrict = useMemo(() => {
    const m = new Map<string, PlayerView["inventory"]>();
    for (const r of view.inventory) m.set(r.district_id, [...(m.get(r.district_id) ?? []), r]);
    return m;
  }, [view.inventory]);

  return (
    <section className={`panel ${className}`}>
      <h2>Storage</h2>
      {byDistrict.size === 0 && <p className="muted">Empty. Hit Salvage to find raw materials.</p>}
      {[...byDistrict.entries()].map(([d, rows]) => (
        <div key={d}>
          <div className={`districtHeader${d === view.player.location ? " here" : ""}`}>
            {districtName(d)}
            {d === view.player.location ? " · here" : ""}
          </div>
          <table>
            <tbody>
              {rows.map((r) => (
                <tr key={r.item_id} className="clickable" onClick={() => onPick(r.item_id)}>
                  <td>{itemName(r.item_id)}</td>
                  <td className="num">{(r.qty - r.qty_escrow).toLocaleString()}</td>
                  <td className="num muted">{r.qty_escrow ? `+${r.qty_escrow} in orders` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------- My orders

function OrdersPanel({ className, view, run, busy }: { className: string; view: PlayerView; run: Run; busy: boolean }) {
  return (
    <section className={`panel ${className}`}>
      <h2>My orders</h2>
      {view.orders.length === 0 ? (
        <p className="muted">No open orders.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Side</th>
              <th>Item</th>
              <th>District</th>
              <th className="num">Price</th>
              <th className="num">Left</th>
              <th>Expires</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {view.orders.map((o) => (
              <tr key={o.id}>
                <td className={o.side === "buy" ? "buyText" : "sellText"}>{o.side}</td>
                <td>{itemName(o.item_id)}</td>
                <td className="muted">{districtName(o.district_id)}</td>
                <td className="num">{o.price.toLocaleString()}</td>
                <td className="num">
                  {o.remaining}/{o.qty}
                </td>
                <td className="muted">{new Date(o.expires_at).toLocaleDateString()}</td>
                <td>
                  <button
                    className="link"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api.cancelOrder(view.player.id, o.id);
                        return `Cancelled order for ${itemName(o.item_id)}`;
                      })
                    }
                  >
                    Cancel
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- Industry

function IndustryPanel({ className, view, run, busy }: { className: string; view: PlayerView; run: Run; busy: boolean }) {
  const p = view.player;
  const district = DISTRICTS_BY_ID.get(p.location)!;
  const [recipeId, setRecipeId] = useState(RECIPES[0]!.id);
  const [runs, setRuns] = useState(1);
  const recipe = RECIPES.find((r) => r.id === recipeId) as RecipeDef;

  const freeHere = (itemId: string) => {
    const r = view.inventory.find((x) => x.district_id === p.location && x.item_id === itemId);
    return r ? r.qty - r.qty_escrow : 0;
  };
  const inputValue = recipe.inputs.reduce((s, x) => s + getItem(x.itemId).baseValue * x.qty * runs, 0);
  const fee = Math.ceil(inputValue * ECONOMY.facilityFeeRate);
  const canRun = recipe.inputs.every((x) => freeHere(x.itemId) >= x.qty * runs);

  return (
    <section className={`panel ${className}`}>
      <h2>Industry</h2>
      {!district.npcFacilities ? (
        <p className="muted">No NPC facilities in {district.name}. Haul your materials to Helix Arcology to refine and build.</p>
      ) : (
        <div className="stack">
          <div className="row">
            <select value={recipeId} onChange={(e) => setRecipeId(e.target.value)} style={{ flex: 1 }}>
              {(["refinery", "fabricator", "assembly"] as const).map((f) => (
                <optgroup key={f} label={f}>
                  {RECIPES.filter((r) => r.facility === f).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.outputs.map((o) => `${o.qty}× ${itemName(o.itemId)}`).join(", ")}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <label>
              Runs <input type="number" min={1} max={ECONOMY.maxRunsPerJob} value={runs} onChange={(e) => setRuns(Math.min(ECONOMY.maxRunsPerJob, Math.max(1, Math.floor(+e.target.value))))} style={{ width: 70 }} />
            </label>
          </div>
          <table>
            <thead>
              <tr>
                <th>Needs</th>
                <th className="num">Need</th>
                <th className="num">Have</th>
              </tr>
            </thead>
            <tbody>
              {recipe.inputs.map((x) => (
                <tr key={x.itemId}>
                  <td>{itemName(x.itemId)}</td>
                  <td className="num">{x.qty * runs}</td>
                  <td className={`num ${freeHere(x.itemId) >= x.qty * runs ? "buyText" : "sellText"}`}>{freeHere(x.itemId)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row">
            <button
              className="primary"
              disabled={busy || !canRun || p.transit_seconds > 0}
              onClick={() =>
                run(async () => {
                  const r = await api.startJob(p.id, recipeId, runs);
                  return `Job started (fee ${cr(r.facilityFee)})`;
                })
              }
            >
              Start job
            </button>
            <span className="muted" style={{ fontSize: 12 }}>
              {secs(recipe.seconds * runs)} · fee {cr(fee)}
              {recipe.baseYield ? ` · ${Math.round(recipe.baseYield * 100)}% yield` : ""}
            </span>
          </div>
        </div>
      )}

      {view.jobs.length > 0 && (
        <>
          <h2 style={{ marginTop: 14 }}>Running jobs</h2>
          <table>
            <tbody>
              {view.jobs.map((j) => {
                const r = RECIPES.find((x) => x.id === j.recipe_id)!;
                return (
                  <tr key={j.id}>
                    <td>
                      {r.outputs.map((o) => itemName(o.itemId)).join(", ")} ×{j.runs}
                    </td>
                    <td className="muted">{districtName(j.district_id)}</td>
                    <td className="num">
                      {j.seconds_left > 0 ? (
                        secs(j.seconds_left)
                      ) : (
                        <button
                          className="link"
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              const out = await api.collectJob(p.id, j.id);
                              return `Collected ${out.outputs.map((o) => `${o.qty}× ${itemName(o.itemId)}${o.lost ? ` (${o.lost} lost)` : ""}`).join(", ")}`;
                            })
                          }
                        >
                          Collect
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- Travel and hauling

function TravelPanel({ className, view, run, busy }: { className: string; view: PlayerView; run: Run; busy: boolean }) {
  const p = view.player;
  const neighbours = ROUTES.filter((r) => r.from === p.location || r.to === p.location).map((r) => ({
    id: r.from === p.location ? r.to : r.from,
    seconds: r.seconds,
  }));
  const here = view.inventory.filter((r) => r.district_id === p.location && r.qty - r.qty_escrow > 0);
  const [cargo, setCargo] = useState<Record<string, number>>({});
  const volume = Object.entries(cargo).reduce((s, [id, q]) => s + getItem(id).volume * q, 0);
  const over = volume > ECONOMY.courierVanCapacity;

  const go = (to: string) =>
    run(async () => {
      const list = Object.entries(cargo)
        .filter(([, q]) => q > 0)
        .map(([itemId, qty]) => ({ itemId, qty }));
      const r = await api.haul(p.id, to, list);
      setCargo({});
      return `Heading to ${districtName(to)}, arriving in ${secs(r.arrivesInSeconds)}`;
    });

  return (
    <section className={`panel ${className}`}>
      <h2>Travel and hauling</h2>
      {p.transit_seconds > 0 ? (
        <p className="warnText">
          In transit to {districtName(p.location)}. Arriving in {secs(p.transit_seconds)}.
        </p>
      ) : (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Load cargo from {districtName(p.location)} (van holds {ECONOMY.courierVanCapacity.toLocaleString()} units), then pick a destination.
          </p>
          {here.length > 0 && (
            <table style={{ marginBottom: 10 }}>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Free</th>
                  <th className="num">Load</th>
                </tr>
              </thead>
              <tbody>
                {here.map((r) => {
                  const free = r.qty - r.qty_escrow;
                  return (
                    <tr key={r.item_id}>
                      <td>{itemName(r.item_id)}</td>
                      <td className="num">{free}</td>
                      <td className="num">
                        <input
                          type="number"
                          min={0}
                          max={free}
                          value={cargo[r.item_id] ?? 0}
                          onChange={(e) =>
                            setCargo((c) => ({ ...c, [r.item_id]: Math.min(free, Math.max(0, Math.floor(+e.target.value))) }))
                          }
                          style={{ width: 80 }}
                        />
                        <button className="link" style={{ marginLeft: 6 }} onClick={() => setCargo((c) => ({ ...c, [r.item_id]: free }))}>
                          all
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="row">
            <span className={over ? "sellText" : "muted"}>
              Cargo {volume.toLocaleString()} / {ECONOMY.courierVanCapacity.toLocaleString()} units
            </span>
            {neighbours.map((n) => (
              <button key={n.id} disabled={busy || over} onClick={() => go(n.id)}>
                Go to {districtName(n.id)} ({secs(n.seconds)})
              </button>
            ))}
          </div>
        </>
      )}
      {view.hauls.length > 0 && (
        <>
          <h2 style={{ marginTop: 14 }}>Cargo on the road</h2>
          <table>
            <tbody>
              {view.hauls.map((h, i) => (
                <tr key={i}>
                  <td>
                    {h.qty}× {itemName(h.item_id)}
                  </td>
                  <td className="muted">
                    {districtName(h.from_id)} → {districtName(h.to_id)}
                  </td>
                  <td className="muted">{new Date(h.arrives_at).toLocaleTimeString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- Economy dashboard

function EconomyPanel({ className }: { className: string }) {
  const [s, setS] = useState<EconomySummary | null>(null);
  useEffect(() => {
    const load = () => api.economy(24).then(setS).catch(() => {});
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  return (
    <section className={`panel ${className}`}>
      <h2>Economy · last 24h</h2>
      {!s ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="row" style={{ marginBottom: 8 }}>
            <span>Money supply {cr(s.moneySupply)}</span>
            <span className="muted">· {s.players} players</span>
            <span className={`pill ${s.balanced ? "ok" : "bad"}`}>{s.balanced ? "ledger balanced" : "LEDGER MISMATCH"}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Kind</th>
                <th>Source</th>
                <th className="num">Credits</th>
                <th className="num">Items</th>
              </tr>
            </thead>
            <tbody>
              {s.bySource.map((r) => (
                <tr key={`${r.kind}:${r.source}`}>
                  <td className={r.kind === "faucet" ? "buyText" : r.kind === "sink" ? "sellText" : "muted"}>{r.kind}</td>
                  <td>{r.source.replace(/_/g, " ")}</td>
                  <td className="num">{r.credits ? r.credits.toLocaleString() : ""}</td>
                  <td className="num">{r.qty ? r.qty.toLocaleString() : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
