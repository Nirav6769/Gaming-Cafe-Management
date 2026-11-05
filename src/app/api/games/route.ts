import { NextRequest, NextResponse } from "next/server";
import { query, errorMessage } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await query(`SELECT g.game_id, g.title, g.description, c.category_name
      FROM games g LEFT JOIN game_categories c ON c.category_id = g.category_id
      ORDER BY g.title`);
    const categories = await query("SELECT category_id, category_name FROM game_categories ORDER BY category_name");
    return NextResponse.json({ games: result.rows, categories: categories.rows });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const title = String(body?.title ?? "").trim();
  const categoryId = body?.categoryId ? Number(body.categoryId) : null;
  const description = String(body?.description ?? "").trim() || null;
  if (!title || title.length > 100 || (categoryId !== null && !Number.isInteger(categoryId))) {
    return NextResponse.json({ error: "A game title and valid category are required." }, { status: 400 });
  }
  try {
    const result = await query(`INSERT INTO games (title, category_id, description)
      VALUES ($1, $2, $3) RETURNING game_id, title, description`, [title, categoryId, description]);
    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
