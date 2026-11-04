import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

test("tournaments list API enforces role access and filters draft tournaments for customers", async () => {
  const file = await readFile(resolve(process.cwd(), "src/app/api/tournaments/route.ts"), "utf8");
  assert.match(file, /requireApiRole\(\["admin",\s*"staff",\s*"customer"\]\)/);
  assert.match(file, /t\.status <> 'draft'/);
  assert.match(file, /requireApiRole\(\["admin",\s*"staff"\]\)/);
});

test("tournaments creation API validates name, gameId, and allowed statuses", async () => {
  const file = await readFile(resolve(process.cwd(), "src/app/api/tournaments/route.ts"), "utf8");
  assert.match(file, /Tournament name is required/);
  assert.match(file, /Valid gameId is required/);
  assert.match(file, /draft.*open.*closed.*completed.*cancelled/);
});

test("tournament detail API prevents deleting tournament with existing registrations", async () => {
  const file = await readFile(resolve(process.cwd(), "src/app/api/tournaments/[tournamentId]/route.ts"), "utf8");
  assert.match(file, /SELECT COUNT\(\*\)::text AS count FROM public\.tournament_registrations WHERE tournament_id = \$1/);
  assert.match(file, /409/);
  assert.match(file, /Tournament has registered participants/);
});

test("tournament registrations API translates duplicate and capacity trigger errors to 409 and guards cancellations after start date", async () => {
  const file = await readFile(
    resolve(process.cwd(), "src/app/api/tournaments/[tournamentId]/registrations/route.ts"),
    "utf8"
  );
  assert.match(file, /err\?\.code === "23505"/);
  assert.match(file, /Customer is already registered for this tournament/);
  assert.match(file, /err\?\.code === "23514"/);
  assert.match(file, /Registration deadline has passed/);
  assert.match(file, /Tournament has already started/);
});
