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

## Getting started

Requirements: Node 20+, Docker.

```bash
npm install
cp .env.example .env
npm run db:up          # starts Postgres and applies db/migrations on first run
npm test               # order-book tests
npm run dev:server     # http://localhost:2567/catalog
npm run dev:client     # http://localhost:5173
```

## Phase 1 checklist

- [x] Monorepo, TypeScript, Docker Postgres
- [x] Schema: players, inventories, orders, trades, ledger, industry jobs, hauls
- [x] 30 starter items, 21 recipes, 3 districts (one per zone)
- [x] Order-matching engine (price-time priority, broker fee, sales tax, self-trade prevention) with tests
- [ ] Postgres repository layer: escrow on order placement, settlement of fills, ledger writes
- [ ] Salvage, refine, craft and haul actions
- [ ] Trading screen: wallet, inventory, order book, crafting, faucet/sink dashboard
- [ ] Playtest with 4 testers
