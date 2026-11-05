# GameHub Relational Schema & ER-to-Relational Mapping

**Author:** Nikhil  
**Status:** Final Integrated Schema (Post-Migrations 001, 002, 003, 004)

---

## 1. Formal Relational Schema Definition

Primary keys are marked with **(PK)**; Foreign keys are marked with **(FK)**; Unique keys are marked with **(UK)**.

1. **`user_profiles`** (
   **`auth_user_id`** PK [UUID] REFERENCES `auth.users(id)`,
   `role` [TEXT, CHECK: 'admin' | 'staff' | 'customer'],
   `staff_id` FK, UK [INT, NULLABLE] REFERENCES `staff(staff_id)`,
   `customer_id` FK, UK [INT, NULLABLE] REFERENCES `customers(customer_id)`,
   `created_at` [TIMESTAMPTZ]
   )

2. **`customers`** (
   **`customer_id`** PK [SERIAL],
   `name` [VARCHAR(100)],
   `email` UK [VARCHAR(100)],
   `phone` [VARCHAR(15), NULLABLE],
   `join_date` [TIMESTAMP],
   `updated_at` [TIMESTAMPTZ]
   )

3. **`staff`** (
   **`staff_id`** PK [SERIAL],
   `name` [VARCHAR(100)],
   `role` [VARCHAR(50), CHECK: 'admin' | 'manager' | 'attendant'],
   `shift` [VARCHAR(50), NULLABLE]
   )

4. **`gaming_pcs`** (
   **`pc_id`** PK [SERIAL],
   `pc_name` UK [VARCHAR(50)],
   `status` [VARCHAR(20), CHECK: 'available' | 'occupied' | 'maintenance'],
   `hourly_rate` [DECIMAL(5,2)]
   )

5. **`maintenance_records`** (
   **`maintenance_id`** PK [BIGSERIAL],
   `pc_id` FK [INT] REFERENCES `gaming_pcs(pc_id)` ON DELETE RESTRICT,
   `maintenance_date` [DATE],
   `issue_description` [TEXT],
   `resolved` [BOOLEAN],
   `resolved_at` [TIMESTAMP, NULLABLE],
   UNIQUE(`pc_id`, `maintenance_date`)
   )

6. **`reservations`** (
   **`reservation_id`** PK [SERIAL],
   `customer_id` FK [INT] REFERENCES `customers(customer_id)` ON DELETE RESTRICT,
   `pc_id` FK [INT] REFERENCES `gaming_pcs(pc_id)` ON DELETE RESTRICT,
   `start_time` [TIMESTAMP],
   `end_time` [TIMESTAMP],
   `status` [TEXT, CHECK: 'confirmed' | 'cancelled' | 'completed'],
   `notes` [TEXT, NULLABLE],
   `created_by_staff_id` FK [INT, NULLABLE] REFERENCES `staff(staff_id)`,
   `created_at` [TIMESTAMP],
   EXCLUDE USING gist (`pc_id` WITH =, tsrange(`start_time`, `end_time`) WITH &&) WHERE `status = 'confirmed'`
   )

7. **`gaming_sessions`** (
   **`session_id`** PK [SERIAL],
   `customer_id` FK [INT] REFERENCES `customers(customer_id)` ON DELETE RESTRICT,
   `pc_id` FK [INT] REFERENCES `gaming_pcs(pc_id)` ON DELETE RESTRICT,
   `start_time` [TIMESTAMP],
   `end_time` [TIMESTAMP, NULLABLE],
   `expected_end_time` [TIMESTAMP, NULLABLE],
   `reservation_id` FK [INT, NULLABLE] REFERENCES `reservations(reservation_id)`,
   `hourly_rate_snapshot` [NUMERIC(8,2)],
   `total_cost` [DECIMAL(7,2), NULLABLE]
   )

8. **`game_categories`** (
   **`category_id`** PK [SERIAL],
   `category_name` UK [VARCHAR(50)]
   )

9. **`games`** (
   **`game_id`** PK [SERIAL],
   `title` [VARCHAR(100)],
   `category_id` FK [INT, NULLABLE] REFERENCES `game_categories(category_id)` ON DELETE SET NULL,
   `description` [TEXT, NULLABLE],
   `search_embedding` [VECTOR(384), NULLABLE],
   `embedding_model` [TEXT, NULLABLE],
   `embedding_updated_at` [TIMESTAMPTZ, NULLABLE],
   `is_active` [BOOLEAN] DEFAULT TRUE
   )

10. **`session_games`** (
    **`session_id`** PK, FK [INT] REFERENCES `gaming_sessions(session_id)` ON DELETE RESTRICT,
    **`game_id`** PK, FK [INT] REFERENCES `games(game_id)` ON DELETE RESTRICT,
    `play_duration_minutes` [INT, NULLABLE],
    `duration_minutes` [INT, NULLABLE],
    `added_at` [TIMESTAMP]
    )

11. **`tournaments`** (
    **`tournament_id`** PK [SERIAL],
    `name` [VARCHAR(100)],
    `game_id` FK [INT] REFERENCES `games(game_id)`,
    `prize_pool` [DECIMAL(10,2), CHECK >= 0],
    `start_date` [DATE],
    `status` [TEXT, CHECK: 'draft' | 'open' | 'closed' | 'completed' | 'cancelled'],
    `max_participants` [INT, NULLABLE, CHECK > 0],
    `registration_deadline` [TIMESTAMPTZ, NULLABLE],
    `description` [TEXT, NULLABLE]
    )

12. **`tournament_registrations`** (
    **`tournament_id`** PK, FK [INT] REFERENCES `tournaments(tournament_id)` ON DELETE RESTRICT,
    **`customer_id`** PK, FK [INT] REFERENCES `customers(customer_id)` ON DELETE RESTRICT,
    `registration_date` [TIMESTAMP]
    )

13. **`membership_plans`** (
    **`plan_id`** PK [BIGSERIAL],
    `name` UK [TEXT],
    `description` [TEXT, NULLABLE],
    `duration_days` [INT, CHECK > 0],
    `price` [NUMERIC(10,2), CHECK >= 0],
    `discount_percent` [NUMERIC(5,2), CHECK BETWEEN 0 AND 100],
    `is_active` [BOOLEAN] DEFAULT TRUE,
    `created_at` [TIMESTAMPTZ]
    )

14. **`customer_memberships`** (
    **`membership_id`** PK [BIGSERIAL],
    `customer_id` FK [INT] REFERENCES `customers(customer_id)` ON DELETE RESTRICT,
    `plan_id` FK [BIGINT] REFERENCES `membership_plans(plan_id)` ON DELETE RESTRICT,
    `start_at` [TIMESTAMPTZ],
    `end_at` [TIMESTAMPTZ],
    `status` [TEXT, CHECK: 'active' | 'expired' | 'cancelled'],
    `price_paid` [NUMERIC(10,2), CHECK >= 0],
    `payment_method` [TEXT, CHECK: 'cash' | 'upi_demo' | 'card_demo'],
    `created_at` [TIMESTAMPTZ]
    )

15. **`snack_items`** (
    **`snack_id`** PK [BIGSERIAL],
    `name` UK [TEXT],
    `category` [TEXT, NULLABLE],
    `description` [TEXT, NULLABLE],
    `unit_price` [NUMERIC(10,2), CHECK >= 0],
    `stock_quantity` [INT, CHECK >= 0],
    `is_active` [BOOLEAN] DEFAULT TRUE,
    `updated_at` [TIMESTAMPTZ]
    )

16. **`orders`** (
    **`order_id`** PK [BIGSERIAL],
    `customer_id` FK [INT] REFERENCES `customers(customer_id)` ON DELETE RESTRICT,
    `status` [TEXT, CHECK: 'pending' | 'paid' | 'cancelled' | 'refunded'],
    `subtotal` [NUMERIC(10,2), CHECK >= 0],
    `discount_percent_snapshot` [NUMERIC(5,2), CHECK BETWEEN 0 AND 100],
    `discount_amount` [NUMERIC(10,2), CHECK >= 0],
    `total_amount` [NUMERIC(10,2), CHECK >= 0],
    `created_at` [TIMESTAMPTZ],
    `inventory_deducted_at` [TIMESTAMPTZ, NULLABLE]
    )

17. **`order_items`** (
    **`order_item_id`** PK [BIGSERIAL],
    `order_id` FK [BIGINT] REFERENCES `orders(order_id)` ON DELETE RESTRICT,
    `snack_id` FK [BIGINT] REFERENCES `snack_items(snack_id)` ON DELETE RESTRICT,
    `item_name_snapshot` [TEXT],
    `quantity` [INT, CHECK > 0],
    `unit_price_at_purchase` [NUMERIC(10,2), CHECK >= 0],
    `line_total` [NUMERIC(10,2), CHECK >= 0]
    )

18. **`payments`** (
    **`payment_id`** PK [BIGSERIAL],
    `order_id` FK, UK [BIGINT] REFERENCES `orders(order_id)` ON DELETE RESTRICT,
    `amount` [NUMERIC(10,2), CHECK >= 0],
    `method` [TEXT, CHECK: 'cash' | 'upi_demo' | 'card_demo'],
    `status` [TEXT, CHECK: 'pending' | 'paid' | 'failed' | 'refunded'],
    `provider_reference` [TEXT, NULLABLE],
    `note` [TEXT, NULLABLE],
    `created_at` [TIMESTAMPTZ]
    )

---

## 2. ER-to-Relational Mapping Methodology

The conversion from conceptual ER diagram to relational tables follows formal database design transformation rules:

### Step 1: Mapping Strong Entities
Each strong entity from the ER diagram maps directly to an independent relational table with its own primary key:
* `CUSTOMERS` -> `customers(customer_id [PK], ...)`
* `STAFF` -> `staff(staff_id [PK], ...)`
* `GAMING_PCS` -> `gaming_pcs(pc_id [PK], ...)`
* `GAME_CATEGORIES` -> `game_categories(category_id [PK], ...)`
* `MEMBERSHIP_PLANS` -> `membership_plans(plan_id [PK], ...)`
* `SNACK_ITEMS` -> `snack_items(snack_id [PK], ...)`

### Step 2: Mapping Weak Entities
* `MAINTENANCE_RECORDS` is existence-dependent on `GAMING_PCS`.
* Originally identified by the composite key `(pc_id, maintenance_date)`.
* In migration 003, it was enhanced with a surrogate primary key `maintenance_id BIGSERIAL` to allow multiple maintenance entries per machine per day while preserving a `UNIQUE(pc_id, maintenance_date)` secondary constraint.

### Step 3: Mapping 1:N Binary Relationships
For each 1:N relationship, the primary key of the "1" side is embedded as a foreign key on the "N" side:
* `CUSTOMERS (1) -> RESERVATIONS (N)`: `customer_id` placed as FK in `reservations`.
* `GAMING_PCS (1) -> RESERVATIONS (N)`: `pc_id` placed as FK in `reservations`.
* `CUSTOMERS (1) -> GAMING_SESSIONS (N)`: `customer_id` placed as FK in `gaming_sessions`.
* `GAMING_PCS (1) -> GAMING_SESSIONS (N)`: `pc_id` placed as FK in `gaming_sessions`.
* `GAME_CATEGORIES (1) -> GAMES (N)`: `category_id` placed as FK in `games`.
* `GAMES (1) -> TOURNAMENTS (N)`: `game_id` placed as FK in `tournaments`.
* `MEMBERSHIP_PLANS (1) -> CUSTOMER_MEMBERSHIPS (N)`: `plan_id` placed as FK in `customer_memberships`.
* `CUSTOMERS (1) -> ORDERS (N)`: `customer_id` placed as FK in `orders`.

### Step 4: Mapping M:N Binary Relationships into Associative Junction Tables
In relational modeling, M:N relationships cannot be represented with single foreign keys and require intermediate junction relations:
1. **Gaming Sessions and Games (M:N):**
   * Resolved by table `session_games`.
   * Composite Primary Key: `(session_id, game_id)`.
   * Relationship attributes: `duration_minutes`, `added_at`.
2. **Tournaments and Customers (M:N):**
   * Resolved by table `tournament_registrations`.
   * Composite Primary Key: `(tournament_id, customer_id)`.
   * Relationship attribute: `registration_date`.
   * Enforces that a customer can register at most once per tournament.
3. **Orders and Snack Items (M:N):**
   * Resolved by table `order_items`.
   * Surrogate PK: `order_item_id BIGSERIAL`.
   * Foreign keys: `order_id`, `snack_id`.
   * Snapshot attributes: `item_name_snapshot`, `unit_price_at_purchase`, `quantity`, `line_total`.

### Step 5: Mapping 1:1 Relationships
* **`orders (1) -> payments (1)`:**
  * Handled by embedding `order_id` in `payments` with a `UNIQUE` constraint, guaranteeing that each order maps to exactly one payment record.
* **`user_profiles (1) -> staff / customers (1)`:**
  * Handled with nullable unique foreign keys `staff_id UNIQUE` and `customer_id UNIQUE` checked mutually exclusively with `user_profiles_role_link_check`.
