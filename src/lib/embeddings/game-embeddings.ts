import { pipeline } from "@huggingface/transformers";

export const EMBEDDING_MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIMENSION = 384;

// Cache the pipeline promise in memory to avoid repeated model re-initialization
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipelinePromise: Promise<any> | null = null;

async function getExtractorPipeline() {
  if (!pipelinePromise) {
    pipelinePromise = pipeline("feature-extraction", EMBEDDING_MODEL_NAME);
  }
  return pipelinePromise;
}

export interface GameEmbeddingInput {
  title: string;
  categoryName?: string | null;
  description?: string | null;
}

/**
 * Formats game attributes into a standardized text representation for embedding.
 */
export function formatGameEmbeddingInput(game: GameEmbeddingInput): string {
  const title = (game.title || "").trim();
  const category = (game.categoryName || "General").trim();
  const description = (game.description || "No description provided.").trim();

  return `Title: ${title}\nCategory: ${category}\nDescription: ${description}`;
}

/**
 * Validates that a vector is strictly an array of 384 finite numbers.
 */
export function isValidEmbedding(vector: unknown): vector is number[] {
  return (
    Array.isArray(vector) &&
    vector.length === EMBEDDING_DIMENSION &&
    vector.every((val) => typeof val === "number" && Number.isFinite(val))
  );
}

/**
 * Converts a numeric embedding array into pgvector literal format '[0.1,0.2,...]'.
 */
export function formatPgVector(vector: number[]): string {
  if (!isValidEmbedding(vector)) {
    throw new Error(
      `Invalid vector: expected array of ${EMBEDDING_DIMENSION} finite numbers.`
    );
  }
  return `[${vector.join(",")}]`;
}

/**
 * Generates a normalized 384-dimensional dense vector using Xenova/all-MiniLM-L6-v2.
 */
export async function generateGameEmbedding(text: string): Promise<number[]> {
  const cleaned = text.trim();
  if (!cleaned) {
    throw new Error("Cannot generate embedding for empty text.");
  }

  const extractor = await getExtractorPipeline();
  const output = await extractor(cleaned, {
    pooling: "mean",
    normalize: true,
  });

  const rawData = Array.from(output.data as ArrayLike<number>);
  const receivedLength = rawData.length;
  if (!isValidEmbedding(rawData)) {
    throw new Error(
      `Model output validation failed: expected ${EMBEDDING_DIMENSION} finite numbers, received ${receivedLength}.`
    );
  }

  return rawData;
}
