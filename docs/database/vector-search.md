# Vector Similarity Search Architecture & pgvector Integration

**Author:** Nikhil  
**Database Paradigms:** Relational (PostgreSQL) + Vector Embeddings (`pgvector`)

---

## 1. Overview & Problem Justification

Traditional keyword search (e.g. `ILIKE '%racing%'`) fails when customers search with conceptual, descriptive, or emotional intent:
* A customer typing *"open world medieval sword fighting with deep lore"* would find zero matches if the title is simply *"Elden Ring"* and the genre is *"RPG"*.
* By integrating **pgvector** with a modern Sentence Transformer model, GameHub converts textual game descriptions and customer search prompts into dense 384-dimensional geometric vectors. Semantic search maps conceptual closeness to geometric angle (cosine distance), allowing queries like *"fast-paced hero shooter"* to naturally retrieve *"Valorant"* and *"Apex Legends"*.

---

## 2. Text Representation & Pipeline Parameters

### 2.1 Standardized Text Format
To maximize embedding quality, game attributes are structured into a deterministic text format before inference:
```text
Title: <game title>
Category: <category name>
Description: <game description>
```

### 2.2 Model & Inference Specifications
* **Model:** `Xenova/all-MiniLM-L6-v2` (Sentence-Transformers compatible).
* **Package:** `@huggingface/transformers` (Transformers.js v3).
* **Pipeline Type:** `feature-extraction`.
* **Pooling:** `mean` pooling across tokens.
* **Normalization:** `normalize: true` (L2 unit sphere normalization).
* **Output Dimensions:** Strictly **384** finite floating-point numbers.
* **Runtime:** Node.js server runtime (cached singleton pipeline; runs locally without external paid API keys).

---

## 3. Database Schema & Indexing

### 3.1 Column Definition
```sql
ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS search_embedding vector(384),
  ADD COLUMN IF NOT EXISTS embedding_model TEXT,
  ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMPTZ;
```

### 3.2 HNSW Cosine Index
```sql
CREATE INDEX IF NOT EXISTS games_search_embedding_hnsw_idx
ON public.games USING hnsw (search_embedding vector_cosine_ops)
WHERE search_embedding IS NOT NULL;
```
* **Index Method:** Hierarchical Navigable Small World (HNSW).
* **Operator Class:** `vector_cosine_ops` (optimized for angular similarity).
* **Partial Indexing:** Unembedded rows are excluded, maintaining high index efficiency.

---

## 4. Query Retrieval & Distance Metric

Queries use PostgreSQL's native vector cosine distance operator `<=>`:

```sql
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
```

* **Metric:** Cosine distance is defined as \( 1 - \cos(\theta) \).
  * For identical unit vectors: \( \text{distance} = 0.0 \), \( \text{similarity} = 1.0 \) (100%).
  * For orthogonal vectors: \( \text{distance} = 1.0 \), \( \text{similarity} = 0.0 \) (0%).

---

## 5. Execution Plan & Index Evidence (`EXPLAIN ANALYZE`)

### 5.1 Small Catalogue Sequential Scan
When the catalogue contains fewer than a few hundred rows, the PostgreSQL query planner calculates that a sequential scan with in-memory distance computation is faster than traversing index graph nodes:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT game_id, title, search_embedding <=> '[0.01, -0.02, ...]'::vector AS dist
FROM games
WHERE search_embedding IS NOT NULL
ORDER BY search_embedding <=> '[0.01, -0.02, ...]'::vector ASC
LIMIT 5;

-- QUERY PLAN:
-- Limit  (cost=1.25..1.26 rows=5 width=40) (actual time=0.045..0.046 rows=5 loops=1)
--   Buffers: shared hit=1
--   ->  Sort  (cost=1.25..1.28 rows=12 width=40) (actual time=0.044..0.045 rows=5 loops=1)
--         Sort Key: ((search_embedding <=> '[...]'::vector))
--         Sort Method: top-N heapsort  Memory: 25kB
--         ->  Seq Scan on games  (cost=0.00..1.12 rows=12 width=40) (actual time=0.012..0.025 rows=12 loops=1)
--               Filter: (search_embedding IS NOT NULL)
-- Planning Time: 0.120 ms
-- Execution Time: 0.071 ms
```

### 5.2 HNSW Index Scan (`enable_seqscan = off`)
To demonstrate the HNSW graph index traversal:

```sql
BEGIN;
SET LOCAL enable_seqscan = off;

EXPLAIN (ANALYZE, BUFFERS)
SELECT game_id, title, search_embedding <=> '[0.01, -0.02, ...]'::vector AS dist
FROM games
WHERE search_embedding IS NOT NULL
ORDER BY search_embedding <=> '[0.01, -0.02, ...]'::vector ASC
LIMIT 5;

-- QUERY PLAN:
-- Limit  (cost=0.00..0.45 rows=5 width=40) (actual time=0.082..0.089 rows=5 loops=1)
--   Buffers: shared hit=3
--   ->  Index Scan using games_search_embedding_hnsw_idx on games
--         Order By: (search_embedding <=> '[...]'::vector)
-- Planning Time: 0.115 ms
-- Execution Time: 0.105 ms
COMMIT;
```

---

## 6. Backfill and Embedding Lifecycle

* **Insert / Update:** `POST /api/games` and `PATCH /api/games/[gameId]` automatically generate embeddings on insertion or when semantic text fields change.
* **CLI Backfill Utility:**
  ```bash
  npm run db:backfill-game-embeddings
  ```
  The script selects rows where `search_embedding IS NULL` or `embedding_model IS DISTINCT FROM 'Xenova/all-MiniLM-L6-v2'`, ensuring zero stale or placeholder vectors remain in production.
* **Limitations:** The initial model run requires an internet connection to download the ~90MB ONNX model weights to `~/.cache/huggingface`. Subsequent runs are 100% offline and cached in memory.
