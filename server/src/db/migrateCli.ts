import { createPool } from "./pool";
import { migrate } from "./migrate";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (copy .env.example to .env)");
  process.exit(1);
}
const db = createPool(url);
try {
  const applied = await migrate(db);
  console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
} finally {
  await db.end();
}
