import { NextRequest, NextResponse } from "next/server";
import { query, errorMessage } from "@/lib/db";
import { requireApiRole } from "@/lib/auth";
import {
  EMBEDDING_MODEL_NAME,
  formatPgVector,
  generateGameEmbedding,
} from "@/lib/embeddings/game-embeddings";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(["admin", "staff", "customer"]);
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const searchQuery = typeof body?.query === "string" ? body.query.trim() : "";
  const rawLimit = Number(body?.limit);
  const limit = Number.isInteger(rawLimit) && rawLimit >= 1 && rawLimit <= 20 ? rawLimit : 10;

  if (!searchQuery || searchQuery.length < 2) {
    return NextResponse.json(
      { error: "Search query must be at least 2 characters long." },
      { status: 400 }
    );
  }

  if (searchQuery.length > 300) {
    return NextResponse.json(
      { error: "Search query cannot exceed 300 characters." },
      { status: 400 }
    );
  }

  try {
    // Generate real 384-d dense embedding for the user prompt using Xenova/all-MiniLM-L6-v2
    const queryVector = await generateGameEmbedding(searchQuery);
    const vectorLiteral = formatPgVector(queryVector);

    // Retrieve nearest games by pgvector cosine distance operator <=>
    const sql = `
      SELECT
        g.game_id,
        g.title,
        g.description,
        g.category_id,
        gc.category_name,
        g.embedding_model,
        g.embedding_updated_at,
        ROUND((g.search_embedding <=> $1::vector)::numeric, 4) AS cosine_distance,
        ROUND((1 - (g.search_embedding <=> $1::vector))::numeric, 4) AS similarity_score
      FROM public.games g
      LEFT JOIN public.game_categories gc ON gc.category_id = g.category_id
      WHERE g.search_embedding IS NOT NULL
        AND g.is_active = TRUE
      ORDER BY g.search_embedding <=> $1::vector ASC
      LIMIT $2;
    `;

    const result = await query(sql, [vectorLiteral, limit]);

    return NextResponse.json({
      query: searchQuery,
      model: EMBEDDING_MODEL_NAME,
      count: result.rows.length,
      results: result.rows,
    });
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 500 }
    );
  }
}
