# GameHub — Entity–Relationship Diagram

**Scope:** integrated DBMS Level 3 design, based on the baseline schema and migrations `001_auth_foundation.sql` through `004_games_analytics.sql`.

This is the logical ER model for the integrated application. Supabase's `auth.users` is an external identity table; GameHub stores its role/domain mapping in `user_profiles`.

## Complete ER diagram

```mermaid
erDiagram
    AUTH_USERS ||--o| USER_PROFILES : "has app profile"
    STAFF o|--o| USER_PROFILES : "linked staff identity"
    CUSTOMERS o|--o| USER_PROFILES : "linked customer identity"

    CUSTOMERS ||--o{ GAMING_SESSIONS : plays
    GAMING_PCS ||--o{ GAMING_SESSIONS : hosts
    GAMING_PCS ||--o{ MAINTENANCE_RECORDS : has
    CUSTOMERS ||--o{ RESERVATIONS : makes
    GAMING_PCS ||--o{ RESERVATIONS : reserved_for
    STAFF o|--o{ RESERVATIONS : creates
    RESERVATIONS o|--o{ GAMING_SESSIONS : "may be used by"

    GAMING_SESSIONS ||--o{ SESSION_GAMES : records
    GAMES ||--o{ SESSION_GAMES : included_in
    GAME_CATEGORIES o|--o{ GAMES : classifies
    GAMES o|--o{ TOURNAMENTS : features
    TOURNAMENTS ||--o{ TOURNAMENT_REGISTRATIONS : has
    CUSTOMERS ||--o{ TOURNAMENT_REGISTRATIONS : registers

    MEMBERSHIP_PLANS ||--o{ CUSTOMER_MEMBERSHIPS : defines
    CUSTOMERS ||--o{ CUSTOMER_MEMBERSHIPS : purchases

    CUSTOMERS ||--o{ ORDERS : places
    USER_PROFILES o|--o{ ORDERS : creates
    ORDERS ||--o{ ORDER_ITEMS : contains
    SNACK_ITEMS ||--o{ ORDER_ITEMS : ordered_as
    ORDERS ||--o| PAYMENTS : paid_by

    AUTH_USERS {
        uuid id PK
    }
    USER_PROFILES {
        uuid auth_user_id PK, FK
        text role
        int staff_id FK, UK
        int customer_id FK, UK
        timestamptz created_at
    }
    CUSTOMERS {
        int customer_id PK
        varchar name
        varchar email UK
        varchar phone
        timestamp join_date
        timestamptz updated_at
    }
    STAFF {
        int staff_id PK
        varchar name
        varchar role
        varchar shift
    }
    GAMING_PCS {
        int pc_id PK
        varchar pc_name UK
        varchar status
        decimal hourly_rate
    }
    GAMING_SESSIONS {
        int session_id PK
        int customer_id FK
        int pc_id FK
        int reservation_id FK
        timestamp start_time
        timestamp expected_end_time
        timestamp end_time
        numeric hourly_rate_snapshot
        numeric total_cost
    }
    RESERVATIONS {
        int reservation_id PK
        int customer_id FK
        int pc_id FK
        int created_by_staff_id FK
        timestamp start_time
        timestamp end_time
        text status
    }
    MAINTENANCE_RECORDS {
        bigint maintenance_id PK
        int pc_id FK
        date maintenance_date
        text issue_description
        boolean resolved
        timestamp resolved_at
    }
    GAME_CATEGORIES {
        int category_id PK
        varchar category_name UK
    }
    GAMES {
        int game_id PK
        varchar title
        int category_id FK
        text description
        vector search_embedding
        text embedding_model
        timestamptz embedding_updated_at
        boolean is_active
    }
    SESSION_GAMES {
        int session_id PK, FK
        int game_id PK, FK
        int play_duration_minutes
        int duration_minutes
        timestamp added_at
    }
    TOURNAMENTS {
        int tournament_id PK
        varchar name
        int game_id FK
        decimal prize_pool
        date start_date
        text status
        int max_participants
        timestamptz registration_deadline
        text description
    }
    TOURNAMENT_REGISTRATIONS {
        int tournament_id PK, FK
        int customer_id PK, FK
        timestamp registration_date
    }
    MEMBERSHIP_PLANS {
        bigint plan_id PK
        text name UK
        text description
        int duration_days
        numeric price
        numeric discount_percent
        boolean is_active
        timestamptz created_at
    }
    CUSTOMER_MEMBERSHIPS {
        bigint membership_id PK
        int customer_id FK
        bigint plan_id FK
        timestamptz start_at
        timestamptz end_at
        text status
        numeric price_paid
        text payment_method
        timestamptz created_at
    }
    SNACK_ITEMS {
        bigint snack_id PK
        text name UK
        text category
        text description
        numeric unit_price
        int stock_quantity
        boolean is_active
        timestamptz updated_at
    }
    ORDERS {
        bigint order_id PK
        int customer_id FK
        uuid created_by FK
        text status
        numeric subtotal
        numeric discount_amount
        numeric total_amount
        numeric discount_percent_snapshot
        timestamptz inventory_deducted_at
        timestamptz created_at
    }
    ORDER_ITEMS {
        bigint order_item_id PK
        bigint order_id FK
        bigint snack_id FK
        text item_name_snapshot
        int quantity
        numeric unit_price_at_purchase
        numeric line_total
    }
    PAYMENTS {
        bigint payment_id PK
        bigint order_id FK, UK
        numeric amount
        text method
        text status
        text provider_reference
        text note
        timestamptz created_at
    }
```

## Relationship and cardinality notes

| Relationship | Cardinality | Meaning |
|---|---|---|
| Customer–Gaming Session | 1:N | A customer can have many historical sessions; each session belongs to one customer. |
| Gaming PC–Gaming Session | 1:N | A PC hosts many sessions over time; the partial unique index permits at most one active session per PC. |
| Customer–Reservation / PC–Reservation | 1:N each | A customer can make multiple reservations; a PC can be reserved at different time slots. |
| Reservation–Gaming Session | 1:N optional link | A session may reference one reservation; a reservation can be referenced by multiple session rows over time unless application rules restrict it. |
| PC–Maintenance Record | 1:N | A PC can have multiple maintenance records; every record belongs to one PC. |
| Session–Game | M:N | Resolved by `session_games`, whose composite primary key is `(session_id, game_id)`. |
| Customer–Tournament | M:N | Resolved by `tournament_registrations`, whose composite primary key is `(tournament_id, customer_id)`. |
| Customer–Membership Plan | M:N over time | Resolved by `customer_memberships`; a partial unique index allows only one row with `status = 'active'` per customer. |
| Order–Snack Item | M:N | Resolved by `order_items`, which stores purchase-time name and price snapshots. |
| Order–Payment | 1:0..1 | Each order can have zero or one payment row; `payments.order_id` is UNIQUE. |
| Auth User–User Profile | 1:0..1 | A Supabase Auth user may have one GameHub profile. |
| User Profile–Staff / Customer | 1:0..1 | Profile links are optional individually, but a CHECK constraint requires exactly one staff link for admin/staff or one customer link for customer role. |

## Important modelling decisions

1. **Associative entities:** `session_games`, `tournament_registrations`, and `order_items` resolve many-to-many relationships and carry relationship-specific attributes.
2. **Maintenance identity:** the baseline weak-entity key `(pc_id, maintenance_date)` is retained as a UNIQUE constraint. Operations migration 003 adds `maintenance_id` as the primary key so multiple maintenance records can be managed consistently.
3. **Historical pricing:** `gaming_sessions.hourly_rate_snapshot`, `customer_memberships.price_paid`, and `order_items.unit_price_at_purchase` preserve the price used at the time of the transaction.
4. **Database-enforced rules:** active-session uniqueness, reservation time overlap, session/reservation conflicts, billing, PC status synchronization, membership uniqueness, order totals, payment state transitions, inventory deduction, and tournament capacity are enforced by indexes, constraints, and triggers.
5. **Analytics:** `vw_popular_games`, `vw_pc_usage_summary`, and `vw_daily_revenue` are views, not base entities, so they are not shown as tables in the ERD.

## Source of truth

The baseline entities are defined in `database/schema.sql`; the integrated model is the result of applying `database/mvp_migration.sql` and migrations `001`–`004` in the documented order. This diagram describes the integrated target schema, not just the original MVP.
