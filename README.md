# Granite Marketplace API

A marketplace backend where executives offer one timed slot, and owners place escrow-backed sealed bids, and the app auto-resolves contracts using 24h auction rules.

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

## Real-time updates (cobid-style)

The API now exposes a WebSocket endpoint on the same host/port as HTTP.

- URL: `ws://localhost:3000`

On connect, server sends:

```json
{
   "type": "snapshot",
   "payload": {
      "connectedAt": "2026-02-15T16:30:00.000Z"
   }
}
```

When a bid is created (`POST /slot/:id/bid`), server broadcasts:

```json
{
   "type": "bidCreated",
   "payload": {
      "id": "BID_ID",
      "slotId": "SLOT_ID",
      "ownerId": "OWNER_ID",
      "amount": 150000,
      "escrowStatus": "LOCKED",
      "createdAt": "2026-02-15T16:30:00.000Z"
   }
}
```

When auction closes (`POST /auction/close/:slotId` or cron), server broadcasts:

```json
{
   "type": "auctionClosed",
   "payload": {
      "slotId": "SLOT_ID",
      "status": "VOID"
   }
}
```

or

```json
{
   "type": "auctionClosed",
   "payload": {
      "slotId": "SLOT_ID",
      "status": "IN_PROGRESS",
      "contractId": "CONTRACT_ID",
      "winningBidId": "BID_ID",
      "clearingPrice": 120000
   }
}
```

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
