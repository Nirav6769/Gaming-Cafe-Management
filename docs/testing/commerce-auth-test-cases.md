# Commerce and authentication test matrix

**Environment:** automated CI uses a disposable PostgreSQL 16 service. Supabase browser-session tests require configured test users and a development Supabase project.  
**Actual results:** populate only after the corresponding test is run. No live Supabase/browser pass is claimed in this document.

| ID | Scenario | Automated coverage | Manual Supabase/browser result |
|---|---|---|---|
| 1 | Unauthenticated API returns 401 | Auth policy unit tests cover unauthenticated decision; route smoke test still required | Not run |
| 2 | Admin can access allowed management features | Role-policy unit test | Not run |
| 3 | Staff cannot manage plans or roles | Plan API guard is admin-only; role matrix must be browser-smoke-tested | Not run |
| 4 | Customer cannot read another customer's profile/orders/memberships | Ownership filters in customer APIs and aggregate API; browser/API integration check still required | Not run |
| 5 | Client-supplied role/customer ID cannot elevate access | API uses verified profile for customer ownership; browser tampering test still required | Not run |
| 6 | Sign-out invalidates the old session | Existing auth work covers route behavior; replay old cookies against live Supabase is manual | Not run |
| 7 | Create valid plan; reject invalid duration/price/discount | API validation and database CHECK constraints | Not run |
| 8 | Membership assignment stores correct plan price and dates | Commerce database test verifies trigger snapshot | Not run |
| 9 | Expired/cancelled membership grants zero discount | Commerce database test verifies date window/status | Not run |
| 10 | Reject negative snack stock and price | Commerce database test verifies CHECK constraints | Not run |
| 11 | Multi-item order totals use database prices and membership discount | Commerce database test verifies item and total triggers | Not run |
| 12 | Insufficient inventory rolls back payment and all stock updates | Commerce database test verifies atomic rollback | Not run |
| 13 | Paid transition deducts exact ordered quantities | Commerce database test verifies stock counts | Not run |
| 14 | Repeating paid status does not deduct twice | Commerce database test verifies idempotency | Not run |
| 15 | Delete a pending item recalculates totals | Commerce database test verifies subtotal/discount/total | Not run |
| 16 | Editing/deleting paid items is rejected | Commerce database test verifies trigger rejection | Not run |
| 17 | Refund changes status but does not restock; repeated refund is idempotent | Commerce database test verifies order/payment statuses and stock | Not run |
| 18 | Supabase REST/Data API cannot read/write locked-down Commerce objects | Migration test verifies role grants; public-key REST request is manual | Not run |
| 19 | Page guards redirect wrong-role/unauthenticated users | Existing auth unit coverage; live browser path is manual | Not run |
| 20 | Client-supplied membership price cannot override plan price | Commerce database test sends price_paid=0 and verifies plan price snapshot | Not run |
| 21 | Quantity-only update preserves original snack price | Commerce database test changes current snack price then updates quantity | Not run |
| 22 | Empty order cannot become paid | Commerce database test verifies payment trigger rejection | Not run |
| 23 | Order with line items cannot be hard-deleted | Commerce database test verifies RESTRICT foreign key | Not run |

## Suggested manual role matrix run

1. Sign in as Admin; create a plan, customer and snack; assign a membership; create an order; record cash/demo payment; confirm stock falls exactly once; refund it and confirm stock does not rise.
2. Sign in as Staff; manage snack price/stock, assign a membership, create an order and record payment/refund. Confirm plan creation is forbidden.
3. Sign in as Customer A; edit name/phone, view only their own membership/order history, create and cancel a pending order. Confirm customer B's ID cannot be used to read/update customer B.
4. Sign out; replay the old protected API request/cookies and confirm the request is rejected.
5. With only the Supabase publishable key, attempt REST reads/writes against the commerce tables/views and confirm access is denied.

Record date, role, steps, expected and actual result, pass/fail, and a screenshot under `docs/screenshots/commerce-auth/` for each browser scenario. Do not enter real payment credentials.
