import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Db } from "./pool";

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../db/migrations");

/** Applies db/migrations/*.sql in name order, once each. Returns the files applied this run. */
export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<string[]> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const done = new Set((await db.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      await c.query(sql);
      await c.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await c.query("COMMIT");
      applied.push(file);
    } catch (err) {
      await c.query("ROLLBACK").catch(() => {});
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    } finally {
      c.release();
    }
  }
  return applied;
}
