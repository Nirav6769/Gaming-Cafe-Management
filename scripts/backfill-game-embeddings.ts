import { Pool } from "pg";
import {
  EMBEDDING_MODEL_NAME,
  formatGameEmbeddingInput,
  formatPgVector,
  generateGameEmbedding,
} from "../src/lib/embeddings/game-embeddings";

async function backfill() {
  const databaseUrl = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    console.error("Error: DATABASE_URL (or TEST_DATABASE_URL) environment variable is required.");
    process.exit(1);
  }

  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  const ssl = ["localhost", "127.0.0.1", "::1"].includes(hostname)
    ? undefined
    : { rejectUnauthorized: false };

  const pool = new Pool({ connectionString: databaseUrl, ssl });

  try {
    console.log(`Backfill tool: Checking games for embedding update using ${EMBEDDING_MODEL_NAME}...`);

    const result = await pool.query<{
      game_id: number;
      title: string;
      category_name: string | null;
      description: string | null;
      embedding_model: string | null;
    }>(
      `
      SELECT g.game_id, g.title, gc.category_name, g.description, g.embedding_model
      FROM public.games g
      LEFT JOIN public.game_categories gc ON gc.category_id = g.category_id
      WHERE g.search_embedding IS NULL
         OR g.embedding_model IS DISTINCT FROM $1
      ORDER BY g.game_id ASC;
      `,
      [EMBEDDING_MODEL_NAME]
    );

    const games = result.rows;
    if (games.length === 0) {
      console.log("All games have up-to-date embeddings. Nothing to backfill.");
      return;
    }

    console.log(`Found ${games.length} game(s) requiring embedding generation or update.`);

    let updatedCount = 0;
    for (const game of games) {
      console.log(`[${updatedCount + 1}/${games.length}] Processing "${game.title}" (ID: ${game.game_id})...`);
      const textToEmbed = formatGameEmbeddingInput({
        title: game.title,
        categoryName: game.category_name,
        description: game.description,
      });

      const vector = await generateGameEmbedding(textToEmbed);
      const vectorLiteral = formatPgVector(vector);

      await pool.query(
        `
        UPDATE public.games
        SET search_embedding = $1::vector,
            embedding_model = $2,
            embedding_updated_at = CURRENT_TIMESTAMP
        WHERE game_id = $3;
        `,
        [vectorLiteral, EMBEDDING_MODEL_NAME, game.game_id]
      );

      updatedCount++;
    }

    console.log(`Successfully completed backfill for ${updatedCount} game(s).`);
  } finally {
    await pool.end();
  }
}

backfill().catch((err) => {
  console.error("Backfill script error:", err);
  process.exit(1);
});
