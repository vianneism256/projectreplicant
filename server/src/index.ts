import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app";
import { createPool, type Db } from "./db/pool";
import { migrate } from "./db/migrate";
import { expireOrders } from "./market/marketService";
import { WorldServer } from "./world/worldServer";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (copy .env.example to .env)");
  process.exit(1);
}
const port = Number(process.env.PORT ?? 2567);
const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client/dist");

const db = createPool(url);
await waitForDb(db);
const applied = await migrate(db);
if (applied.length) console.log(`[replicant] applied migrations: ${applied.join(", ")}`);

const worldServer = new WorldServer(db);
const app = buildApp(db, { logger: true, clientDir, onTravel: (id) => worldServer.kick(id, "travel") });
await app.listen({ port, host: "0.0.0.0" });
worldServer.attach(app.server);

// Release escrow of expired orders every minute.
setInterval(() => {
  expireOrders(db)
    .then((n) => n && app.log.info(`expired ${n} orders`))
    .catch((err) => app.log.error(err));
}, 60_000);

/** Postgres in Docker can take a few seconds to accept connections after `docker compose up`. */
async function waitForDb(pool: Db, seconds = 30): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (err) {
      if (i >= seconds) throw err;
      if (i === 0) console.log("[replicant] waiting for Postgres…");
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
