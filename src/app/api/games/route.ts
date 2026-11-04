import { NextRequest, NextResponse } from "next/server";
import { query, errorMessage } from "@/lib/db";
import { requireApiRole } from "@/lib/auth";
import {
  EMBEDDING_MODEL_NAME,
  formatGameEmbeddingInput,
  formatPgVector,
  generateGameEmbedding,
} from "@/lib/embeddings/game-embeddings";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireApiRole(["admin", "staff", "customer"]);
  if (auth.response) return auth.response;

  const url = new URL(request.url);
  const categoryIdParam = url.searchParams.get("categoryId");
  const showAllParam = url.searchParams.get("all") === "true";

  const showInactive = showAllParam && auth.profile.role === "admin";

  try {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (!showInactive) {
      conditions.push("g.is_active = TRUE");
    }

    if (categoryIdParam) {
      const catId = Number(categoryIdParam);
      if (Number.isInteger(catId) && catId > 0) {
        params.push(catId);
        conditions.push(`g.category_id = $${params.length}`);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const gamesResult = await query(
      `
      SELECT
        g.game_id,
        g.title,
        g.description,
        g.category_id,
        c.category_name,
        g.is_active,
        g.embedding_model,
        g.embedding_updated_at,
        (g.search_embedding IS NOT NULL) AS has_embedding
      FROM public.games g
      LEFT JOIN public.game_categories c ON c.category_id = g.category_id
      ${whereClause}
      ORDER BY g.title ASC;
      `,
      params
    );

    const categoriesResult = await query(
      "SELECT category_id, category_name FROM public.game_categories ORDER BY category_name ASC;"
    );

    return NextResponse.json({
      games: gamesResult.rows,
      categories: categoriesResult.rows,
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  // Catalogue management is strictly admin-only
  const auth = await requireApiRole(["admin"]);
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const title = String(body?.title ?? "").trim();
  const categoryId = body?.categoryId ? Number(body.categoryId) : null;
  const description = String(body?.description ?? "").trim() || null;

  if (!title || title.length > 100) {
    return NextResponse.json(
      { error: "A valid game title (1-100 characters) is required." },
      { status: 400 }
    );
  }

  if (categoryId !== null && (!Number.isInteger(categoryId) || categoryId <= 0)) {
    return NextResponse.json(
      { error: "categoryId must be a positive integer if provided." },
      { status: 400 }
    );
  }

  try {
    let categoryName: string | null = null;
    if (categoryId) {
      const catCheck = await query<{ category_name: string }>(
        "SELECT category_name FROM public.game_categories WHERE category_id = $1;",
        [categoryId]
      );
      if (catCheck.rows.length === 0) {
        return NextResponse.json({ error: "Specified category does not exist." }, { status: 400 });
      }
      categoryName = catCheck.rows[0].category_name;
    }

    // Automatically generate 384-d dense embedding on game insertion
    const textToEmbed = formatGameEmbeddingInput({
      title,
      categoryName,
      description,
    });
    const embedding = await generateGameEmbedding(textToEmbed);
    const vectorLiteral = formatPgVector(embedding);

    const result = await query(
      `
      INSERT INTO public.games (
        title,
        category_id,
        description,
        search_embedding,
        embedding_model,
        embedding_updated_at,
        is_active
      )
      VALUES ($1, $2, $3, $4::vector, $5, CURRENT_TIMESTAMP, TRUE)
      RETURNING
        game_id,
        title,
        category_id,
        description,
        is_active,
        embedding_model,
        embedding_updated_at,
        (search_embedding IS NOT NULL) AS has_embedding;
      `,
      [title, categoryId, description, vectorLiteral, EMBEDDING_MODEL_NAME]
    );

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
