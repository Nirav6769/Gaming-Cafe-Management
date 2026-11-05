import assert from "node:assert/strict";
import { test } from "node:test";
import { databaseTestSkip, withRollback } from "./db";

test(
  "database connection works and test transaction rolls back",
  { skip: databaseTestSkip },
  async () => {
    await withRollback(async (client) => {
      const result = await client.query("SELECT 1 AS value");

      assert.equal(Number(result.rows[0].value), 1);
    });
  }
);
