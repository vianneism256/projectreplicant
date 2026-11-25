const BASE: string = import.meta.env.VITE_API_URL ?? "http://localhost:2567";

export class ApiError extends Error {}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export interface Player {
  id: string;
  handle: string;
  credits: number;
  credits_escrow: number;
  location: string;
  transit_seconds: number;
  salvage_cooldown: number;
}

export interface InventoryRow {
  district_id: string;
  item_id: string;
  qty: number;
  qty_escrow: number;
}

export interface MyOrder {
  id: number;
  district_id: string;
  item_id: string;
  side: "buy" | "sell";
  price: number;
  qty: number;
  remaining: number;
  expires_at: string;
}

export interface Job {
  id: number;
  district_id: string;
  recipe_id: string;
  runs: number;
  seconds_left: number;
}

export interface Haul {
  trip_id: string;
  from_id: string;
  to_id: string;
  item_id: string;
  qty: number;
  arrives_at: string;
}

export interface PlayerView {
  player: Player;
  inventory: InventoryRow[];
  orders: MyOrder[];
  jobs: Job[];
  hauls: Haul[];
}

export interface Level {
  price: number;
  qty: number;
  orders: number;
}

export interface Market {
  bids: Level[];
  asks: Level[];
  recentTrades: { price: number; qty: number; executed_at: string }[];
}

export interface EconomySummary {
  players: number;
  moneySupply: number;
  ledgerCredits: number;
  balanced: boolean;
  bySource: { kind: string; source: string; credits: number; qty: number; entries: number }[];
}

export const api = {
  createPlayer: (handle: string) => call<Player>("POST", "/players", { handle }),
  player: (id: string) => call<PlayerView>("GET", `/players/${id}`),
  salvage: (id: string) => call<{ itemId: string; qty: number }>("POST", `/players/${id}/salvage`),
  placeOrder: (id: string, o: { itemId: string; side: "buy" | "sell"; price: number; qty: number; days: number }) =>
    call<{ status: string; filled: number; remaining: number; brokerFee: number }>("POST", `/players/${id}/orders`, o),
  cancelOrder: (id: string, orderId: number) => call<{ released: number }>("DELETE", `/players/${id}/orders/${orderId}`),
  startJob: (id: string, recipeId: string, runs: number) => call<{ facilityFee: number }>("POST", `/players/${id}/jobs`, { recipeId, runs }),
  collectJob: (id: string, jobId: number) =>
    call<{ outputs: { itemId: string; qty: number; lost: number }[] }>("POST", `/players/${id}/jobs/${jobId}/collect`),
  haul: (id: string, to: string, cargo: { itemId: string; qty: number }[]) =>
    call<{ arrivesInSeconds: number }>("POST", `/players/${id}/haul`, { to, cargo }),
  market: (district: string, item: string) => call<Market>("GET", `/markets/${district}/${item}`),
  economy: (hours = 24) => call<EconomySummary>("GET", `/economy/summary?hours=${hours}`),
};
