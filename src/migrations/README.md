# MediPulse Database Migrations

TypeORM migrations for the main `medipulse` database.

## Why synchronize:false everywhere

`synchronize:true` will silently:
- Alter column types (can truncate data)
- Drop columns renamed in entities
- Has NO rollback if something goes wrong

For a healthcare system handling pharmacy inventory, this is unacceptable.
Every schema change is now a reviewable, reversible, explicit migration.

---

## Workflow

### 1. After changing any entity file

```bash
# Generate a migration (auto-diffs entity vs actual DB schema)
npm run migration:generate -- src/migrations/AddOrderCommentTable

# Review the generated file in src/migrations/
# Then apply it:
npm run migration:run

# Verify
npm run migration:show
```

### 2. Roll back if something went wrong

```bash
npm run migration:revert
```

### 3. Audit DB migrations

```bash
npm run migration:generate:audit -- src/migrations/audit/AddDomainEventLog
npm run migration:run:audit
npm run migration:revert:audit
```

---

## Before first production deployment

Run this ONCE on your production RDS instance to create the initial schema
from the full entity set (instead of many individual migrations):

```bash
# Point DATABASE_URL at prod RDS
DATABASE_URL=postgresql://... npm run migration:run
DATABASE_URL=postgresql://... npm run migration:run:audit
```

**Never run `synchronize:true` on production. Never.**

---

## Naming convention

`src/migrations/YYYYMMDDHHMMSS-DescriptiveName.ts`

TypeORM auto-generates the timestamp prefix. Use descriptive suffixes:
- `AddOrderCommentTable`
- `AddProductBatchEntity`
- `AddQuantityAcceptedToOrderItems`
- `AddHijriSeasonalityFields`
