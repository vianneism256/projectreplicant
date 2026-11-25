import { buildApp } from "./app";
import { createPool } from "./db/pool";
import { migrate } from "./db/migrate";
import { expireOrders } from "./market/marketService";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (copy .env.example to .env)");
  process.exit(1);
}
const port = Number(process.env.PORT ?? 2567);

const db = createPool(url);
const applied = await migrate(db);
if (applied.length) console.log(`[replicant] applied migrations: ${applied.join(", ")}`);

const app = buildApp(db, { logger: true });
await app.listen({ port, host: "0.0.0.0" });

// Release escrow of expired orders every minute.
setInterval(() => {
  expireOrders(db)
    .then((n) => n && app.log.info(`expired ${n} orders`))
    .catch((err) => app.log.error(err));
}, 60_000);
