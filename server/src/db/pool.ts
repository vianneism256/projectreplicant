import pg from "pg";

// Return bigint columns (credits, quantities) as JS numbers. Values stay far below 2^53.
pg.types.setTypeParser(20, (v) => Number(v));

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export function createPool(connectionString: string): Db {
  return new pg.Pool({ connectionString, max: 10 });
}

/**
 * Runs fn inside a transaction. Any thrown error rolls everything back.
 * Retries up to 3 times if Postgres aborts it for a deadlock or serialization conflict.
 */
export async function tx<T>(db: Db, fn: (c: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await txOnce(db, fn);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (attempt < 3 && (code === "40P01" || code === "40001")) continue;
      throw err;
    }
  }
}

async function txOnce<T>(db: Db, fn: (c: Tx) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

/** A rule violation the player caused (not enough credits, wrong district...). Mapped to HTTP 400. */
export class GameError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "GameError";
    this.status = status;
  }
}
