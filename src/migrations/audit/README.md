# Audit DB Migrations

TypeORM migrations for the dedicated `medipulse_audit` database.

Audit DB contains append-only tables:
- `audit_events` — every HTTP mutation
- `read_access_logs` — sensitive read endpoints
- `keycloak_auth_events` — KC login/logout
- `domain_event_logs` — all domain events
- `recommendation_decision_traces` — AI explainability

Run: `npm run migration:generate:audit` and `npm run migration:run:audit`
