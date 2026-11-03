import { Pool, type PoolClient } from "pg";

export const databaseTestSkip = process.env.TEST_DATABASE_URL
  ? false
  : "TEST_DATABASE_URL is not set";

export async function withRollback<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const connectionString = process.env.TEST_DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "TEST_DATABASE_URL is required to run database tests."
    );
  }

  const pool = new Pool({
    connectionString,
    max: 1,
    ssl: connectionString.includes("localhost")
      ? undefined
      : { rejectUnauthorized: false },
  });

  let client: PoolClient | undefined;

  try {
    client = await pool.connect();
    await client.query("BEGIN");

    try {
      return await callback(client);
    } finally {
      await client.query("ROLLBACK");
    }
  } finally {
    client?.release();
    await pool.end();
  }
}
