# Granite Marketplace API

A marketplace backend where executives offer their portfolio through one time-availability slot, owners place escrow-backed sealed bids, and the app auto-resolves contracts using 24h auction rules.

## Stack

- Node.js + TypeScript
- PostgreSQL
- Drizzle ORM
- REST API
- PIX escrow gateway (`sim` or `native` mode)

## Architecture

![Granite architecture](./architecture.png)

## Platform philosophy

### 1️⃣ Deterministic Portfolio Access

The module enforces automatic, portfolio-first, rule-driven behavior:

- Executives expose portfolio access through one availability slot at a time.
- Owners bid for that access, but the engine decides the outcome.
- No negotiation, no arbitration, no subjective interference.

Philosophical implication:
Value, Fairness, and trust emerge from the system structure, not human judgment.

### 2️⃣ Scarcity as Value Signal

- Only one slot per executive.
- Invite-only executives.
- Tight category clusters.

Module enforcement: `POST /executive/slot` + one-slot check.

Implication:
Every availability slot tied to an executive portfolio is a premium, rare opportunity. Scarcity drives perceived value and naturally enforces price appreciation.

### 3️⃣ Market-Determined Pricing

- Executives set private reserves.
- Vickrey clearing sets final price.
- Bids below reserve are ignored; highest valid bid wins at second-highest price.

Module enforcement: `POST /auction/close/:slotId` + reserve and clearing logic.

Implication:
Price is not imposed; the system discovers it. Executives protect time value, owners pay market-clearing value. Neutral, fair, market-driven.

### 4️⃣ Binary Enforcement & Risk Containment

- Completion outcomes are binary: `COMPLETED` or `BREACH`.
- Automatic contract lifecycle.
- Escrow handles funds deterministically.
- 12% platform fee is deducted only on successful completion.

Module enforcement: `POST /contract/:id/complete` + CRON checks for deadlines.

Implication:
Subjective evaluation is removed, disputes are minimized, and risk assignment is explicit. Outcomes stay predictable for all parties.

### 5️⃣ Transparency Through Structure, Not Price

- Portfolio and profile metadata are visible.
- Bid and price history are not publicly exposed.
- Reserve price remains private.

Module enforcement: API design hides sensitive fields and enforces immutable state transitions.

Implication:
Honest bidding is encouraged, reputation is protected, and premium perception is preserved. Behavioral friction replaces manual policing.

### 6️⃣ Minimal Platform Intervention

- Platform facilitates escrow and enforces rules.
- Platform does not arbitrate, negotiate, or mediate.
- Role-based access keeps separation of powers.

Module enforcement: API enforces state changes and prevents manual overrides.

Implication:
Platform acts as trusted infrastructure, not a middleman deciding value or outcomes. Trust emerges from deterministic logic.

## First run

### Quickstart (sim mode)

1. Copy environment file:

   ```bash
   cp .env.example .env
   ```

2. Edit `.env` based on `.env.example` (single source of truth for all variables).

   Minimum local setup:

   - Keep `PIX_GATEWAY_MODE=sim` to avoid external payment calls.
   - Set `DATABASE_URL` to your PostgreSQL instance.
   - Optionally tune rate limit via `RATE_LIMIT_MAX_REQUESTS` and `RATE_LIMIT_WINDOW_MS`.

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

### Advanced (native Pix and Stripe provider)

#### PIX gateway mode

- `PIX_GATEWAY_MODE=sim` (default): no external payment calls; useful for local development/tests.
- `PIX_GATEWAY_MODE=native`: enables real HTTP calls to a provider endpoint.
- In `native` mode, `PIX_GATEWAY_BASE_URL` and `PIX_GATEWAY_API_KEY` are required.
- Each escrow operation is sent with `x-idempotency-key` based on the bid/contract reference.

#### How to obtain the keys

For this repository setup, you need 3 keys when running native mode with the included Stripe provider service:

- `PIX_GATEWAY_API_KEY` (used by Granite to call your provider service)
- `STRIPE_PROVIDER_API_KEY` (used by the provider service to authenticate Granite)
- `STRIPE_SECRET_KEY` (used by the provider service to call Stripe APIs)

1) Create the internal provider API key (shared secret)

- Generate a strong random token locally:

```bash
openssl rand -hex 32
```

- Use the same generated value in both vars:
   - `PIX_GATEWAY_API_KEY=<generated_token>`
   - `STRIPE_PROVIDER_API_KEY=<generated_token>`

2) Get the Stripe secret key

- Open Stripe Dashboard.
- Enable test mode.
- Go to Developers → API keys.
- Copy the Secret key (`sk_test_...`) and set:
   - `STRIPE_SECRET_KEY=sk_test_...`

3) Move to production safely (later)

- In live mode, use `sk_live_...` from the same API keys page.
- Prefer restricted keys for this provider service when possible.
- Rotate keys if exposed and never commit them to git.

#### Native provider contract (expected by Granite)

When `PIX_GATEWAY_MODE=native`, Granite performs `POST` calls with:

- `Authorization: Bearer <PIX_GATEWAY_API_KEY>`
- `Content-Type: application/json`
- `x-idempotency-key: <referenceId>:<operation>`

Success expectation:

- Any `2xx` status is treated as success.

Error expectation:

- Any non-`2xx` status is treated as failure.
- Granite tries to parse JSON body as `{ "error": "..." }` or `{ "message": "..." }`.

#### 1) Lock funds

Endpoint path: `PIX_GATEWAY_LOCK_PATH` (default `/escrow/pix/lock`)

Request body:

```json
{
   "referenceId": "BID_ID",
   "ownerId": "OWNER_USER_ID",
   "amount": 150000
}
```

Example success response:

```json
{
   "status": "locked",
   "providerReference": "pix_lock_123"
}
```

#### 2) Refund owner

Endpoint path: `PIX_GATEWAY_REFUND_PATH` (default `/escrow/pix/refund`)

Request body:

```json
{
   "referenceId": "BID_ID",
   "ownerId": "OWNER_USER_ID",
   "amount": 150000
}
```

Example success response:

```json
{
   "status": "refunded",
   "providerReference": "pix_refund_123"
}
```

#### 3) Release to executive

Endpoint path: `PIX_GATEWAY_RELEASE_PATH` (default `/escrow/pix/release`)

Request body:

```json
{
   "referenceId": "CONTRACT_ID",
   "executiveId": "EXECUTIVE_USER_ID",
   "netAmount": 132000,
   "platformFee": 18000
}
```

Example success response:

```json
{
   "status": "released",
   "providerReference": "pix_release_123"
}
```

#### Stripe mapping (practical adapter guide)

Use this only as an adapter behind Granite's existing native contract.

- Granite keeps calling `lock/refund/release`.
- Your provider service translates those calls to Stripe APIs.

Suggested mapping:

#### `lockFunds` → create + confirm PaymentIntent (Pix)

- Input from Granite:

```json
{
   "referenceId": "BID_ID",
   "ownerId": "OWNER_USER_ID",
   "amount": 150000
}
```

- Stripe-side intent:
  - Create `PaymentIntent` with `amount`, `currency=brl`, `payment_method_types=["pix"]`.
  - Set idempotency key as `BID_ID:lock`.
  - Store `metadata.referenceId=BID_ID` and `metadata.ownerId=OWNER_USER_ID`.
- Return `2xx` to Granite only after payment is effectively confirmed by your integration flow.

#### `refundToOwner` → refund Pix charge/payment

- Input from Granite:

```json
{
   "referenceId": "BID_ID",
   "ownerId": "OWNER_USER_ID",
   "amount": 150000
}
```

- Stripe-side intent:
  - Locate payment by `metadata.referenceId=BID_ID`.
  - Create refund for `amount`.
  - Use idempotency key `BID_ID:refund`.
- Return `2xx` when refund request is accepted/processed in your integration policy.

#### `releaseToExecutive` → transfer to connected account

- Input from Granite:

```json
{
   "referenceId": "CONTRACT_ID",
   "executiveId": "EXECUTIVE_USER_ID",
   "netAmount": 132000,
   "platformFee": 18000
}
```

- Stripe-side intent:
  - Resolve `executiveId` to a Stripe Connected Account.
  - Create `Transfer` for `netAmount` to connected account.
  - Keep `platformFee` in platform balance (already represented by Granite values).
  - Use idempotency key `CONTRACT_ID:release`.
- Return `2xx` when transfer is created successfully.

Operational notes:

- Granite currently expects synchronous success/failure per call.
- If your Stripe flow is asynchronous, keep the async orchestration in the provider service and respond to Granite only when final state is known.
- Maintain a local reconciliation table in the provider service (`referenceId`, Stripe IDs, status, last error) for auditability.

#### Stripe provider service skeleton (included)

This repository includes a standalone provider service at `scripts/stripeProviderService.ts` with:

- `POST /escrow/pix/lock`
- `POST /escrow/pix/refund`
- `POST /escrow/pix/release`
- `GET /health`

Run it:

```bash
STRIPE_PROVIDER_API_KEY=provider-token \
STRIPE_SECRET_KEY=sk_test_xxx \
STRIPE_PROVIDER_PORT=4010 \
STRIPE_PROVIDER_TIMEOUT_MS=10000 \
STRIPE_EXECUTIVE_ACCOUNT_MAP='{"EXECUTIVE_USER_ID":"acct_123"}' \
npm run provider:dev
```

Then point Granite API to it:

```env
PIX_GATEWAY_MODE=native
PIX_GATEWAY_BASE_URL=http://localhost:4010
PIX_GATEWAY_API_KEY=provider-token
```

Notes:

- `STRIPE_EXECUTIVE_ACCOUNT_MAP` maps Granite `executiveId` to Stripe connected account IDs.
- The skeleton keeps lock reference mapping in memory for refunds; restarting the provider clears that map.

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
- `GET /health`
- `GET /ready`

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
