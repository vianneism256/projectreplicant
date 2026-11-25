# Project Replicant (working title: Sprawlborn)

A 2D isometric cyberpunk sandbox MMO with a fully player-driven economy, player corporations and alliances, territory wars, and living NPC replicant factions. Inspired by EVE Online.

**Current phase: 1 — economy prototype.** No map or graphics yet; the goal is to prove that trading and crafting are fun.

Design document: see the Project Replicant Game & Economy Design Document (export it into `docs/`).

## Layout

```
shared/   Item, recipe, district and economy definitions used by server and client
server/   Game server (Node + TypeScript). Order-matching engine lives in src/market/
client/   React + Vite. Trading UI now, Phaser/PixiJS city later
db/       Postgres schema (migrations run automatically by Docker on first start)
```

## Host a playtest from your computer

```bash
npm run playtest              # testers on your Wi-Fi
npm run playtest -- --tunnel  # testers anywhere (needs cloudflared)
```

Full guide for you and your testers: [docs/PLAYTEST.md](docs/PLAYTEST.md).

## Getting started (development)

Requirements: Node 20+, Docker.

```bash
npm install
cp .env.example .env
npm run db:up          # starts Postgres (creates `replicant` and `replicant_test`)
npm run db:migrate     # applies db/migrations (the server also does this on start)
npm test               # unit tests; add TEST_DATABASE_URL from .env to run the Postgres tests too
npm run dev:server     # http://localhost:2567
npm run dev:client     # http://localhost:5173 (set VITE_API_URL if the server isn't on localhost:2567)
```

## Phase 1 checklist

- [x] Monorepo, TypeScript, Docker Postgres
- [x] Schema: players, inventories, orders, trades, ledger, industry jobs, hauls
- [x] 30 starter items, 21 recipes, 3 districts (one per zone)
- [x] Order-matching engine (price-time priority, broker fee, sales tax, self-trade prevention) with tests
- [x] Postgres layer: escrow on order placement, settlement of fills, cancel, expiry, ledger writes
- [x] Salvage, refine, craft and haul actions
- [x] REST API (see below) and integration tests on real Postgres
- [x] Trading screen: wallet, storage, order book, my orders, industry, travel/hauling, economy dashboard
- [ ] Playtest with 4 testers

## API (Phase 1, no auth yet — the player id is the key)

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/catalog` | Items, recipes, districts, routes |
| POST | `/players` `{handle}` | Create a character (5,000 cr starter grant) |
| GET | `/players/:id` | Wallet, location, inventory, open orders, jobs, hauls |
| POST | `/players/:id/salvage` | Salvage raw resources in the current district (10 s cooldown) |
| POST | `/players/:id/orders` `{itemId, side, price, qty, days?}` | Place a buy/sell order in the current district |
| DELETE | `/players/:id/orders/:orderId` | Cancel an order (broker fee not refunded) |
| POST | `/players/:id/jobs` `{recipeId, runs}` | Start an industry job (Arcology NPC facilities only) |
| POST | `/players/:id/jobs/:jobId/collect` | Collect a finished job |
| POST | `/players/:id/haul` `{to, cargo?: [{itemId, qty}]}` | Travel to a neighbouring district with cargo |
| GET | `/markets/:district/:item` | Order book depth and recent trades |
| GET | `/economy/summary?hours=24` | Faucets and sinks by source; `balanced` must be true |

## Economy rules enforced in code

- Every credit created or destroyed is written to `ledger`. Total player credits always equal the ledger total (`/economy/summary` checks this).
- Buy orders lock credits; sell orders lock items. Trades happen at the resting order's price; buyers get the difference back.
- Fees: 1% broker fee on placement, 2% sales tax on sales. Contraband trades only on black markets, untaxed.
- Refining loses 20–25% of output (logged as `refine_loss`). NPC facilities charge 2% of input value.
- Items live in a district. Moving them means hauling (van holds 1,000 volume units); you can't act while in transit.
