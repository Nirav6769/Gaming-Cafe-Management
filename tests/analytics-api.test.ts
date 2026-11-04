import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

test("analytics revenue endpoint is strictly admin-only and enforces date bounds", async () => {
  const file = await readFile(resolve(process.cwd(), "src/app/api/analytics/revenue/route.ts"), "utf8");
  assert.match(file, /requireApiRole\(\["admin"\]\)/);
  assert.match(file, /startDate must not be after endDate/);
  assert.match(file, /Date range cannot exceed 365 days/);
  assert.match(file, /public\.vw_daily_revenue/);
  assert.match(file, /sourceBreakdown/);
});

test("pc-usage endpoint masks revenue for staff users", async () => {
  const file = await readFile(resolve(process.cwd(), "src/app/api/analytics/pc-usage/route.ts"), "utf8");
  assert.match(file, /requireApiRole\(\["admin",\s*"staff"\]\)/);
  assert.match(file, /public\.vw_pc_usage_summary/);
  assert.match(file, /total_session_revenue:\s*isAdmin\s*\?\s*row\.total_session_revenue\s*:\s*undefined/);
  assert.match(file, /metricDisclaimer/);
});

test("popular-games endpoint queries view and category aggregate with HAVING/GROUP BY", async () => {
  const file = await readFile(resolve(process.cwd(), "src/app/api/analytics/popular-games/route.ts"), "utf8");
  assert.match(file, /requireApiRole\(\["admin",\s*"staff"\]\)/);
  assert.match(file, /public\.vw_popular_games/);
  assert.match(file, /ORDER BY play_count DESC/);
  assert.match(file, /GROUP BY gc\.category_name/);
});

test("analytics overview endpoint conditionally exposes financial metrics for admin only", async () => {
  const file = await readFile(resolve(process.cwd(), "src/app/api/analytics/overview/route.ts"), "utf8");
  assert.match(file, /requireApiRole\(\["admin",\s*"staff"\]\)/);
  assert.match(file, /revenue:\s*isAdmin\s*\?\s*\{/);
  assert.match(file, /public\.vw_daily_revenue/);
});
