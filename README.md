# Granite Marketplace API

Backend API module for a Brazil-only premium portfolio allocation marketplace.

## Stack

- Node.js + TypeScript
- PostgreSQL
- Drizzle ORM
- REST API
- Simulated PIX escrow gateway

## First run

1. Copy environment file:

   ```bash
   cp .env.example .env
   ```

2. Edit `.env` with your database credentials:

   ```env
   DATABASE_URL=postgres://postgres:postgres@localhost:5432/granite
   PORT=3000
   ```

3. Ensure PostgreSQL database exists:

   ```bash
   createdb granite
   ```

4. Bootstrap everything:

   ```bash
   npm run setup
   ```

5. Start the API:

   ```bash
   npm run dev
   ```

## Scripts

- `npm run setup` → install + migrate + build
- `npm run dev` → run API in development mode
- `npm run build` → TypeScript compile
- `npm run start` → run compiled API
- `npm run db:migrate` → apply pending migrations
- `npm run db:rollback` → rollback last migration
- `npm run test` → run tests with coverage
- `npm run lint` → lint codebase
- `npm run lint:fix` → lint and auto-fix

## API Endpoints

- `POST /executive/slot`
- `POST /slot/:id/bid`
- `POST /auction/close/:slotId`
- `POST /contract/:id/complete`

## cURL examples

Assuming API is running at `http://localhost:3000`.

### 1) Executive creates slot

```bash
curl -X POST http://localhost:3000/executive/slot \
   -H "Content-Type: application/json" \
   -H "x-user-id: EXECUTIVE_USER_ID" \
   -H "x-user-role: EXECUTIVE" \
   -d '{
      "tier": "7_DAYS",
      "category": "backend",
      "reservePrice": 100000,
      "categories": ["backend", "nodejs"]
   }'
```

### 2) Owner places sealed bid

```bash
curl -X POST http://localhost:3000/slot/SLOT_ID/bid \
   -H "Content-Type: application/json" \
   -H "x-user-id: OWNER_USER_ID" \
   -H "x-user-role: OWNER" \
   -d '{
      "amount": 150000
   }'
```

### 3) Close auction after 24h

```bash
curl -X POST http://localhost:3000/auction/close/SLOT_ID
```

### 4) Executive marks contract complete before deadline

```bash
curl -X POST http://localhost:3000/contract/CONTRACT_ID/complete \
   -H "x-user-id: EXECUTIVE_USER_ID" \
   -H "x-user-role: EXECUTIVE"
```

Auth is currently stubbed via headers:

- `x-user-id`
- `x-user-role` (`EXECUTIVE` | `OWNER`)

## Troubleshooting

### PostgreSQL connection errors

- Confirm PostgreSQL service is running.
- Confirm `.env` has a valid `DATABASE_URL`.
- Confirm target DB exists (`createdb granite`).
- Test DB connectivity quickly:

  ```bash
  psql "$DATABASE_URL" -c "select 1;"
  ```

### Migration issues

- Run pending migrations manually:

  ```bash
  npm run db:migrate
  ```

- Rollback last migration:

  ```bash
  npm run db:rollback
  ```

### Port already in use

- Change `PORT` in `.env`, then restart `npm run dev`.
