# GameHub — Entity–Relationship Diagram

**Integrated target model:** baseline `database/schema.sql`, `database/mvp_migration.sql`, and migrations `001`–`004`. This represents the complete application design, not only the original MVP.

## Complete ER diagram

```mermaid
erDiagram
  AUTH_USERS ||--o| USER_PROFILES : "auth identity"
  STAFF o|--o| USER_PROFILES : "staff mapping"
  CUSTOMERS o|--o| USER_PROFILES : "customer mapping"

  CUSTOMERS ||--o{ GAMING_SESSIONS : owns
  GAMING_PCS ||--o{ GAMING_SESSIONS : hosts
  CUSTOMERS ||--o{ RESERVATIONS : books
  GAMING_PCS ||--o{ RESERVATIONS : reserved
  STAFF o|--o{ RESERVATIONS : creates
  RESERVATIONS o|--o{ GAMING_SESSIONS : fulfils
  GAMING_PCS ||--o{ MAINTENANCE_RECORDS : has

  GAMING_SESSIONS ||--o{ SESSION_GAMES : records
  GAMES ||--o{ SESSION_GAMES : played
  GAME_CATEGORIES o|--o{ GAMES : classifies
  GAMES o|--o{ TOURNAMENTS : features
  TOURNAMENTS ||--o{ TOURNAMENT_REGISTRATIONS : has
  CUSTOMERS ||--o{ TOURNAMENT_REGISTRATIONS : enters

  MEMBERSHIP_PLANS ||--o{ CUSTOMER_MEMBERSHIPS : defines
  CUSTOMERS ||--o{ CUSTOMER_MEMBERSHIPS : purchases

  CUSTOMERS ||--o{ ORDERS : places
  USER_PROFILES o|--o{ ORDERS : creates
  ORDERS ||--o{ ORDER_ITEMS : contains
  SNACK_ITEMS ||--o{ ORDER_ITEMS : item
  ORDERS ||--o| PAYMENTS : payment

  AUTH_USERS { uuid id PK }
  USER_PROFILES { uuid auth_user_id PK text role int staff_id FK int customer_id FK }
  CUSTOMERS { int customer_id PK varchar name varchar email UK }
  STAFF { int staff_id PK varchar name varchar role varchar shift }
  GAMING_PCS { int pc_id PK varchar pc_name UK varchar status decimal hourly_rate }
  GAMING_SESSIONS { int session_id PK int customer_id FK int pc_id FK int reservation_id FK timestamp start_time timestamp end_time numeric total_cost }
  RESERVATIONS { int reservation_id PK int customer_id FK int pc_id FK int created_by_staff_id FK timestamp start_time timestamp end_time text status }
  MAINTENANCE_RECORDS { bigint maintenance_id PK int pc_id FK date maintenance_date boolean resolved }
  GAME_CATEGORIES { int category_id PK varchar category_name UK }
  GAMES { int game_id PK int category_id FK vector search_embedding boolean is_active }
  SESSION_GAMES { int session_id PK,FK int game_id PK,FK int duration_minutes }
  TOURNAMENTS { int tournament_id PK int game_id FK varchar name date start_date }
  TOURNAMENT_REGISTRATIONS { int tournament_id PK,FK int customer_id PK,FK timestamp registration_date }
  MEMBERSHIP_PLANS { bigint plan_id PK text name UK numeric price numeric discount_percent }
  CUSTOMER_MEMBERSHIPS { bigint membership_id PK int customer_id FK bigint plan_id FK timestamp start_at timestamp end_at }
  SNACK_ITEMS { bigint snack_id PK text name UK numeric unit_price int stock_quantity }
  ORDERS { bigint order_id PK int customer_id FK uuid created_by FK text status numeric total_amount }
  ORDER_ITEMS { bigint order_item_id PK bigint order_id FK bigint snack_id FK int quantity numeric unit_price_at_purchase }
  PAYMENTS { bigint payment_id PK bigint order_id FK,UK numeric amount text method text status }
```

## Cardinalities and interpretation

| Relationship | Cardinality | Implementation |
|---|---|---|
| Customer → Sessions | 1:N | Each session belongs to one customer; a customer has session history. |
| PC → Sessions | 1:N over time | Partial unique index allows at most one active session per PC. |
| Customer → Reservations | 1:N | Each reservation belongs to one customer. |
| PC → Reservations | 1:N over time | GiST exclusion constraint prevents overlapping confirmed reservations for the same PC. |
| Reservation → Sessions | 1:N optional | A session can reference a reservation; walk-ins have no reservation. |
| PC → Maintenance Records | 1:N | Each maintenance record belongs to one PC. |
| Session ↔ Game | M:N | Resolved by `SESSION_GAMES(session_id, game_id)`. |
| Tournament ↔ Customer | M:N | Resolved by `TOURNAMENT_REGISTRATIONS(tournament_id, customer_id)`. |
| Customer ↔ Membership Plan | M:N over time | Resolved by `CUSTOMER_MEMBERSHIPS`; only one active membership per customer. |
| Order ↔ Snack Item | M:N | Resolved by `ORDER_ITEMS`, with quantity and purchase-time price/name snapshots. |
| Order → Payment | 1:0..1 | `payments.order_id` is UNIQUE; payment may not yet exist. |
| Auth User → User Profile | 1:0..1 | Profile maps Supabase identity to application role. |

## Design notes

- `auth.users` is managed by Supabase Auth, not created by the GameHub schema.
- `USER_PROFILES` has a role/link CHECK: admin and staff profiles link to a staff row; customer profiles link to a customer row.
- The original maintenance weak-key `(pc_id, maintenance_date)` remains UNIQUE. Migration 003 adds `maintenance_id` as the operational PK.
- Migration 003 adds `duration_minutes` to `SESSION_GAMES`, while retaining legacy `play_duration_minutes`.
- Historical price snapshots are stored in sessions, memberships and order items.
- Analytics views are derived relations, not base entities: `vw_active_customer_memberships`, `vw_snack_sales_summary`, `vw_popular_games`, `vw_pc_usage_summary`, `vw_daily_revenue`.
- Constraints and triggers enforce billing, PC status, reservation conflicts, membership uniqueness, order totals, payment transitions, stock deduction and tournament capacity.
