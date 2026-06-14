import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Database connection pool.
 * Uses DATABASE_URL from environment variables.
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * Drizzle ORM instance with schema for type-safe queries.
 */
export const db = drizzle(pool, { schema });

export { schema };
