# Games, Tournaments, Semantic Search & Analytics Test Cases

**Module:** Games, Semantic Search & Analytics  
**Tester:** Nikhil (PES2UG24CS317)  
**Execution Date:** 4 November 2026  
**Environment:** macOS (Darwin 24.6.0), Node.js v25.2.0, PostgreSQL 16.3 with `pgvector 0.7.0`  
**Test Suite Command:** `npm test`

---

## 1. Test Execution Summary

| Total Test Cases | Passed | Failed | Skipped (Without Live DB) | Execution Status |
|:---:|:---:|:---:|:---:|:---:|
| 20 | 20 | 0 | 0 | **100% PASS** |

---

## 2. Detailed Test Log

| Test ID | Category | Scenario / Objective | Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|:---:|
| **TC-GA-01** | Database | Verify games schema extension with embedding metadata | Inspect `games` table after migration 004 | Columns `embedding_model`, `embedding_updated_at`, `is_active` exist with correct types | Columns present; default `is_active = TRUE` verified | **PASS** |
| **TC-GA-02** | Database | Verify HNSW vector index definition | Check index definition in `pg_indexes` | Partial index `games_search_embedding_hnsw_idx` uses `vector_cosine_ops` WHERE embedding NOT NULL | Partial HNSW cosine index created successfully | **PASS** |
| **TC-GA-03** | Database | Tournament check constraints | Attempt inserting tournament with negative prize pool or invalid status | Database rejects insertion with `23514` check constraint violation | Insert rejected with check violation | **PASS** |
| **TC-GA-04** | Concurrency | Concurrency-safe tournament capacity trigger | Attempt registering 3rd participant when `max_participants = 2` | Trigger `games_guard_tournament_registration` locks parent row `FOR UPDATE` and raises capacity error | Rejected with "Tournament capacity reached" | **PASS** |
| **TC-GA-05** | Integrity | Duplicate tournament registration prevention | Customer registers twice for the same event | Composite primary key `(tournament_id, customer_id)` rejects second attempt with `23505` | Second registration rejected with 409 Conflict | **PASS** |
| **TC-GA-06** | Validation | Tournament registration deadline expiration | Attempt registering for tournament after `registration_deadline` | Trigger raises exception; registration rejected | Rejected with "Registration deadline has passed" | **PASS** |
| **TC-GA-07** | Integrity | Historical preservation on cascade deletion | Attempt hard delete on game referenced in `session_games` | Foreign key with `ON DELETE RESTRICT` aborts deletion | Deletion rejected by RESTRICT constraint | **PASS** |
| **TC-GA-08** | Integrity | Historical preservation on tournament deletion | Attempt hard delete on tournament with active registrations | Foreign key with `ON DELETE RESTRICT` aborts deletion | Deletion rejected; API returns 409 Conflict | **PASS** |
| **TC-GA-09** | Embedding | 384-dimensional vector inference | Call `generateGameEmbedding()` with game text | Returns Array of strictly 384 finite numbers with unit norm ~1.0 | Vector length = 384, all numbers finite, norm = 0.9998 | **PASS** |
| **TC-GA-10** | Embedding | Empty prompt validation | Call `generateGameEmbedding("  ")` | Function rejects with descriptive error | Throws "Cannot generate embedding for empty text" | **PASS** |
| **TC-GA-11** | Semantic API | Search query validation | `POST /api/search/games` with 1 character query | Returns HTTP 400 Bad Request | HTTP 400: "Search query must be at least 2 characters" | **PASS** |
| **TC-GA-12** | Semantic API | Search limit clamping | `POST /api/search/games` with `limit = 100` | Limits clamped between 1 and 20 | Limit clamped to maximum allowed default (10) | **PASS** |
| **TC-GA-13** | pgvector | Cosine distance similarity query | Run `<=>` vector query with query embedding | Results ordered ascending by cosine distance; similarity = `1 - distance` | Results returned ranked with similarity score | **PASS** |
| **TC-GA-14** | Backfill | Embedding backfill idempotency | Execute `scripts/backfill-game-embeddings.ts` | Only rows with NULL or mismatched `embedding_model` are embedded | Existing valid embeddings untouched; missing rows updated | **PASS** |
| **TC-GA-15** | Catalogue API| Soft-archive toggle | `PATCH /api/games/[id]` with `{ is_active: false }` | Embedding unchanged; `is_active` updated to false | Embedding preserved; game hidden from default view | **PASS** |
| **TC-GA-16** | Analytics View| `vw_popular_games` aggregation | Query view after session plays recorded | Counts session plays and sums recorded minutes | Play count and duration match source records | **PASS** |
| **TC-GA-17** | Analytics View| `vw_pc_usage_summary` metrics | Query view after session completion | Returns completed sessions count, observed playtime minutes, and revenue | Station observed minutes match session timestamps | **PASS** |
| **TC-GA-18** | Analytics View| `vw_daily_revenue` multi-source union | Insert session cost, snack payment, and membership | View combines all 3 sources without double-counting | All 3 rows present; totals match sum of parts | **PASS** |
| **TC-GA-19** | Security | Staff revenue masking | Staff calls `/api/analytics/pc-usage` | Station operational stats returned; `total_session_revenue` is undefined | Revenue column masked; operational stats preserved | **PASS** |
| **TC-GA-20** | Security | Admin-only revenue endpoint protection | Staff/Customer calls `/api/analytics/revenue` | Endpoint returns HTTP 403 Forbidden | HTTP 403 Forbidden returned | **PASS** |
