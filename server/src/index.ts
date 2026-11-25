import http from "node:http";
import { DISTRICTS, ITEMS, RECIPES } from "@replicant/shared";

/**
 * Phase 1 placeholder server: exposes the static catalog so the client can render it.
 * Next steps: Postgres repository, order placement endpoints, then Colyseus rooms per district.
 */
const port = Number(process.env.PORT ?? 2567);

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/health") return res.end(JSON.stringify({ ok: true }));
  if (req.url === "/catalog") return res.end(JSON.stringify({ items: ITEMS, recipes: RECIPES, districts: DISTRICTS }));
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(port, () => {
  console.log(`[replicant] server listening on :${port}`);
});
