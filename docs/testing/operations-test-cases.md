# Operations test cases

Use a disposable database with the baseline schema, seed data, auth migration and operations migration applied.

1. **Reservation overlap:** create a confirmed reservation; a second overlapping reservation for the same PC must fail; a reservation on another PC must succeed; adjacent half-open intervals must succeed.
2. **Session conflict:** an active session must prevent an overlapping reservation; a confirmed reservation must prevent a conflicting session; a session linked to its own reservation may start within that reservation.
3. **Session billing:** create a session, change the PC hourly rate, end the session and verify billing uses the original hourly-rate snapshot and rounds to two decimals.
4. **PC status:** starting a session changes PC to occupied; ending it returns to available unless open maintenance exists; open maintenance forces maintenance status; resolving the final open maintenance restores occupied if a session remains active, otherwise available.
5. **Maintenance history:** existing maintenance rows survive the migration; new records receive unique maintenance IDs; resolving sets resolved_at; deleting a referenced PC is restricted.
6. **Session games:** staff/admin can add a game and duration to an active session; duplicate session/game updates duration; customers can read only their own session games; completed sessions reject writes.
7. **Authorization:** unauthenticated requests return 401; customer write attempts return 403; customer list/read endpoints are scoped to the authenticated profile.
8. **Input validation:** invalid IDs, date ranges, negative durations and oversized descriptions return 400.
9. **Regression:** existing dashboard, customers, games, PC and session MVP routes still work with admin/staff accounts.

Record actual outcomes, environment, migration timestamp and commit SHA after running tests. Do not mark a test passed without executing it.
