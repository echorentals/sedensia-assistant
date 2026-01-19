# Phase 2: QuickBooks Integration - Design Document

**Status:** Implemented ✅

## Overview

Phase 2 adds QuickBooks estimate creation with AI-powered pricing suggestions based on historical data.

**Core Flow:**
```
Email arrives → AI parses → AI suggests pricing based on history
     ↓
Telegram shows: items, suggested prices, confidence levels
     ↓
User: Approve / Edit prices / Reject
     ↓
If approved → Creates estimate in QuickBooks
     ↓
Records outcome (win/lose) to improve future pricing
```

## Architecture

### New Components

```
src/modules/quickbooks/
├── tokens.ts      # OAuth token management (like Gmail)
├── client.ts      # QuickBooks API client
├── estimates.ts   # Create/read estimates
├── import.ts      # Historical data import
└── index.ts

src/modules/pricing/
├── engine.ts      # Pricing calculation logic
├── history.ts     # Query pricing history
└── index.ts

src/db/
├── estimates.ts   # Estimates repository
├── sign-types.ts  # Sign types catalog
└── pricing.ts     # Pricing history queries
```

### Routes

- `GET /auth/quickbooks/authorize` - Initiate OAuth
- `GET /auth/quickbooks/callback` - OAuth callback
- `POST /setup/quickbooks/import` - Import historical estimates
- `GET /api/estimates/:id` - Get estimate details

## Data Model

### New Tables

```sql
-- Sign types catalog with base pricing formulas
CREATE TABLE sign_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  category TEXT,
  base_price_per_sqft DECIMAL(10,2),
  min_price DECIMAL(10,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Materials with price multipliers
CREATE TABLE materials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  price_multiplier DECIMAL(4,2) DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Historical pricing from past jobs
CREATE TABLE pricing_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sign_type_id UUID REFERENCES sign_types(id),
  material_id UUID REFERENCES materials(id),
  width_inches DECIMAL(8,2),
  height_inches DECIMAL(8,2),
  sqft DECIMAL(10,2) GENERATED ALWAYS AS (width_inches * height_inches / 144) STORED,
  quantity INTEGER DEFAULT 1,
  quoted_price DECIMAL(10,2) NOT NULL,
  final_price DECIMAL(10,2),
  outcome TEXT CHECK (outcome IN ('won', 'lost', 'pending')) DEFAULT 'pending',
  quickbooks_estimate_id TEXT,
  contact_id UUID REFERENCES contacts(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Estimates we create
CREATE TABLE estimates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID REFERENCES contacts(id),
  gmail_message_id TEXT,
  quickbooks_estimate_id TEXT,
  quickbooks_doc_number TEXT,
  status TEXT CHECK (status IN ('draft', 'sent', 'won', 'lost', 'expired')) DEFAULT 'draft',
  total_amount DECIMAL(10,2),
  items JSONB NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_pricing_history_sign_type ON pricing_history(sign_type_id);
CREATE INDEX idx_pricing_history_sqft ON pricing_history(sqft);
CREATE INDEX idx_pricing_history_outcome ON pricing_history(outcome);
CREATE INDEX idx_estimates_status ON estimates(status);
CREATE INDEX idx_estimates_contact ON estimates(contact_id);
```

## QuickBooks Integration

### OAuth Flow

Same pattern as Gmail:
- Encrypted tokens stored in `oauth_tokens` table
- `realm_id` identifies the QuickBooks company
- Automatic token refresh before expiration

### API Operations

1. **Read estimates** - Import historical data for pricing
2. **Read invoices** - Get outcome data (won jobs)
3. **Create estimate** - When user approves in Telegram
4. **Read customers** - Match contacts to QuickBooks customers

### Estimate Creation

```typescript
interface QuickBooksEstimate {
  CustomerRef: { value: string };  // QuickBooks customer ID
  Line: Array<{
    DetailType: 'SalesItemLineDetail';
    Amount: number;
    Description: string;
    SalesItemLineDetail: {
      Qty: number;
      UnitPrice: number;
    };
  }>;
  TotalAmt: number;
  EmailStatus: 'NotSent';
}
```

## Pricing Engine

### Algorithm

1. **AI parses email** → extracts sign type, size, material, quantity

2. **Query pricing history:**
   - Find similar past jobs (same sign type, similar size ±30%)
   - Calculate average price per sqft
   - Track win rate for confidence

3. **Calculate suggested price:**
   ```
   base = sqft × avg_historical_price_per_sqft

   if win_rate > 70%: adjust +10% (room for margin)
   if win_rate < 40%: adjust -10% (need competitiveness)

   final = base × material_multiplier
   ```

4. **Confidence levels:**
   - High: 10+ similar past jobs
   - Medium: 3-9 similar jobs
   - Low: <3 jobs (falls back to base formula from sign_types table)

### Pricing Query

```sql
SELECT
  AVG(quoted_price / sqft) as avg_price_per_sqft,
  COUNT(*) as sample_size,
  SUM(CASE WHEN outcome = 'won' THEN 1 ELSE 0 END)::float / COUNT(*) as win_rate
FROM pricing_history
WHERE sign_type_id = $1
  AND material_id = $2
  AND sqft BETWEEN ($3 * 0.7) AND ($3 * 1.3)
  AND outcome != 'pending';
```

## Telegram Workflow

### Estimate Notification

```
📋 New Estimate Request
From: Minseok Kim (Samsung Taylor)

1. Channel Letters 24"x36" (Aluminum)
   Suggested: $1,450 ⭐ High confidence
   (12 similar jobs, 75% win rate)

2. Monument Sign 48"x72" (Aluminum)
   Suggested: $3,200 ⚠️ Low confidence
   (2 similar jobs)

Total: $4,650

[✓ Approve] [✏️ Edit] [✗ Reject]
```

### Edit Flow

1. User taps [Edit]
2. Bot: "Which item? [1] [2] [Cancel]"
3. User taps [1]
4. Bot: "Channel Letters - Current: $1,450. Reply with new price:"
5. User replies: "1600"
6. Bot: "Updated to $1,600. [Save & Approve] [Edit Another] [Cancel]"

### Outcome Tracking

Commands:
- `/won <estimate_id>` - Mark as won, updates pricing_history
- `/lost <estimate_id>` - Mark as lost, updates pricing_history
- `/estimates` - List recent pending estimates

## Implementation Phases

### Phase 2A - QuickBooks Foundation
1. Add QuickBooks environment variables
2. QuickBooks OAuth token management
3. QuickBooks API client
4. Database migrations
5. QuickBooks OAuth routes
6. Historical estimate import

### Phase 2B - Pricing Engine
7. Sign type detection from descriptions
8. Pricing history queries
9. Price suggestion algorithm
10. Enhance AI parser with pricing

### Phase 2C - Telegram Workflow
11. Enhanced estimate notifications
12. Inline editing via callbacks
13. Approve → create estimate flow
14. Win/lose tracking commands

## Environment Variables

Add to `.env.example`:
```bash
# QuickBooks OAuth
QUICKBOOKS_CLIENT_ID=xxx
QUICKBOOKS_CLIENT_SECRET=xxx
QUICKBOOKS_REDIRECT_URI=http://localhost:3000/auth/quickbooks/callback
QUICKBOOKS_ENVIRONMENT=sandbox  # or 'production'
```

## Success Criteria

Phase 2 is complete when:
- [x] QuickBooks OAuth flow works
- [x] Historical estimates imported and parsed
- [x] Telegram shows suggested prices with confidence
- [x] User can edit prices inline in Telegram
- [x] Approve creates estimate in QuickBooks
- [x] Win/lose tracking updates pricing history
- [x] Pricing suggestions improve with more data

## Dependencies

- QuickBooks Developer account
- OAuth app in Intuit Developer portal
- Sandbox company for testing
