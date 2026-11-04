import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EMBEDDING_DIMENSION,
  EMBEDDING_MODEL_NAME,
  formatGameEmbeddingInput,
  formatPgVector,
  generateGameEmbedding,
  isValidEmbedding,
} from "../src/lib/embeddings/game-embeddings";

test("formatGameEmbeddingInput builds standard structured text representation", () => {
  const formatted = formatGameEmbeddingInput({
    title: "Apex Legends",
    categoryName: "Battle Royale",
    description: "Fast-paced hero shooter",
  });

  assert.equal(
    formatted,
    "Title: Apex Legends\nCategory: Battle Royale\nDescription: Fast-paced hero shooter"
  );
});

test("formatGameEmbeddingInput provides sensible defaults for missing fields", () => {
  const formatted = formatGameEmbeddingInput({
    title: "Elden Ring",
    categoryName: null,
    description: undefined,
  });

  assert.equal(
    formatted,
    "Title: Elden Ring\nCategory: General\nDescription: No description provided."
  );
});

test("isValidEmbedding validates 384-dimensional numeric arrays", () => {
  const validVector = new Array(EMBEDDING_DIMENSION).fill(0.05);
  assert.equal(isValidEmbedding(validVector), true);

  // Wrong dimension
  assert.equal(isValidEmbedding([0.1, 0.2]), false);

  // Non-finite values
  const withNaN = [...validVector];
  withNaN[10] = Number.NaN;
  assert.equal(isValidEmbedding(withNaN), false);

  // Non-array
  assert.equal(isValidEmbedding(null), false);
  assert.equal(isValidEmbedding("vector"), false);
});

test("formatPgVector converts numeric array to pgvector literal", () => {
  const vector = new Array(EMBEDDING_DIMENSION).fill(0.123);
  const literal = formatPgVector(vector);

  assert.ok(literal.startsWith("["));
  assert.ok(literal.endsWith("]"));
  assert.equal(literal.split(",").length, EMBEDDING_DIMENSION);
});

test("generateGameEmbedding produces 384-dimensional normalized vector", async () => {
  const text = formatGameEmbeddingInput({
    title: "Hades",
    categoryName: "Roguelike",
    description: "Action dungeon crawler in Greek underworld",
  });

  const embedding = await generateGameEmbedding(text);
  assert.equal(embedding.length, EMBEDDING_DIMENSION);
  assert.equal(isValidEmbedding(embedding), true);

  // Check vector is unit-normalized (magnitude ≈ 1.0)
  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  assert.ok(Math.abs(norm - 1.0) < 0.05, `Expected unit norm ~1.0, got ${norm}`);
});

test("generateGameEmbedding rejects empty text input", async () => {
  await assert.rejects(
    async () => {
      await generateGameEmbedding("   ");
    },
    /Cannot generate embedding for empty text/
  );
});

test("exports standard model name", () => {
  assert.equal(EMBEDDING_MODEL_NAME, "Xenova/all-MiniLM-L6-v2");
});
