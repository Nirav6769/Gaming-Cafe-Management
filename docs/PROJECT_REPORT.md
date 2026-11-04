# GameHub — Gaming Café Management System

> Module contribution draft for the consolidated project report. The coordinator should merge this material with Operations and Games/Analytics results. Do not present pending integration or manual tests as completed.

## 1. Problem statement

Gaming cafés coordinate customers, memberships, gaming stations, session reservations, snacks and payments. When these activities are tracked separately or manually, staff can lose visibility into customer history, current membership benefits, snack inventory and the relationship between orders and payments. The project builds a central web application backed by a relational database to coordinate these records and support operational analysis.

## 2. Motivation

The project focuses on a concrete café workflow rather than a generic CRUD demo. Membership benefits must be reflected in order totals, snack quantities must remain correct when multiple orders are paid, and historical item prices must remain stable after the catalogue price changes. These rules make transaction management, constraints and triggers central to the design.

## 3. Objectives

- Provide a role-aware application for admins, staff and customers.
- Maintain customer profiles and customer membership history.
- Allow admins to define membership plans and staff/admin to manage snack inventory.
- Create customer snack orders with database-calculated prices, discounts and totals.
- Ensure order payment, order status and stock deduction are atomic.
- Preserve purchase history and prevent edits after payment.
- Provide database views and query examples for operational reporting.
- Use Supabase Auth for identity while enforcing application permissions on the server.

## 4. Scope

The Commerce module includes customer profiles, membership plans, membership purchase records, snack catalogue and stock, pending/paid/cancelled/refunded orders, order items and demo payment records. Membership price/dates and order line prices are stored as snapshots. A paid order deducts stock in PostgreSQL; a refund changes status without restocking consumed items.

Real payment gateway integration, storing card or UPI credentials, and automatic refund restocking are out of scope. Customer self-registration is optional and is not included; test identities are provisioned through Supabase Auth and mapped to domain records.

## 5. Functional and non-functional requirements

### Functional

- Admin/staff can search customers; customers access only their own profile.
- Admin creates/deactivates membership plans; staff/admin assign memberships; customers purchase their own.
- Admin/staff create/update/deactivate snack items and manage stock.
- All roles can create orders within their permitted customer scope.
- Pending orders support quantity edits and item deletion; paid orders are immutable.
- Admin/staff record payment and refund status; customers cannot mark their own payments paid/refunded.
- Database rules calculate discounts/totals and enforce inventory consistency.

### Non-functional

- Role and customer ownership are checked server-side.
- SQL queries are parameterised.
- Database constraints protect price, quantity, membership and payment data.
- Payment and stock changes are transactional.
- Secrets and database credentials are not exposed to client code.
- New application tables are protected from direct Supabase Data API access.

## 14. Commerce architecture and security

The browser communicates with Next.js App Router pages and route handlers. The server verifies identity through Supabase Auth `getUser()`, loads role/customer mapping from `user_profiles`, and accesses application data through the server-side PostgreSQL `pg` pool.

The Commerce migration creates membership plans, customer memberships, snack items, orders, order items and payments. It adds a guarded customer-table alteration, indexes, a stored membership discount function, reporting views and triggers for price snapshots, order total recalculation, payment validation and stock deduction. RLS is enabled on new Commerce tables and direct `anon`/`authenticated` grants are revoked; because the server database role is privileged, route-level authorization and customer ownership filters remain mandatory.

The payment workflow is academic/demo-only. Payment rows are marked paid only by admin/staff-authorised APIs. PostgreSQL validates the amount and item existence before changing the order to paid and deducting stock. An insufficient item quantity aborts the transaction. Refund status changes do not restock snacks.

## 18. Conclusion and future enhancements

The Commerce module demonstrates how relational design, constraints, transactions, functions and triggers can enforce real café rules rather than relying on the browser. It preserves customer and order history, snapshots prices and discounts, and makes stock changes atomic with payment state.

Future work may include live customer self-registration, a real payment provider after security review, membership renewal notifications, refunds/stock adjustment workflows with audit trails, richer sales reports and integration with the Operations and Games/Analytics modules. Final conclusions and performance results should be added after full integration and manual role testing.
