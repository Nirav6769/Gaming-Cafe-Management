import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {Pool} from "pg";
import {test} from "node:test";

const databaseUrl = process.env.TEST_DATABASE_URL;

test("operations migration applies and enforces database invariants", {skip: !databaseUrl}, async () => {
  const pool = new Pool({connectionString: databaseUrl, max: 1});
  try {
    // CI uses a disposable PostgreSQL database. Recreate only the Supabase
    // objects needed by migration 001; no real Supabase project is touched.
    await pool.query(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users (id UUID PRIMARY KEY, email TEXT);
    `);

    const readSql = async (path: string) =>
      readFile(resolve(process.cwd(), path), "utf8");

    await pool.query(await readSql("database/schema.sql"));
    await pool.query(await readSql("database/mvp_migration.sql"));
    await pool.query(await readSql("database/seed.sql"));
    await pool.query(await readSql("database/migrations/001_auth_foundation.sql"));
    await pool.query(await readSql("database/migrations/003_operations.sql"));

    const customer = await pool.query(
      "INSERT INTO customers(name,email) VALUES ('CI Customer','ci-operations@example.test') RETURNING customer_id"
    );
    const customerId = customer.rows[0].customer_id as number;
    const pcs = await pool.query(
      "SELECT pc_id,pc_name,hourly_rate FROM gaming_pcs WHERE pc_name IN ('Alienware-01','ROG-01','Predator-01') ORDER BY pc_name"
    );
    const pc = Object.fromEntries(pcs.rows.map((row) => [row.pc_name, row]));

    // Confirmed reservations on one PC cannot overlap; adjacent intervals can.
    const reservation = await pool.query(
      `INSERT INTO reservations(customer_id,pc_id,start_time,end_time)
       VALUES ($1,$2,'2030-01-01 10:00','2030-01-01 11:00') RETURNING reservation_id`,
      [customerId, pc["Alienware-01"].pc_id]
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO reservations(customer_id,pc_id,start_time,end_time)
         VALUES ($1,$2,'2030-01-01 10:30','2030-01-01 11:30')`,
        [customerId, pc["Alienware-01"].pc_id]
      )
    );
    await pool.query(
      `INSERT INTO reservations(customer_id,pc_id,start_time,end_time)
       VALUES ($1,$2,'2030-01-01 11:00','2030-01-01 12:00')`,
      [customerId, pc["Alienware-01"].pc_id]
    );

    // A session can use its own reservation, snapshots the rate, bills on end,
    // and updates the PC state.
    const linkedReservation = await pool.query(
      `INSERT INTO reservations(customer_id,pc_id,start_time,end_time)
       VALUES ($1,$2,'2030-01-02 10:00','2030-01-02 11:00') RETURNING reservation_id`,
      [customerId, pc["ROG-01"].pc_id]
    );
    const session = await pool.query(
      `INSERT INTO gaming_sessions(customer_id,pc_id,start_time,expected_end_time,reservation_id)
       VALUES ($1,$2,'2030-01-02 10:00','2030-01-02 11:00',$3)
       RETURNING session_id,hourly_rate_snapshot`,
      [customerId, pc["ROG-01"].pc_id, linkedReservation.rows[0].reservation_id]
    );
    assert.equal(Number(session.rows[0].hourly_rate_snapshot), Number(pc["ROG-01"].hourly_rate));
    const occupied = await pool.query("SELECT status FROM gaming_pcs WHERE pc_id=$1", [pc["ROG-01"].pc_id]);
    assert.equal(occupied.rows[0].status, "occupied");

    await pool.query("UPDATE gaming_pcs SET hourly_rate=999 WHERE pc_id=$1", [pc["ROG-01"].pc_id]);
    await pool.query(
      "UPDATE gaming_sessions SET end_time='2030-01-02 10:30' WHERE session_id=$1",
      [session.rows[0].session_id]
    );
    const billed = await pool.query(
      "SELECT total_cost,hourly_rate_snapshot FROM gaming_sessions WHERE session_id=$1",
      [session.rows[0].session_id]
    );
    assert.equal(Number(billed.rows[0].total_cost), Number(pc["ROG-01"].hourly_rate) / 2);
    assert.equal(Number(billed.rows[0].hourly_rate_snapshot), Number(pc["ROG-01"].hourly_rate));
    const available = await pool.query("SELECT status FROM gaming_pcs WHERE pc_id=$1", [pc["ROG-01"].pc_id]);
    assert.equal(available.rows[0].status, "available");

    // Maintenance takes precedence and resolving it restores availability.
    const maintenance = await pool.query(
      `INSERT INTO maintenance_records(pc_id,maintenance_date,issue_description,resolved)
       VALUES ($1,'2030-01-03','CI maintenance check',FALSE)
       RETURNING maintenance_id`,
      [pc["Predator-01"].pc_id]
    );
    const inMaintenance = await pool.query("SELECT status FROM gaming_pcs WHERE pc_id=$1", [pc["Predator-01"].pc_id]);
    assert.equal(inMaintenance.rows[0].status, "maintenance");
    await pool.query("UPDATE maintenance_records SET resolved=TRUE WHERE maintenance_id=$1", [maintenance.rows[0].maintenance_id]);
    const resolved = await pool.query(
      "SELECT resolved_at FROM maintenance_records WHERE maintenance_id=$1",
      [maintenance.rows[0].maintenance_id]
    );
    assert.ok(resolved.rows[0].resolved_at);
    const restored = await pool.query("SELECT status FROM gaming_pcs WHERE pc_id=$1", [pc["Predator-01"].pc_id]);
    assert.equal(restored.rows[0].status, "available");

    // Preserve the baseline schema's identifying uniqueness after adding an ID.
    await assert.rejects(
      pool.query(
        `INSERT INTO maintenance_records(pc_id,maintenance_date,issue_description)
         VALUES ($1,'2030-01-03','duplicate maintenance date')`,
        [pc["Predator-01"].pc_id]
      )
    );
    assert.ok(reservation.rows[0].reservation_id);
  } finally {
    await pool.end();
  }
});
