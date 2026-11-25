import { existsSync } from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { DISTRICTS, ITEMS, RECIPES, ROUTES } from "@replicant/shared";
import { GameError, tx, type Db } from "./db/pool";
import { createPlayer } from "./economy/players";
import { collectJob, haul, salvage, startJob, type Rng } from "./economy/actions";
import { getEconomySummary, getPlayerView } from "./economy/queries";
import { cancelOrder, getMarket, placeOrder } from "./market/marketService";

/**
 * Phase 1 REST API. No auth yet: the player id acts as the key (fine for 4 testers, not for launch).
 */
export function buildApp(db: Db, opts: { rng?: Rng; logger?: boolean; clientDir?: string } = {}) {
  const app = Fastify({ logger: opts.logger ?? false });

  // Serve the built client (client/dist) so the whole game runs on one address.
  if (opts.clientDir && existsSync(path.join(opts.clientDir, "index.html"))) {
    app.register(fastifyStatic, { root: opts.clientDir });
  }

  app.addHook("onSend", async (_req, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Headers", "content-type");
    reply.header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  });
  app.options("/*", async (_req, reply) => reply.code(204).send());

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof GameError) return reply.code(err.status).send({ error: err.message });
    const e = err as { validation?: unknown; message?: string };
    if (e.validation) return reply.code(400).send({ error: e.message ?? "Invalid request." });
    app.log.error(err);
    return reply.code(500).send({ error: "Server error." });
  });

  const uuid = { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } as const;
  const idParams = { type: "object", required: ["id"], properties: { id: uuid } } as const;

  app.get("/health", async () => ({ ok: true }));
  app.get("/catalog", async () => ({ items: ITEMS, recipes: RECIPES, districts: DISTRICTS, routes: ROUTES }));

  app.post<{ Body: { handle: string } }>(
    "/players",
    { schema: { body: { type: "object", required: ["handle"], properties: { handle: { type: "string" } } } } },
    async (req, reply) => reply.code(201).send(await tx(db, (c) => createPlayer(c, req.body.handle))),
  );

  app.get<{ Params: { id: string } }>("/players/:id", { schema: { params: idParams } }, async (req) =>
    getPlayerView(db, req.params.id),
  );

  app.post<{ Params: { id: string } }>("/players/:id/salvage", { schema: { params: idParams } }, async (req) =>
    salvage(db, req.params.id, opts.rng),
  );

  app.post<{ Params: { id: string }; Body: { itemId: string; side: "buy" | "sell"; price: number; qty: number; days?: number } }>(
    "/players/:id/orders",
    {
      schema: {
        params: idParams,
        body: {
          type: "object",
          required: ["itemId", "side", "price", "qty"],
          properties: {
            itemId: { type: "string" },
            side: { type: "string", enum: ["buy", "sell"] },
            price: { type: "integer", minimum: 1 },
            qty: { type: "integer", minimum: 1 },
            days: { type: "integer" },
          },
        },
      },
    },
    async (req, reply) => reply.code(201).send(await placeOrder(db, { playerId: req.params.id, ...req.body })),
  );

  app.delete<{ Params: { id: string; orderId: number } }>(
    "/players/:id/orders/:orderId",
    { schema: { params: { type: "object", required: ["id", "orderId"], properties: { id: uuid, orderId: { type: "integer" } } } } },
    async (req) => cancelOrder(db, req.params.id, req.params.orderId),
  );

  app.post<{ Params: { id: string }; Body: { recipeId: string; runs: number } }>(
    "/players/:id/jobs",
    {
      schema: {
        params: idParams,
        body: { type: "object", required: ["recipeId", "runs"], properties: { recipeId: { type: "string" }, runs: { type: "integer" } } },
      },
    },
    async (req, reply) => reply.code(201).send(await startJob(db, req.params.id, req.body.recipeId, req.body.runs)),
  );

  app.post<{ Params: { id: string; jobId: number } }>(
    "/players/:id/jobs/:jobId/collect",
    { schema: { params: { type: "object", required: ["id", "jobId"], properties: { id: uuid, jobId: { type: "integer" } } } } },
    async (req) => collectJob(db, req.params.id, req.params.jobId),
  );

  app.post<{ Params: { id: string }; Body: { to: string; cargo?: { itemId: string; qty: number }[] } }>(
    "/players/:id/haul",
    {
      schema: {
        params: idParams,
        body: {
          type: "object",
          required: ["to"],
          properties: {
            to: { type: "string" },
            cargo: {
              type: "array",
              maxItems: 30,
              items: { type: "object", required: ["itemId", "qty"], properties: { itemId: { type: "string" }, qty: { type: "integer" } } },
            },
          },
        },
      },
    },
    async (req) => haul(db, req.params.id, req.body.to, req.body.cargo ?? []),
  );

  app.get<{ Params: { district: string; item: string } }>("/markets/:district/:item", async (req) =>
    getMarket(db, req.params.district, req.params.item),
  );

  app.get<{ Querystring: { hours?: number } }>(
    "/economy/summary",
    { schema: { querystring: { type: "object", properties: { hours: { type: "integer", minimum: 1, maximum: 720 } } } } },
    async (req) => getEconomySummary(db, req.query.hours ?? 24),
  );

  return app;
}
