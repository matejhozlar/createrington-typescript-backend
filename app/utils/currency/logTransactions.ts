import { Pool } from "pg"; // PostgreSQL connection pool

// Define the expected structure of the transaction data
interface TransactionData {
  uuid: string;
  action: string;
  amount: number;
  from_uuid?: string | null;
  to_uuid?: string | null;
  denomination?: string | null;
  count?: number | null;
  balance_after?: number | null;
}

/**
 * Logs a currency transaction into the database.
 *
 * @param db - The PostgreSQL database connection pool.
 * @param data - The transaction data.
 */
export async function logTransactions(
  db: Pool,
  data: TransactionData
): Promise<void> {
  const {
    uuid,
    action,
    amount,
    from_uuid = null,
    to_uuid = null,
    denomination = null,
    count = null,
    balance_after = null,
  } = data;

  await db.query(
    `INSERT INTO currency_transactions
      (uuid, action, amount, from_uuid, to_uuid, denomination, count, balance_after)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      uuid,
      action,
      amount,
      from_uuid,
      to_uuid,
      denomination,
      count,
      balance_after,
    ]
  );
}
