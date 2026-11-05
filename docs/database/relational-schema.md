# GameHub — Relational Schema

**Database:** PostgreSQL on Supabase  
**Scope:** integrated target schema after baseline and migrations 001–004.

**Notation:** PK = primary key; FK = foreign key; UQ = unique; NN = NOT NULL. Names are shown in uppercase for readability; actual PostgreSQL identifiers are lowercase.

## 1. Identity and access

### USER_PROFILES
`USER_PROFILES(auth_user_id, role, staff_id, customer_id, created_at)`
- **PK:** `auth_user_id UUID`; **FK:** `auth_user_id → auth.users(id)` ON DELETE CASCADE.
- **FK + UQ:** `staff_id INTEGER → staff(staff_id)` ON DELETE RESTRICT.
- **FK + UQ:** `customer_id INTEGER → customers(customer_id)` ON DELETE RESTRICT.
- `role TEXT NN CHECK role IN ('admin','staff','customer')`; `created_at TIMESTAMPTZ NN DEFAULT CURRENT_TIMESTAMP`.
- CHECK enforces exactly the appropriate link: admin/staff → staff; customer → customer. Supabase owns `auth.users`.

## 2. Core café operations

### CUSTOMERS
`CUSTOMERS(customer_id, name, email, phone, join_date, updated_at)`
- **PK:** `customer_id SERIAL`; **UQ:** `email VARCHAR(100)`.
- `name VARCHAR(100) NN`; `email VARCHAR(100) NN`; `phone VARCHAR(15)`; `join_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP`; `updated_at TIMESTAMPTZ NN DEFAULT CURRENT_TIMESTAMP` (migration 002).

### STAFF
`STAFF(staff_id, name, role, shift)`
- **PK:** `staff_id SERIAL`.
- `name VARCHAR(100) NN`; `role VARCHAR(50) CHECK role IN ('admin','manager','attendant')`; `shift VARCHAR(50)`.

### GAMING_PCS
`GAMING_PCS(pc_id, pc_name, status, hourly_rate)`
- **PK:** `pc_id SERIAL`; **UQ:** `pc_name VARCHAR(50)`.
- `status VARCHAR(20) DEFAULT 'available' CHECK status IN ('available','occupied','maintenance')`; `hourly_rate DECIMAL(5,2) NN`.

### GAMING_SESSIONS
`GAMING_SESSIONS(session_id, customer_id, pc_id, start_time, end_time, total_cost, expected_end_time, reservation_id, hourly_rate_snapshot)`
- **PK:** `session_id SERIAL`.
- **FK:** `customer_id → customers(customer_id)` ON DELETE RESTRICT; `pc_id → gaming_pcs(pc_id)` ON DELETE RESTRICT.
- **FK:** `reservation_id → reservations(reservation_id)` ON DELETE SET NULL.
- `customer_id INTEGER NN`; `pc_id INTEGER NN`; `start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP`; `end_time TIMESTAMP`; `total_cost DECIMAL(7,2)`; `expected_end_time TIMESTAMP`; `hourly_rate_snapshot NUMERIC(8,2)`.
- CHECK: expected end is NULL or later than start. Partial UNIQUE index on `pc_id WHERE end_time IS NULL` permits at most one active session per PC. Billing trigger snapshots the rate and calculates cost.

### RESERVATIONS
`RESERVATIONS(reservation_id, customer_id, pc_id, start_time, end_time, status, notes, created_by_staff_id, created_at)`
- **PK:** `reservation_id SERIAL`.
- **FK:** `customer_id → customers(customer_id)` ON DELETE RESTRICT; `pc_id → gaming_pcs(pc_id)` ON DELETE RESTRICT; `created_by_staff_id → staff(staff_id)` ON DELETE SET NULL.
- `customer_id INTEGER NN`; `pc_id INTEGER NN`; `start_time TIMESTAMP NN`; `end_time TIMESTAMP NN`; `status TEXT NN DEFAULT 'confirmed' CHECK IN ('confirmed','cancelled','completed')`; `notes TEXT`; `created_by_staff_id INTEGER`; `created_at TIMESTAMP NN DEFAULT CURRENT_TIMESTAMP`.
- CHECK: `end_time > start_time`. GiST exclusion constraint disallows overlapping confirmed time ranges on the same PC.

### MAINTENANCE_RECORDS
`MAINTENANCE_RECORDS(maintenance_id, pc_id, maintenance_date, issue_description, resolved, resolved_at)`
- **PK:** `maintenance_id BIGSERIAL` (migration 003).
- **FK:** `pc_id → gaming_pcs(pc_id)` ON DELETE RESTRICT.
- **UQ:** `(pc_id, maintenance_date)` retains the original weak-entity uniqueness.
- `maintenance_date DATE NN`; `issue_description TEXT NN`; `resolved BOOLEAN DEFAULT FALSE`; `resolved_at TIMESTAMP`.

## 3. Games and tournaments

### GAME_CATEGORIES
`GAME_CATEGORIES(category_id, category_name)`
- **PK:** `category_id SERIAL`; **UQ:** `category_name VARCHAR(50) NN`.

### GAMES
`GAMES(game_id, title, category_id, description, search_embedding, embedding_model, embedding_updated_at, is_active)`
- **PK:** `game_id SERIAL`; **FK:** `category_id → game_categories(category_id)` ON DELETE SET NULL.
- `title VARCHAR(100) NN`; `category_id INTEGER`; `description TEXT`; `search_embedding VECTOR(384)`; `embedding_model TEXT`; `embedding_updated_at TIMESTAMPTZ`; `is_active BOOLEAN NN DEFAULT TRUE`.
- Partial HNSW index supports cosine similarity search for non-NULL embeddings.

### TOURNAMENTS
`TOURNAMENTS(tournament_id, name, game_id, prize_pool, start_date, status, max_participants, registration_deadline, description)`
- **PK:** `tournament_id SERIAL`; **FK:** `game_id → games(game_id)` (default NO ACTION).
- `name VARCHAR(100) NN`; `game_id INTEGER`; `prize_pool DECIMAL(10,2)`; `start_date DATE NN`; `status TEXT NN DEFAULT 'open' CHECK IN ('draft','open','closed','completed','cancelled')`; `max_participants INTEGER`; `registration_deadline TIMESTAMPTZ`; `description TEXT`.
- CHECKs: prize pool nonnegative when supplied; max participants positive when supplied.

### SESSION_GAMES
`SESSION_GAMES(session_id, game_id, play_duration_minutes, duration_minutes, added_at)`
- **Composite PK:** `(session_id, game_id)`.
- **FK:** `session_id → gaming_sessions(session_id)` ON DELETE RESTRICT; `game_id → games(game_id)` ON DELETE RESTRICT.
- `play_duration_minutes INTEGER` (baseline compatibility column); `duration_minutes INTEGER CHECK NULL or >= 0` (migration 003); `added_at TIMESTAMP NN DEFAULT CURRENT_TIMESTAMP`.

### TOURNAMENT_REGISTRATIONS
`TOURNAMENT_REGISTRATIONS(tournament_id, customer_id, registration_date)`
- **Composite PK:** `(tournament_id, customer_id)`.
- **FK:** `tournament_id → tournaments(tournament_id)` ON DELETE RESTRICT; `customer_id → customers(customer_id)` ON DELETE RESTRICT.
- `registration_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP`.

## 4. Membership and commerce

### MEMBERSHIP_PLANS
`MEMBERSHIP_PLANS(plan_id, name, description, duration_days, price, discount_percent, is_active, created_at)`
- **PK:** `plan_id BIGSERIAL`; **UQ:** `name TEXT NN`.
- `description TEXT`; `duration_days INTEGER NN CHECK 1..3650`; `price NUMERIC(10,2) NN CHECK >= 0`; `discount_percent NUMERIC(5,2) NN DEFAULT 0 CHECK 0..100`; `is_active BOOLEAN NN DEFAULT TRUE`; `created_at TIMESTAMPTZ NN DEFAULT CURRENT_TIMESTAMP`.

### CUSTOMER_MEMBERSHIPS
`CUSTOMER_MEMBERSHIPS(membership_id, customer_id, plan_id, start_at, end_at, status, price_paid, payment_method, created_at)`
- **PK:** `membership_id BIGSERIAL`.
- **FK:** `customer_id → customers(customer_id)` ON DELETE RESTRICT; `plan_id → membership_plans(plan_id)` ON DELETE RESTRICT.
- `customer_id INTEGER NN`; `plan_id BIGINT NN`; `start_at TIMESTAMPTZ NN`; `end_at TIMESTAMPTZ NN`; `status TEXT NN DEFAULT 'active' CHECK IN ('active','expired','cancelled')`; `price_paid NUMERIC(10,2) NN DEFAULT 0 CHECK >= 0`; `payment_method TEXT NN DEFAULT 'cash' CHECK IN ('cash','upi_demo','card_demo')`; `created_at TIMESTAMPTZ NN DEFAULT CURRENT_TIMESTAMP`.
- CHECK: `end_at > start_at`. Partial UNIQUE index on `customer_id WHERE status='active'`. Insert trigger snapshots plan price and duration.

### SNACK_ITEMS
`SNACK_ITEMS(snack_id, name, category, description, unit_price, stock_quantity, is_active, updated_at)`
- **PK:** `snack_id BIGSERIAL`; **UQ:** `name TEXT NN`.
- `category TEXT`; `description TEXT`; `unit_price NUMERIC(10,2) NN CHECK >= 0`; `stock_quantity INTEGER NN DEFAULT 0 CHECK >= 0`; `is_active BOOLEAN NN DEFAULT TRUE`; `updated_at TIMESTAMPTZ NN DEFAULT CURRENT_TIMESTAMP`.

### ORDERS
`ORDERS(order_id, customer_id, created_by, status, subtotal, discount_amount, total_amount, discount_percent_snapshot, inventory_deducted_at, created_at)`
- **PK:** `order_id BIGSERIAL`.
- **FK:** `customer_id → customers(customer_id)` ON DELETE RESTRICT; `created_by → user_profiles(auth_user_id)` ON DELETE SET NULL.
- `customer_id INTEGER NN`; `created_by UUID`; `status TEXT NN DEFAULT 'pending' CHECK IN ('pending','paid','cancelled','refunded')`; `subtotal NUMERIC(10,2) NN DEFAULT 0 CHECK >= 0`; `discount_amount NUMERIC(10,2) NN DEFAULT 0 CHECK >= 0`; `total_amount NUMERIC(10,2) NN DEFAULT 0 CHECK >= 0`; `discount_percent_snapshot NUMERIC(5,2) NN DEFAULT 0 CHECK 0..100`; `inventory_deducted_at TIMESTAMPTZ`; `created_at TIMESTAMPTZ NN DEFAULT CURRENT_TIMESTAMP`.
- Database triggers snapshot membership discount and recalculate totals.

### ORDER_ITEMS
`ORDER_ITEMS(order_item_id, order_id, snack_id, item_name_snapshot, quantity, unit_price_at_purchase, line_total)`
- **PK:** `order_item_id BIGSERIAL`.
- **FK:** `order_id → orders(order_id)` ON DELETE RESTRICT; `snack_id → snack_items(snack_id)` ON DELETE RESTRICT.
- `order_id BIGINT NN`; `snack_id BIGINT NN`; `item_name_snapshot TEXT NN`; `quantity INTEGER NN CHECK > 0`; `unit_price_at_purchase NUMERIC(10,2) NN CHECK >= 0`; `line_total NUMERIC(10,2) NN CHECK >= 0`.
- CHECK: `line_total = ROUND(quantity * unit_price_at_purchase, 2)`. Trigger snapshots item name/price and recalculates pending order totals.

### PAYMENTS
`PAYMENTS(payment_id, order_id, amount, method, status, provider_reference, note, created_at)`
- **PK:** `payment_id BIGSERIAL`; **FK + UQ:** `order_id → orders(order_id)` ON DELETE RESTRICT.
- `amount NUMERIC(10,2) NN CHECK >= 0`; `method TEXT NN CHECK IN ('cash','upi_demo','card_demo')`; `status TEXT NN DEFAULT 'pending' CHECK IN ('pending','paid','failed','refunded')`; `provider_reference TEXT`; `note TEXT`; `created_at TIMESTAMPTZ NN DEFAULT CURRENT_TIMESTAMP`.
- UNIQUE `order_id` means each order has at most one payment row. These are academic/demo records, not gateway transactions.

## 5. Associative relations

| Relation | Primary key | Purpose |
|---|---|---|
| SESSION_GAMES | `(session_id, game_id)` | Resolves M:N session/game; stores play duration. |
| TOURNAMENT_REGISTRATIONS | `(tournament_id, customer_id)` | Resolves M:N tournament/customer; stores registration date. |
| ORDER_ITEMS | `order_item_id` | Resolves M:N order/snack; stores quantity and historical price/name. |
| CUSTOMER_MEMBERSHIPS | `membership_id` | Records customer plan purchases over time. |

## 6. Views (derived relations, not base tables)

- `vw_active_customer_memberships`: active, currently valid memberships with customer and plan details.
- `vw_snack_sales_summary`: units sold and gross sales by snack.
- `vw_popular_games`: play counts and recorded minutes by game.
- `vw_pc_usage_summary`: completed sessions, usage time and session revenue by PC.
- `vw_daily_revenue`: daily revenue from sessions, snack payments and memberships.

## 7. Normalization and functional-dependency notes

- Entity keys determine their descriptive attributes (e.g. `customer_id → name, email, phone, join_date, updated_at`).
- Alternate unique keys include customer email, PC name, category name, membership-plan name and snack name; `payments.order_id` is also unique.
- Composite keys prevent duplicate session/game and tournament/customer pairs.
- `ORDER_ITEMS` stores name and unit-price snapshots intentionally: later catalogue edits must not rewrite historical purchases. Session hourly-rate snapshots and membership price-paid values serve the same purpose.
- Totals, PC status and some lifecycle fields are trigger-maintained/validated. They are not intended to be freely supplied by the client.

## 8. Migration order

For a **fresh** database, the repository documents this order:
1. `database/schema.sql`
2. `database/seed.sql`
3. `database/mvp_migration.sql`
4. `database/migrations/001_auth_foundation.sql`
5. `database/migrations/002_commerce.sql`
6. `database/migrations/003_operations.sql`
7. `database/migrations/004_games_analytics.sql`

Do not rerun the non-idempotent baseline schema on an already initialized database. This document describes the integrated target design; compare it with the live Supabase catalog after applying migrations before claiming it exactly matches the deployed database.
