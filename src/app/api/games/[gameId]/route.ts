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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  const auth = await requireApiRole(["admin", "staff", "customer"]);
  if (auth.response) return auth.response;

  const { gameId: rawGameId } = await params;
  const gameId = Number(rawGameId);
  if (!Number.isInteger(gameId) || gameId <= 0) {
    return NextResponse.json({ error: "Invalid gameId." }, { status: 400 });
  }

  try {
    const result = await query(
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
      WHERE g.game_id = $1;
      `,
      [gameId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Game not found." }, { status: 404 });
    }

    return NextResponse.json(result.rows[0]);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  const auth = await requireApiRole(["admin"]);
  if (auth.response) return auth.response;

  const { gameId: rawGameId } = await params;
  const gameId = Number(rawGameId);
  if (!Number.isInteger(gameId) || gameId <= 0) {
    return NextResponse.json({ error: "Invalid gameId." }, { status: 400 });
  }

  const existingRes = await query<{
    game_id: number;
    title: string;
    description: string | null;
    category_id: number | null;
    is_active: boolean;
  }>(
    "SELECT game_id, title, description, category_id, is_active FROM public.games WHERE game_id = $1;",
    [gameId]
  );

  if (existingRes.rows.length === 0) {
    return NextResponse.json({ error: "Game not found." }, { status: 404 });
  }

  const existing = existingRes.rows[0];
  const body = await request.json().catch(() => null);

  const title = body?.title !== undefined ? String(body.title).trim() : existing.title;
  const description = body?.description !== undefined ? (String(body.description).trim() || null) : existing.description;
  const categoryId = body?.categoryId !== undefined ? (body.categoryId === null ? null : Number(body.categoryId)) : existing.category_id;
  const isActive = body?.is_active !== undefined ? Boolean(body.is_active) : existing.is_active;

  if (!title || title.length > 100) {
    return NextResponse.json({ error: "Game title cannot be empty or exceed 100 characters." }, { status: 400 });
  }

  if (categoryId !== null && (!Number.isInteger(categoryId) || categoryId <= 0)) {
    return NextResponse.json({ error: "Invalid categoryId." }, { status: 400 });
  }

  try {
    let categoryName: string | null = null;
    if (categoryId) {
      const catRes = await query<{ category_name: string }>(
        "SELECT category_name FROM public.game_categories WHERE category_id = $1;",
        [categoryId]
      );
      if (catRes.rows.length === 0) {
        return NextResponse.json({ error: "Category not found." }, { status: 400 });
      }
      categoryName = catRes.rows[0].category_name;
    }

    // Only regenerate embedding if semantic fields (title, category, description) changed
    const semanticFieldsChanged =
      title !== existing.title ||
      categoryId !== existing.category_id ||
      description !== existing.description;

    if (semanticFieldsChanged) {
      const text = formatGameEmbeddingInput({ title, categoryName, description });
      const embedding = await generateGameEmbedding(text);
      const vectorLiteral = formatPgVector(embedding);

      const updated = await query(
        `
        UPDATE public.games
        SET title = $1,
            category_id = $2,
            description = $3,
            is_active = $4,
            search_embedding = $5::vector,
            embedding_model = $6,
            embedding_updated_at = CURRENT_TIMESTAMP
        WHERE game_id = $7
        RETURNING
          game_id, title, category_id, description, is_active,
          embedding_model, embedding_updated_at,
          (search_embedding IS NOT NULL) AS has_embedding;
        `,
        [title, categoryId, description, isActive, vectorLiteral, EMBEDDING_MODEL_NAME, gameId]
      );

      return NextResponse.json(updated.rows[0]);
    } else {
      // Only non-semantic fields (like is_active) updated
      const updated = await query(
        `
        UPDATE public.games
        SET is_active = $1
        WHERE game_id = $2
        RETURNING
          game_id, title, category_id, description, is_active,
          embedding_model, embedding_updated_at,
          (search_embedding IS NOT NULL) AS has_embedding;
        `,
        [isActive, gameId]
      );

      return NextResponse.json(updated.rows[0]);
    }
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  const auth = await requireApiRole(["admin"]);
  if (auth.response) return auth.response;

  const { gameId: rawGameId } = await params;
  const gameId = Number(rawGameId);
  if (!Number.isInteger(gameId) || gameId <= 0) {
    return NextResponse.json({ error: "Invalid gameId." }, { status: 400 });
  }

  try {
    // Check if game has historical associations (session plays or tournaments)
    const [sessionUsage, tournamentUsage] = await Promise.all([
      query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM public.session_games WHERE game_id = $1;",
        [gameId]
      ),
      query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM public.tournaments WHERE game_id = $1;",
        [gameId]
      ),
    ]);

    const sessionCount = Number(sessionUsage.rows[0]?.count ?? 0);
    const tournamentCount = Number(tournamentUsage.rows[0]?.count ?? 0);

    if (sessionCount > 0 || tournamentCount > 0) {
      return NextResponse.json(
        {
          error:
            "Game cannot be permanently deleted because historical session records or tournaments reference it. Soft-archive the game by setting is_active = false instead.",
          hasHistory: true,
          sessionPlays: sessionCount,
          tournaments: tournamentCount,
        },
        { status: 409 }
      );
    }

    const deleteRes = await query("DELETE FROM public.games WHERE game_id = $1 RETURNING game_id;", [gameId]);
    if (deleteRes.rows.length === 0) {
      return NextResponse.json({ error: "Game not found." }, { status: 404 });
    }

    return NextResponse.json({ message: "Game deleted successfully.", gameId });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
