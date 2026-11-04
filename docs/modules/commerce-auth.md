# Commerce and authentication module

## Architecture

Supabase Auth stores identity and credentials. Next.js server routes verify a user with `supabase.auth.getUser()`, load the authoritative `user_profiles` row using the server-side PostgreSQL pool, and enforce roles with `requireApiRole` or `requirePageRole`. The domain customer ID is read from the verified profile.

- `admin`: full management of customers, plans, snacks, orders and payments.
- `staff`: customer/commerce operations and payments; cannot create or manage plans or change roles.
- `customer`: own customer profile, membership, snack orders and payment history only.

A browser-supplied `role` or customer ID never changes the authenticated user's authority. Customers are scoped using `profile.customerId`.

## Entity/data dictionary

### customers (baseline table, extended by 002)

| Column | Meaning |
|---|---|
| customer_id | Existing integer primary key |
| name | Customer display name |
| email | Login/contact email; for linked users the login identity remains owned by Supabase Auth |
| phone | Optional phone (maximum 15 characters) |
| join_date | Existing customer creation timestamp |
| updated_at | Added by Commerce migration; refreshed by a before-update trigger |

### membership_plans

| Column | Meaning |
|---|---|
| plan_id | BIGSERIAL primary key |
| name | Unique plan name |
| description | Optional details |
| duration_days | Positive membership duration, maximum 3650 days |
| price | Non-negative plan price |
| discount_percent | Snack-order discount from 0 to 100 |
| is_active | Whether a customer may purchase the plan |
| created_at | Creation timestamp |

### customer_memberships

| Column | Meaning |
|---|---|
| membership_id | BIGSERIAL primary key |
| customer_id | FK to customers, RESTRICT on delete |
| plan_id | FK to membership_plans, RESTRICT on delete |
| start_at / end_at | Validity window, generated from plan duration |
| status | active, expired or cancelled |
| price_paid | Snapshotted from plan price by trigger |
| payment_method | cash, upi_demo or card_demo (demo labels only) |
| created_at | Purchase record timestamp |

At most one row per customer may have status active. The discount function additionally checks the current timestamp is within the validity window.

### snack_items

`snack_id` is a BIGSERIAL primary key; `name` is unique; `category` and `description` are optional; `unit_price` and `stock_quantity` are non-negative; `is_active` controls catalogue visibility; `updated_at` is maintained on stock/price changes.

### orders

`order_id` is a BIGSERIAL primary key. Each order references one customer and its creator's verified `user_profiles.auth_user_id`. Status is pending, paid, cancelled or refunded. `subtotal`, `discount_amount`, `total_amount` and `discount_percent_snapshot` are database-controlled. `inventory_deducted_at` records the one-time stock transition.

### order_items

Each line references an order and snack using RESTRICT foreign keys. Quantity must be positive. `item_name_snapshot`, `unit_price_at_purchase` and `line_total` preserve the purchased price even if a snack's name or current price changes later.

### payments

One final payment record per order (unique order_id). Fields are payment_id, order_id, amount, method, status, provider_reference, note and created_at. Methods are cash, upi_demo and card_demo. Status is pending, paid, failed or refunded. Payment amount must equal the order's database-computed total before paid status is accepted.

## Core database logic

1. `commerce_snapshot_membership_purchase` copies plan price and validity dates to a membership row.
2. `commerce_get_customer_discount_percent` returns the active, in-date membership discount or zero.
3. `commerce_snapshot_order_discount` snapshots the discount at order creation.
4. `commerce_guard_order_item` locks/checks the parent order, snapshots snack price on insert/snack change and preserves price on quantity-only updates.
5. `commerce_recalculate_order_total` recalculates subtotal, discount and total after line changes.
6. `commerce_validate_payment` validates payment/order state and amount.
7. `commerce_apply_payment_to_order` moves the order to paid/refunded after payment state changes.
8. `commerce_guard_order_transition` checks matching payment, locks snack rows in deterministic order, atomically deducts stock and sets the idempotency marker. Refund does not restore stock.
9. `commerce_touch_customer_updated_at` timestamps customer profile changes.

New Commerce tables have RLS enabled without client Data API policies; direct `anon` and `authenticated` table/sequence access is revoked. Trigger/discount function execute permissions are also revoked. Application data access uses the server PostgreSQL pool only after role and ownership checks.

## API map

See `docs/COMMERCE.md` for the route table and role matrix. API routes are parameterised and validate IDs, names, email, phone, price, duration, discount, stock, quantity, status and ownership. Payments are created/marked paid/refunded only by admin/staff.

## Important business rules

- No live payment gateway is included; demo methods are academic records only.
- Membership price and dates come from the selected plan, not request-body price fields.
- Existing order prices and discount are snapshots.
- A payment-to-paid transition is in the same database transaction as order-paid and stock deduction.
- Insufficient stock rejects the whole transaction, including partial stock deductions.
- Refund status changes do not restock snacks.
- Orders are not hard-deleted, and order items cannot be edited after payment.
