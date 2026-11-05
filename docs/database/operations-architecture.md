# Operations architecture

```mermaid
flowchart TD
  UI[Operations page] --> API[Next.js API routes]
  API --> AUTH[Supabase Auth getUser]
  AUTH --> PROFILE[user_profiles role mapping]
  API --> PG[Server PostgreSQL pool]
  PG --> RES[Reservations + GiST exclusion]
  PG --> SES[Gaming sessions + billing trigger]
  PG --> MAIN[Maintenance records]
  PG --> PC[PC status synchronization]
  PG --> SG[Session games]
```

Supabase Auth authenticates identity. The server loads the matching `user_profiles` record and applies role guards. The server-only PostgreSQL pool performs application data access. Database constraints and triggers enforce reservation/session conflicts, billing snapshots and PC status synchronization independently of UI behavior.
