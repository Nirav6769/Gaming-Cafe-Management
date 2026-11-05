# Operations module

## Scope
The Operations module provides role-guarded PC inventory, reservations, gaming sessions and billing, maintenance tracking, and games-played records.

## Access
- Admin and staff can create/manage PCs' operational records, reservations, sessions, maintenance and games-played entries.
- Customers can read their own reservations and session-games records through the APIs that explicitly scope by the verified profile's customer ID.
- All API routes use `requireApiRole`; the page uses `requirePageRole`. Never trust role or customer ownership values from browser input.

## Database migration
Apply `database/migrations/003_operations.sql` after `001_auth_foundation.sql`. It adds a GiST exclusion constraint for overlapping confirmed reservations on the same PC, cross-checking triggers against sessions, billing snapshots, PC status synchronization, a maintenance surrogate key, and session-games duration metadata. It enables RLS and revokes direct Data API grants on the new reservations table.

## Routes
- `GET/POST /api/reservations`; staff/admin create, customers list only their own reservations.
- `PATCH /api/reservations/[reservationId]`; staff/admin cancel or complete.
- `GET/POST /api/maintenance`; staff/admin list and log issues.
- `PATCH /api/maintenance/[maintenanceId]`; resolve an open issue.
- `GET/POST /api/sessions/[sessionId]/games`; staff/admin write, customer reads only games from own session.
- Existing `/api/pcs` and `/api/sessions` remain the current MVP endpoints; the UI is integrated as a separate protected `/operations` route.

## Billing and status
The database trigger snapshots the PC hourly rate when a session is created and calculates the final bill when `end_time` is set. PC status is synchronized from active maintenance and active sessions, with maintenance taking precedence over occupied, then available.

## Conflict rules
Confirmed reservations for the same PC cannot overlap. Reservation writes check existing sessions, and session writes check confirmed reservations. Intervals use half-open semantics so one booking can start exactly when another ends.

## Verification
Run `npm run lint`, `npm test`, and `npm run build`. Apply the migration to a disposable database first. Record actual test and migration outcomes; do not report skipped database tests as passed.
