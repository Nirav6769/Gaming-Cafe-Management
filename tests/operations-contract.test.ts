import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {test} from "node:test";

test("operations migration enforces reservation exclusion and session conflict checks",async()=>{
 const sql=await readFile(resolve(process.cwd(),"database/migrations/003_operations.sql"),"utf8");
 assert.match(sql,/EXCLUDE USING gist/);
 assert.match(sql,/operations_guard_reservation/);
 assert.match(sql,/operations_guard_session_reservation/);
 assert.match(sql,/tsrange\(start_time,end_time,'\[\)'\)/);
});
test("operations migration calculates billing from a stored hourly-rate snapshot",async()=>{
 const sql=await readFile(resolve(process.cwd(),"database/migrations/003_operations.sql"),"utf8");
 assert.match(sql,/hourly_rate_snapshot/);
 assert.match(sql,/operations_set_session_billing/);
 assert.match(sql,/ROUND\(/);
});
test("operations migration synchronizes PC state and timestamps resolved maintenance",async()=>{
 const sql=await readFile(resolve(process.cwd(),"database/migrations/003_operations.sql"),"utf8");
 assert.match(sql,/operations_sync_pc_status/);
 assert.match(sql,/operations_stamp_maintenance/);
 assert.match(sql,/maintenance_id BIGSERIAL/);
 assert.doesNotMatch(sql,/LANGUAGE plpgsql AS \$(?!\$)/);
});
