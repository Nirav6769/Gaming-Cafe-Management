import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

test("semantic search endpoint validates query and executes pgvector cosine query", async () => {
  const file = await readFile(resolve(process.cwd(), "src/app/api/search/games/route.ts"), "utf8");
  assert.match(file, /requireApiRole\(\["admin",\s*"staff",\s*"customer"\]\)/);
  assert.match(file, /searchQuery\.length < 2/);
  assert.match(file, /searchQuery\.length > 300/);
  assert.match(file, /generateGameEmbedding\(searchQuery\)/);
  assert.match(file, /g\.search_embedding\s*<=>\s*\$1::vector/);
  assert.match(file, /ORDER BY g\.search_embedding\s*<=>\s*\$1::vector ASC/);
  assert.match(file, /LIMIT \$2/);
});

test("games API endpoint enforces admin role on create and regenerates embeddings", async () => {
  const file = await readFile(resolve(process.cwd(), "src/app/api/games/route.ts"), "utf8");
  assert.match(file, /requireApiRole\(\["admin"\]\)/);
  assert.match(file, /formatGameEmbeddingInput/);
  assert.match(file, /generateGameEmbedding/);
  assert.match(file, /search_embedding/);
  assert.match(file, /embedding_model/);
  assert.match(file, /embedding_updated_at/);
});

test("game detail API endpoint protects history and regenerates embedding on semantic updates", async () => {
  const file = await readFile(resolve(process.cwd(), "src/app/api/games/[gameId]/route.ts"), "utf8");
  assert.match(file, /semanticFieldsChanged/);
  assert.match(file, /generateGameEmbedding/);
  assert.match(file, /SELECT COUNT\(\*\)::text AS count FROM public\.session_games WHERE game_id = \$1/);
  assert.match(file, /SELECT COUNT\(\*\)::text AS count FROM public\.tournaments WHERE game_id = \$1/);
  assert.match(file, /409/);
});

test("backfill script selects null or outdated model embeddings and uses Xenova model", async () => {
  const file = await readFile(resolve(process.cwd(), "scripts/backfill-game-embeddings.ts"), "utf8");
  assert.match(file, /WHERE g\.search_embedding IS NULL\s+OR g\.embedding_model IS DISTINCT FROM \$1/);
  assert.match(file, /generateGameEmbedding/);
  assert.match(file, /formatPgVector/);
  assert.match(file, /SET search_embedding = \$1::vector/);
});
