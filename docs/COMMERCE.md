# Commerce module

## Migration and dependency order

Apply migrations in this order:

1. Existing baseline: `database/schema.sql`, `database/seed.sql`, `database/mvp_migration.sql` (only on a fresh project, not again on a database where they are already applied).
2. `database/migrations/001_auth_foundation.sql`.
3. `database/migrations/002_commerce.sql`.
4. `database/migrations/003_operations.sql`.

Commerce and Operations both depend on the baseline and Auth foundation, but are otherwise independent. Do not re-run the non-idempotent baseline schema on the populated Supabase project.

## Database objects

| Object | Purpose | Important constraints |
|---|---|---|
| `membership_plans` | Admin-managed duration, price and discount catalogue | Unique name; positive duration; non-negative price; discount 0–100 |
| `customer_memberships` | Customer membership history and membership revenue | FK to customer and plan; one row with status `active` per customer; price and dates snapshotted by trigger |
| `snack_items` | Snack catalogue and stock | Unique name; non-negative price and stock; active flag; category |
| `orders` | Customer snack orders | Status pending/paid/cancelled/refunded; discount snapshot; stock-deduction timestamp |
| `order_items` | Items in an order | Parent and snack FKs use RESTRICT; quantity positive; historical unit price snapshot |
| `payments` | One final payment record per order | Unique order FK; amount must match order total; cash/UPI-demo/card-demo methods |
| `vw_active_customer_memberships` | Current valid memberships | Includes customer, plan, dates, discount and membership payment method |
| `vw_snack_sales_summary` | Snack unit and sales summary | Aggregates paid/refunded order lines |

The migration adds `customers.updated_at` with a guarded `ALTER TABLE` and a trigger that refreshes it on customer updates. Login email remains managed by Supabase Auth; customer profile edits are limited to name and phone so the café email cannot drift from the verified login identity.

## Membership rules

The database trigger on `customer_memberships` loads the selected active plan and overwrites the supplied price and dates. The price stored in `price_paid` always comes from `membership_plans.price`; a client cannot choose it. Expired active rows are marked `expired` before a new membership is inserted. A partial unique index prevents concurrent duplicate active memberships.

`commerce_get_customer_discount_percent(customer_id)` returns the discount only when the customer's membership has status `active` and the current timestamp falls inside its start/end window. An order stores a `discount_percent_snapshot` when it is created, so a future membership or plan change does not rewrite an existing order.

Membership purchases are academic/demo records stored directly on `customer_memberships` (`price_paid`, `payment_method`, `created_at`). `cash`, `upi_demo`, and `card_demo` are labels only; no card number, UPI PIN, bank credential or gateway is used. Membership revenue is available to the analytics module through `customer_memberships.price_paid`, excluding cancelled memberships.

## Order and payment lifecycle

```text
pending order
  ├── cancelled
  └── payment pending → payment paid → order paid (stock deducted atomically)
                                      └── payment refunded → order refunded
```

- Order items can be inserted, quantity-updated or deleted only while the parent order is `pending`.
- The item trigger reads the active snack's current name and price on insert (or when the snack changes). A quantity-only update keeps `unit_price_at_purchase` unchanged.
- An after-trigger recalculates subtotal, membership discount amount and total.
- Only admin/staff can record an order payment or refund a payment. The payment API takes the authoritative total from PostgreSQL; it never accepts an amount from the browser.
- On the payment's transition to `paid`, PostgreSQL checks that the order has at least one item and that payment amount equals the order total. The payment trigger updates the order to `paid`; the order trigger locks snack rows in ascending `snack_id`, checks all quantities, decrements stock and sets `inventory_deducted_at`.
- If any item is short, the transaction rolls back the payment status, order status and every stock change. Repeating a paid status update does not deduct stock again.
- Refunds update payment/order status only. Snacks are assumed prepared/served and are not restocked. Repeating a refund is idempotent.
- Order items and payments use `ON DELETE RESTRICT`; there is no order hard-delete API.

## API routes

| Route | Method | Access | Purpose |
|---|---|---|---|
| `/api/commerce` | GET | All roles | Dashboard data; customer rows, memberships and orders are scoped to verified customer ID |
| `/api/commerce/customers` | GET | All roles | Admin/staff search; customer receives only own profile |
| `/api/commerce/customers` | POST | Admin/staff | Create customer record |
| `/api/commerce/customers/:customerId` | PATCH | Admin/staff or matching customer | Update name/phone; login email stays with Supabase Auth |
| `/api/commerce/plans` | POST/PATCH | Admin | Create plans; update plan data or deactivate/reactivate |
| `/api/commerce/memberships` | POST | All roles | Purchase/assign membership; customer ID comes from verified profile for customer role |
| `/api/commerce/memberships/:membershipId` | PATCH | Admin/staff | Cancel an active membership |
| `/api/commerce/snacks` | POST/PATCH | Admin/staff | Create snacks, update price/stock, activate/deactivate |
| `/api/commerce/orders` | POST | All roles | Create a pending order and its lines in one transaction |
| `/api/commerce/orders/:orderId` | PATCH | All roles, owner-scoped for customer | Cancel a pending order |
| `/api/commerce/orders/:orderId/items/:itemId` | PATCH/DELETE | All roles, owner-scoped for customer | Change quantity or delete a pending line |
| `/api/commerce/payments` | POST | Admin/staff | Record payment; database marks order paid and deducts stock |
| `/api/commerce/payments/:paymentId` | PATCH | Admin/staff | Record a demo refund without restocking |

All SQL uses parameterised values. Customer ownership comes from `requireApiRole` and `profile.customerId`, never from a role or customer ID supplied by a customer request.

## Role matrix

| Capability | Admin | Staff | Customer |
|---|---:|---:|---:|
| Search/list all customers | Yes | Yes | No |
| View/update own profile | Yes | Yes | Yes |
| Create/manage membership plans | Yes | No | No |
| Assign/purchase memberships | Yes | Assist/assign | Own only |
| Manage snack catalogue and stock | Yes | Yes | No |
| Create snack orders | Yes | For customer | Own only |
| Record order payment/refund | Yes | Yes | No |
| View order/membership history | All | All | Own only |

## Reporting and advanced SQL

The migration includes the membership discount function, price/total/payment/inventory triggers, partial/regular indexes, reporting views and transaction-backed API workflows. Example SELECT/JOIN, aggregate, GROUP BY/HAVING, subquery, INSERT, UPDATE and DELETE statements are in `docs/database/commerce-queries.sql`.

## Test status

The repeatable PostgreSQL test is `tests/commerce-migration.test.ts`; it applies the migration in a rollback-only transaction and verifies the business invariants and grants. The CI workflow runs lint, all tests and a production build on a disposable PostgreSQL service. Manual authentication/browser checks require configured Supabase Auth test accounts; the pass/fail matrix is in `docs/testing/commerce-auth-test-cases.md`. Do not treat an unrun manual test as passed.
