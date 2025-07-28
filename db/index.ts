import { Pool } from "pg";
import dotenv from "dotenv";
import logger from "../logger";

dotenv.config();

/**
 * PostgreSQL database pool instance using environment variables.
 *
 * Environment Variables Used:
 * - DB_USER: PostgreSQL username
 * - DB_HOST: PostgreSQL host (e.g., localhost or remote)
 * - DB_DATABASE: Name of the database
 * - DB_PASSWORD: Password for the database user
 * - DB_PORT: Port PostgreSQL is running on (usually 5432)
 */
const db = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : undefined,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Try to connect immediately and log the result
(async (): Promise<void> => {
  try {
    await db.query("SELECT 1");
    logger.info("Connected to PostgreSQL database");
  } catch (error) {
    logger.error(`Failed to connect to DB: ${error}`);
    process.exit(1);
  }
})();

export { db };
