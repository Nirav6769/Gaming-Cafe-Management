# Commerce module

## Apply the migration

Run `database/migrations/002_commerce.sql` after
`database/migrations/001_auth_foundation.sql`. It is independent of
`003_operations.sql`, so the Commerce and Operations migrations can be applied
in either order after the authentication foundation.

The migration creates membership plans and memberships, snack inventory,
orders, order items and demo payment records. It also creates the active
membership discount function, order total and item-price triggers, an
atomic stock-decrement trigger, payment validation, indexes and two reporting
views.

## Roles

- Admin: create membership plans, manage snacks, assign memberships, create
  customer orders, record demo/cash payments and fulfil orders.
- Staff: manage snacks and stock, assign memberships, create orders, record
  demo/cash payments and fulfil orders. Membership plan creation is admin-only.
- Customer: browse active plans/snacks, purchase a plan for their own linked
  customer record, create/place/cancel their own draft orders and record a
  payment for their own placed order.

Customer ownership always comes from the verified `user_profiles.customer_id`
returned by the server-side auth guard. Customer APIs do not accept a customer
ID from the request body as an authority.

## Commerce rules

- Membership purchases snapshot the plan price and start/end dates. An active
  membership provides a percentage discount to orders created during its
  validity window.
- A new order snapshots its membership discount. Each order item snapshots
  the snack name and unit price at insertion time.
- Draft order items can be removed. Order totals are recalculated by a database
  trigger after each line-item change.
- Stock is decremented atomically only when a draft order transitions to
  `placed`. A failed stock update rolls back the order transition. Later
  fulfilment does not decrement stock again. Cancelling a placed order does
  not automatically restock items.
- Payments are demo records. The application does not connect to a payment
  gateway or collect/store card numbers. A successful payment must match the
  order total and a placed/fulfilled order can have only one successful payment.

## API routes

- `GET /api/commerce`: role-scoped plans, snacks, memberships and orders.
- `POST /api/commerce/plans`: admin creates a plan.
- `POST/PATCH /api/commerce/snacks`: staff/admin manage inventory.
- `POST /api/commerce/memberships`: purchase/assign a plan.
- `POST /api/commerce/orders`: create a draft order with item snapshots.
- `PATCH /api/commerce/orders/:orderId`: place, fulfil or cancel.
- `DELETE /api/commerce/orders/:orderId/items/:itemId`: remove a draft line.
- `POST /api/commerce/orders/:orderId/pay`: record a demo/cash payment.

## Reporting objects

- `vw_active_customer_memberships`: currently valid memberships with customer
  and plan details.
- `vw_snack_sales_summary`: units sold and gross sales by snack for placed
  and fulfilled orders.

## Tests

CI applies the migration to a disposable PostgreSQL service, then exercises
membership discount lookup, item-price snapshots, order-total recalculation,
stock decrement and rollback on insufficient inventory, draft item deletion,
and scoped RLS grants. These tests do not run against production Supabase data.
