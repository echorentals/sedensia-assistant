# Phase 2: QuickBooks Integration - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add QuickBooks estimate creation with AI-powered pricing suggestions based on historical win/lose data.

**Architecture:** QuickBooks OAuth stores encrypted tokens (like Gmail). Historical estimates are imported and parsed to build pricing intelligence. Telegram workflow allows approve/edit/reject with inline price editing. Approved estimates are created in QuickBooks and tracked for outcome.

**Tech Stack:** TypeScript, node-quickbooks (or raw API), Supabase, Telegraf callbacks, existing AI parser

---

## Prerequisites

Before starting:
1. QuickBooks Developer account at developer.intuit.com
2. OAuth app created with redirect URI (use ngrok if localhost fails)
3. Sandbox company created for testing
4. Client ID and Client Secret from the app dashboard

---

## Task 1: Add QuickBooks Environment Variables

**Files:**
- Modify: `src/config/env.ts`
- Modify: `.env.example`

**Step 1: Update .env.example**

Add to `.env.example`:
```bash
# QuickBooks OAuth
QUICKBOOKS_CLIENT_ID=xxx
QUICKBOOKS_CLIENT_SECRET=xxx
QUICKBOOKS_REDIRECT_URI=http://localhost:3000/auth/quickbooks/callback
QUICKBOOKS_ENVIRONMENT=sandbox
```

**Step 2: Update env.ts schema**

Add to `src/config/env.ts` in the `envSchema` object:
```typescript
QUICKBOOKS_CLIENT_ID: z.string().min(1),
QUICKBOOKS_CLIENT_SECRET: z.string().min(1),
QUICKBOOKS_REDIRECT_URI: z.string().url(),
QUICKBOOKS_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
```

**Step 3: Update your .env file**

Add your actual QuickBooks credentials to `.env`.

**Step 4: Verify build passes**

Run: `npm run build`
Expected: Success (will fail at runtime if env vars missing)

**Step 5: Commit**

```bash
git add src/config/env.ts .env.example
git commit -m "feat: add QuickBooks environment variables"
```

---

## Task 2: Database Migrations for Phase 2

**Files:**
- Create: `supabase/migrations/003_phase2_tables.sql`

**Step 1: Create migration file**

Create `supabase/migrations/003_phase2_tables.sql`:
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
  description TEXT,
  width_inches DECIMAL(8,2),
  height_inches DECIMAL(8,2),
  quantity INTEGER DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL,
  total_price DECIMAL(10,2) NOT NULL,
  outcome TEXT CHECK (outcome IN ('won', 'lost', 'pending')) DEFAULT 'pending',
  quickbooks_estimate_id TEXT,
  quickbooks_invoice_id TEXT,
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
  quickbooks_customer_id TEXT,
  status TEXT CHECK (status IN ('draft', 'sent', 'won', 'lost', 'expired')) DEFAULT 'draft',
  total_amount DECIMAL(10,2),
  items JSONB NOT NULL DEFAULT '[]',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_pricing_history_sign_type ON pricing_history(sign_type_id);
CREATE INDEX idx_pricing_history_outcome ON pricing_history(outcome);
CREATE INDEX idx_estimates_status ON estimates(status);
CREATE INDEX idx_estimates_contact ON estimates(contact_id);
CREATE INDEX idx_estimates_qb_id ON estimates(quickbooks_estimate_id);

-- Seed common sign types
INSERT INTO sign_types (name, category, base_price_per_sqft, min_price) VALUES
  ('Channel Letters', 'Illuminated', 45.00, 500),
  ('Monument Sign', 'Ground', 35.00, 1500),
  ('Pylon Sign', 'Ground', 40.00, 3000),
  ('Wall Sign', 'Flat', 25.00, 300),
  ('Wayfinding Sign', 'Directional', 20.00, 150),
  ('ADA Sign', 'Compliance', 15.00, 75),
  ('Vinyl Graphics', 'Flat', 12.00, 100),
  ('Vehicle Wrap', 'Vehicle', 18.00, 500),
  ('Banner', 'Temporary', 8.00, 50),
  ('A-Frame', 'Portable', 0, 150);

-- Seed common materials
INSERT INTO materials (name, price_multiplier) VALUES
  ('Aluminum', 1.0),
  ('Acrylic', 1.1),
  ('Dibond', 0.9),
  ('PVC', 0.8),
  ('Coroplast', 0.5),
  ('HDU (High Density Urethane)', 1.3),
  ('Stainless Steel', 1.5),
  ('Bronze', 2.0),
  ('LED Module', 1.2),
  ('Neon', 1.4);
```

**Step 2: Apply migration via Supabase MCP**

Use the Supabase MCP tool to apply the migration.

**Step 3: Verify tables created**

Query to verify: `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';`

**Step 4: Commit**

```bash
git add supabase/migrations/003_phase2_tables.sql
git commit -m "feat: add database tables for Phase 2 (sign_types, materials, pricing_history, estimates)"
```

---

## Task 3: QuickBooks Token Management

**Files:**
- Create: `src/modules/quickbooks/tokens.ts`
- Create: `src/modules/quickbooks/tokens.test.ts`

**Step 1: Write failing test**

Create `src/modules/quickbooks/tokens.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/index.js', () => ({
  env: {
    ENCRYPTION_KEY: 'a'.repeat(64),
    QUICKBOOKS_CLIENT_ID: 'test-client-id',
    QUICKBOOKS_CLIENT_SECRET: 'test-client-secret',
    QUICKBOOKS_REDIRECT_URI: 'http://localhost:3000/auth/quickbooks/callback',
    QUICKBOOKS_ENVIRONMENT: 'sandbox',
  },
}));

vi.mock('../../db/index.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
      })),
      upsert: vi.fn(() => Promise.resolve({ data: null, error: null })),
    })),
  },
}));

describe('quickbooks tokens', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('exports getQuickBooksTokens and saveQuickBooksTokens', async () => {
    const tokens = await import('./tokens.js');
    expect(tokens.getQuickBooksTokens).toBeDefined();
    expect(tokens.saveQuickBooksTokens).toBeDefined();
  });

  it('getQuickBooksTokens returns null when no tokens exist', async () => {
    const { getQuickBooksTokens } = await import('./tokens.js');
    const result = await getQuickBooksTokens();
    expect(result).toBeNull();
  });

  it('isTokenExpired returns true for expired token', async () => {
    const { isTokenExpired } = await import('./tokens.js');
    const pastDate = new Date(Date.now() - 3600 * 1000);
    expect(isTokenExpired(pastDate)).toBe(true);
  });

  it('isTokenExpired returns false for valid token', async () => {
    const { isTokenExpired } = await import('./tokens.js');
    const futureDate = new Date(Date.now() + 3600 * 1000);
    expect(isTokenExpired(futureDate)).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/modules/quickbooks/tokens.test.ts`
Expected: FAIL (module not found)

**Step 3: Create tokens.ts**

Create `src/modules/quickbooks/tokens.ts`:
```typescript
import { supabase } from '../../db/index.js';
import { encrypt, decrypt } from '../../utils/encryption.js';

export interface QuickBooksTokens {
  accessToken: string;
  refreshToken: string;
  realmId: string;
  expiresAt: Date;
}

export async function getQuickBooksTokens(): Promise<QuickBooksTokens | null> {
  const { data, error } = await supabase
    .from('oauth_tokens')
    .select('*')
    .eq('provider', 'quickbooks')
    .single();

  if (error || !data) {
    return null;
  }

  return {
    accessToken: decrypt(data.access_token),
    refreshToken: decrypt(data.refresh_token),
    realmId: data.realm_id,
    expiresAt: new Date(data.expires_at),
  };
}

export async function saveQuickBooksTokens(tokens: QuickBooksTokens): Promise<void> {
  const { error } = await supabase
    .from('oauth_tokens')
    .upsert({
      provider: 'quickbooks',
      access_token: encrypt(tokens.accessToken),
      refresh_token: encrypt(tokens.refreshToken),
      realm_id: tokens.realmId,
      expires_at: tokens.expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'provider,realm_id',
    });

  if (error) {
    throw new Error(`Failed to save QuickBooks tokens: ${error.message}`);
  }
}

export function isTokenExpired(expiresAt: Date, bufferMinutes = 5): boolean {
  const bufferMs = bufferMinutes * 60 * 1000;
  return new Date(Date.now() + bufferMs) >= expiresAt;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/modules/quickbooks/tokens.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/modules/quickbooks/tokens.ts src/modules/quickbooks/tokens.test.ts
git commit -m "feat: add QuickBooks token management with encryption"
```

---

## Task 4: QuickBooks OAuth Client

**Files:**
- Create: `src/modules/quickbooks/auth.ts`
- Create: `src/modules/quickbooks/auth.test.ts`

**Step 1: Write failing test**

Create `src/modules/quickbooks/auth.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/index.js', () => ({
  env: {
    QUICKBOOKS_CLIENT_ID: 'test-client-id',
    QUICKBOOKS_CLIENT_SECRET: 'test-client-secret',
    QUICKBOOKS_REDIRECT_URI: 'http://localhost:3000/auth/quickbooks/callback',
    QUICKBOOKS_ENVIRONMENT: 'sandbox',
  },
}));

describe('quickbooks auth', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('exports getAuthUrl function', async () => {
    const auth = await import('./auth.js');
    expect(auth.getAuthUrl).toBeDefined();
    expect(typeof auth.getAuthUrl).toBe('function');
  });

  it('getAuthUrl returns a valid Intuit OAuth URL', async () => {
    const { getAuthUrl } = await import('./auth.js');
    const url = getAuthUrl();
    expect(url).toContain('https://appcenter.intuit.com/connect/oauth2');
    expect(url).toContain('client_id=test-client-id');
    expect(url).toContain('redirect_uri=');
    expect(url).toContain('scope=');
  });

  it('getAuthUrl includes accounting scope', async () => {
    const { getAuthUrl } = await import('./auth.js');
    const url = getAuthUrl();
    expect(url).toContain('com.intuit.quickbooks.accounting');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/modules/quickbooks/auth.test.ts`
Expected: FAIL (module not found)

**Step 3: Create auth.ts**

Create `src/modules/quickbooks/auth.ts`:
```typescript
import { env } from '../../config/index.js';
import { getQuickBooksTokens, saveQuickBooksTokens, isTokenExpired, type QuickBooksTokens } from './tokens.js';
import { sendAuthAlert } from '../telegram/index.js';

const INTUIT_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const INTUIT_TOKEN_URL_SANDBOX = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const INTUIT_TOKEN_URL_PROD = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

function getTokenUrl(): string {
  return env.QUICKBOOKS_ENVIRONMENT === 'production'
    ? INTUIT_TOKEN_URL_PROD
    : INTUIT_TOKEN_URL_SANDBOX;
}

export function getAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: env.QUICKBOOKS_CLIENT_ID,
    redirect_uri: env.QUICKBOOKS_REDIRECT_URI,
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    state: crypto.randomUUID(),
  });

  return `${INTUIT_AUTH_URL}?${params.toString()}`;
}

export async function handleAuthCallback(code: string, realmId: string): Promise<void> {
  const basicAuth = Buffer.from(
    `${env.QUICKBOOKS_CLIENT_ID}:${env.QUICKBOOKS_CLIENT_SECRET}`
  ).toString('base64');

  const response = await fetch(getTokenUrl(), {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: env.QUICKBOOKS_REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to exchange code for tokens: ${error}`);
  }

  const data = await response.json();

  await saveQuickBooksTokens({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    realmId,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  });
}

export async function refreshTokenIfNeeded(): Promise<QuickBooksTokens | null> {
  const tokens = await getQuickBooksTokens();

  if (!tokens) {
    const authUrl = getAuthUrl();
    await sendAuthAlert('quickbooks', authUrl);
    return null;
  }

  if (!isTokenExpired(tokens.expiresAt)) {
    return tokens;
  }

  // Token expired, refresh it
  const basicAuth = Buffer.from(
    `${env.QUICKBOOKS_CLIENT_ID}:${env.QUICKBOOKS_CLIENT_SECRET}`
  ).toString('base64');

  try {
    const response = await fetch(getTokenUrl(), {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
      }),
    });

    if (!response.ok) {
      throw new Error('Token refresh failed');
    }

    const data = await response.json();

    const refreshedTokens: QuickBooksTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || tokens.refreshToken,
      realmId: tokens.realmId,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };

    await saveQuickBooksTokens(refreshedTokens);
    return refreshedTokens;
  } catch (error) {
    console.error('Failed to refresh QuickBooks token:', error);
    const authUrl = getAuthUrl();
    await sendAuthAlert('quickbooks', authUrl);
    return null;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/modules/quickbooks/auth.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/modules/quickbooks/auth.ts src/modules/quickbooks/auth.test.ts
git commit -m "feat: add QuickBooks OAuth authentication"
```

---

## Task 5: QuickBooks API Client

**Files:**
- Create: `src/modules/quickbooks/client.ts`
- Create: `src/modules/quickbooks/client.test.ts`

**Step 1: Write failing test**

Create `src/modules/quickbooks/client.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/index.js', () => ({
  env: {
    QUICKBOOKS_ENVIRONMENT: 'sandbox',
  },
}));

vi.mock('./auth.js', () => ({
  refreshTokenIfNeeded: vi.fn(() => Promise.resolve({
    accessToken: 'test-token',
    realmId: 'test-realm',
    expiresAt: new Date(Date.now() + 3600000),
  })),
}));

describe('quickbooks client', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('exports getQuickBooksClient function', async () => {
    const client = await import('./client.js');
    expect(client.getQuickBooksClient).toBeDefined();
  });

  it('exports createEstimate function', async () => {
    const client = await import('./client.js');
    expect(client.createEstimate).toBeDefined();
  });

  it('exports getEstimates function', async () => {
    const client = await import('./client.js');
    expect(client.getEstimates).toBeDefined();
  });

  it('getBaseUrl returns sandbox URL for sandbox environment', async () => {
    const { getBaseUrl } = await import('./client.js');
    const url = getBaseUrl();
    expect(url).toContain('sandbox');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/modules/quickbooks/client.test.ts`
Expected: FAIL (module not found)

**Step 3: Create client.ts**

Create `src/modules/quickbooks/client.ts`:
```typescript
import { env } from '../../config/index.js';
import { refreshTokenIfNeeded, type QuickBooksTokens } from './auth.js';

const SANDBOX_BASE_URL = 'https://sandbox-quickbooks.api.intuit.com/v3/company';
const PRODUCTION_BASE_URL = 'https://quickbooks.api.intuit.com/v3/company';

export function getBaseUrl(): string {
  return env.QUICKBOOKS_ENVIRONMENT === 'production'
    ? PRODUCTION_BASE_URL
    : SANDBOX_BASE_URL;
}

export interface QuickBooksClient {
  tokens: QuickBooksTokens;
  baseUrl: string;
}

export async function getQuickBooksClient(): Promise<QuickBooksClient | null> {
  const tokens = await refreshTokenIfNeeded();
  if (!tokens) return null;

  return {
    tokens,
    baseUrl: `${getBaseUrl()}/${tokens.realmId}`,
  };
}

async function qbRequest<T>(
  client: QuickBooksClient,
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${client.baseUrl}${endpoint}`, {
    ...options,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${client.tokens.accessToken}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`QuickBooks API error: ${response.status} - ${error}`);
  }

  return response.json();
}

// Estimate types
export interface QBLineItem {
  DetailType: 'SalesItemLineDetail';
  Amount: number;
  Description: string;
  SalesItemLineDetail: {
    Qty: number;
    UnitPrice: number;
  };
}

export interface QBEstimate {
  Id?: string;
  DocNumber?: string;
  CustomerRef: { value: string; name?: string };
  Line: QBLineItem[];
  TotalAmt?: number;
  TxnDate?: string;
  EmailStatus?: string;
  CustomerMemo?: { value: string };
}

export interface CreateEstimateInput {
  customerId: string;
  customerName?: string;
  lines: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
  }>;
  memo?: string;
}

export async function createEstimate(input: CreateEstimateInput): Promise<QBEstimate> {
  const client = await getQuickBooksClient();
  if (!client) throw new Error('QuickBooks client not available');

  const lines: QBLineItem[] = input.lines.map(line => ({
    DetailType: 'SalesItemLineDetail',
    Amount: line.quantity * line.unitPrice,
    Description: line.description,
    SalesItemLineDetail: {
      Qty: line.quantity,
      UnitPrice: line.unitPrice,
    },
  }));

  const estimate: QBEstimate = {
    CustomerRef: {
      value: input.customerId,
      name: input.customerName,
    },
    Line: lines,
    EmailStatus: 'NotSent',
  };

  if (input.memo) {
    estimate.CustomerMemo = { value: input.memo };
  }

  const result = await qbRequest<{ Estimate: QBEstimate }>(
    client,
    '/estimate',
    {
      method: 'POST',
      body: JSON.stringify(estimate),
    }
  );

  return result.Estimate;
}

export async function getEstimates(maxResults = 100): Promise<QBEstimate[]> {
  const client = await getQuickBooksClient();
  if (!client) return [];

  const query = `SELECT * FROM Estimate MAXRESULTS ${maxResults}`;
  const result = await qbRequest<{ QueryResponse: { Estimate?: QBEstimate[] } }>(
    client,
    `/query?query=${encodeURIComponent(query)}`
  );

  return result.QueryResponse.Estimate || [];
}

export async function getEstimate(estimateId: string): Promise<QBEstimate | null> {
  const client = await getQuickBooksClient();
  if (!client) return null;

  try {
    const result = await qbRequest<{ Estimate: QBEstimate }>(
      client,
      `/estimate/${estimateId}`
    );
    return result.Estimate;
  } catch {
    return null;
  }
}

export interface QBCustomer {
  Id: string;
  DisplayName: string;
  CompanyName?: string;
  PrimaryEmailAddr?: { Address: string };
}

export async function getCustomers(): Promise<QBCustomer[]> {
  const client = await getQuickBooksClient();
  if (!client) return [];

  const query = 'SELECT * FROM Customer MAXRESULTS 1000';
  const result = await qbRequest<{ QueryResponse: { Customer?: QBCustomer[] } }>(
    client,
    `/query?query=${encodeURIComponent(query)}`
  );

  return result.QueryResponse.Customer || [];
}

export async function findCustomerByName(name: string): Promise<QBCustomer | null> {
  const client = await getQuickBooksClient();
  if (!client) return null;

  const query = `SELECT * FROM Customer WHERE DisplayName LIKE '%${name}%'`;
  const result = await qbRequest<{ QueryResponse: { Customer?: QBCustomer[] } }>(
    client,
    `/query?query=${encodeURIComponent(query)}`
  );

  return result.QueryResponse.Customer?.[0] || null;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/modules/quickbooks/client.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/modules/quickbooks/client.ts src/modules/quickbooks/client.test.ts
git commit -m "feat: add QuickBooks API client for estimates and customers"
```

---

## Task 6: QuickBooks Module Index

**Files:**
- Create: `src/modules/quickbooks/index.ts`

**Step 1: Create index.ts**

Create `src/modules/quickbooks/index.ts`:
```typescript
export { getQuickBooksTokens, saveQuickBooksTokens } from './tokens.js';
export { getAuthUrl, handleAuthCallback, refreshTokenIfNeeded } from './auth.js';
export {
  getQuickBooksClient,
  createEstimate,
  getEstimates,
  getEstimate,
  getCustomers,
  findCustomerByName,
  type QBEstimate,
  type QBLineItem,
  type QBCustomer,
  type CreateEstimateInput,
} from './client.js';
```

**Step 2: Verify build passes**

Run: `npm run build`
Expected: Success

**Step 3: Commit**

```bash
git add src/modules/quickbooks/index.ts
git commit -m "feat: add QuickBooks module exports"
```

---

## Task 7: QuickBooks OAuth Routes

**Files:**
- Modify: `src/routes/auth.ts`

**Step 1: Add QuickBooks routes to auth.ts**

Add to `src/routes/auth.ts` after Gmail routes:
```typescript
import { getAuthUrl as getQBAuthUrl, handleAuthCallback as handleQBCallback } from '../modules/quickbooks/index.js';

// Add inside authRoutes function:

  // QuickBooks OAuth - initiate
  fastify.get('/auth/quickbooks/authorize', async (request, reply) => {
    const authUrl = getQBAuthUrl();
    return reply.redirect(authUrl);
  });

  // QuickBooks OAuth - callback
  fastify.get<{ Querystring: { code?: string; state?: string; realmId?: string; error?: string } }>(
    '/auth/quickbooks/callback',
    async (request, reply) => {
      const { code, realmId, error } = request.query;

      if (error) {
        return reply.status(400).send({ error: 'OAuth authorization failed', details: error });
      }

      if (!code || !realmId) {
        return reply.status(400).send({ error: 'Missing authorization code or realmId' });
      }

      try {
        await handleQBCallback(code, realmId);
        await sendSimpleMessage('✅ QuickBooks authorized successfully');

        return reply.type('text/html').send(`
          <!DOCTYPE html>
          <html>
            <head><title>Authorization Successful</title></head>
            <body style="font-family: sans-serif; text-align: center; padding: 50px;">
              <h1>✅ QuickBooks Authorized</h1>
              <p>Company ID: ${realmId}</p>
              <p>You can close this window and return to Telegram.</p>
            </body>
          </html>
        `);
      } catch (err) {
        console.error('QuickBooks OAuth callback error:', err);
        return reply.status(500).send({ error: 'Failed to complete authorization' });
      }
    }
  );
```

**Step 2: Update imports at top of file**

Update imports in `src/routes/auth.ts`:
```typescript
import { FastifyInstance } from 'fastify';
import { getAuthUrl, handleAuthCallback } from '../modules/gmail/index.js';
import { getAuthUrl as getQBAuthUrl, handleAuthCallback as handleQBCallback } from '../modules/quickbooks/index.js';
import { sendSimpleMessage } from '../modules/telegram/index.js';
```

**Step 3: Verify build passes**

Run: `npm run build`
Expected: Success

**Step 4: Commit**

```bash
git add src/routes/auth.ts
git commit -m "feat: add QuickBooks OAuth authorization routes"
```

---

## Task 8: Estimates Repository

**Files:**
- Create: `src/db/estimates.ts`
- Create: `src/db/estimates.test.ts`

**Step 1: Write failing test**

Create `src/db/estimates.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEstimate = {
  id: 'est-123',
  contact_id: 'contact-123',
  gmail_message_id: 'gmail-123',
  quickbooks_estimate_id: 'qb-123',
  status: 'draft',
  total_amount: 1500,
  items: [{ description: 'Test Sign', quantity: 1, unitPrice: 1500 }],
};

vi.mock('./client.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: mockEstimate, error: null })),
        })),
      })),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: mockEstimate, error: null })),
          order: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve({ data: [mockEstimate], error: null })),
          })),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: mockEstimate, error: null })),
      })),
    })),
  },
}));

describe('estimates repository', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('exports createEstimate function', async () => {
    const estimates = await import('./estimates.js');
    expect(estimates.createEstimate).toBeDefined();
  });

  it('exports getEstimateById function', async () => {
    const estimates = await import('./estimates.js');
    expect(estimates.getEstimateById).toBeDefined();
  });

  it('exports updateEstimateStatus function', async () => {
    const estimates = await import('./estimates.js');
    expect(estimates.updateEstimateStatus).toBeDefined();
  });

  it('exports getRecentEstimates function', async () => {
    const estimates = await import('./estimates.js');
    expect(estimates.getRecentEstimates).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/db/estimates.test.ts`
Expected: FAIL (module not found)

**Step 3: Create estimates.ts**

Create `src/db/estimates.ts`:
```typescript
import { supabase } from './client.js';

export interface EstimateItem {
  description: string;
  signType?: string;
  material?: string;
  width?: number;
  height?: number;
  quantity: number;
  unitPrice: number;
  suggestedPrice?: number;
  confidence?: 'high' | 'medium' | 'low';
}

export interface Estimate {
  id: string;
  contact_id: string | null;
  gmail_message_id: string | null;
  quickbooks_estimate_id: string | null;
  quickbooks_doc_number: string | null;
  quickbooks_customer_id: string | null;
  status: 'draft' | 'sent' | 'won' | 'lost' | 'expired';
  total_amount: number | null;
  items: EstimateItem[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateEstimateInput {
  contactId?: string;
  gmailMessageId?: string;
  items: EstimateItem[];
  notes?: string;
}

export async function createEstimate(input: CreateEstimateInput): Promise<Estimate | null> {
  const totalAmount = input.items.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0
  );

  const { data, error } = await supabase
    .from('estimates')
    .insert({
      contact_id: input.contactId || null,
      gmail_message_id: input.gmailMessageId || null,
      status: 'draft',
      total_amount: totalAmount,
      items: input.items,
      notes: input.notes || null,
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to create estimate:', error);
    return null;
  }

  return data as Estimate;
}

export async function getEstimateById(id: string): Promise<Estimate | null> {
  const { data, error } = await supabase
    .from('estimates')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) {
    return null;
  }

  return data as Estimate;
}

export async function updateEstimateStatus(
  id: string,
  status: Estimate['status'],
  quickbooksData?: { estimateId: string; docNumber: string; customerId: string }
): Promise<boolean> {
  const updateData: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (quickbooksData) {
    updateData.quickbooks_estimate_id = quickbooksData.estimateId;
    updateData.quickbooks_doc_number = quickbooksData.docNumber;
    updateData.quickbooks_customer_id = quickbooksData.customerId;
  }

  const { error } = await supabase
    .from('estimates')
    .update(updateData)
    .eq('id', id);

  if (error) {
    console.error('Failed to update estimate status:', error);
    return false;
  }

  return true;
}

export async function updateEstimateItems(id: string, items: EstimateItem[]): Promise<boolean> {
  const totalAmount = items.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0
  );

  const { error } = await supabase
    .from('estimates')
    .update({
      items,
      total_amount: totalAmount,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    console.error('Failed to update estimate items:', error);
    return false;
  }

  return true;
}

export async function getRecentEstimates(limit = 10): Promise<Estimate[]> {
  const { data, error } = await supabase
    .from('estimates')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) {
    console.error('Failed to fetch recent estimates:', error);
    return [];
  }

  return data as Estimate[];
}

export async function getPendingEstimates(): Promise<Estimate[]> {
  const { data, error } = await supabase
    .from('estimates')
    .select('*')
    .eq('status', 'sent')
    .order('created_at', { ascending: false });

  if (error || !data) {
    console.error('Failed to fetch pending estimates:', error);
    return [];
  }

  return data as Estimate[];
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/db/estimates.test.ts`
Expected: PASS

**Step 5: Update db/index.ts exports**

Add to `src/db/index.ts`:
```typescript
export {
  createEstimate,
  getEstimateById,
  updateEstimateStatus,
  updateEstimateItems,
  getRecentEstimates,
  getPendingEstimates,
  type Estimate,
  type EstimateItem,
} from './estimates.js';
```

**Step 6: Commit**

```bash
git add src/db/estimates.ts src/db/estimates.test.ts src/db/index.ts
git commit -m "feat: add estimates repository for local estimate tracking"
```

---

## Task 9: Pricing History Repository

**Files:**
- Create: `src/db/pricing.ts`
- Create: `src/db/pricing.test.ts`

**Step 1: Write failing test**

Create `src/db/pricing.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./client.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          gte: vi.fn(() => ({
            lte: vi.fn(() => ({
              neq: vi.fn(() => Promise.resolve({
                data: [
                  { unit_price: 45, outcome: 'won' },
                  { unit_price: 50, outcome: 'won' },
                  { unit_price: 55, outcome: 'lost' },
                ],
                error: null,
              })),
            })),
          })),
        })),
      })),
      insert: vi.fn(() => Promise.resolve({ data: null, error: null })),
    })),
  },
}));

describe('pricing repository', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('exports getPricingSuggestion function', async () => {
    const pricing = await import('./pricing.js');
    expect(pricing.getPricingSuggestion).toBeDefined();
  });

  it('exports recordPricingHistory function', async () => {
    const pricing = await import('./pricing.js');
    expect(pricing.recordPricingHistory).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/db/pricing.test.ts`
Expected: FAIL (module not found)

**Step 3: Create pricing.ts**

Create `src/db/pricing.ts`:
```typescript
import { supabase } from './client.js';

export interface PricingSuggestion {
  suggestedPricePerSqft: number;
  suggestedTotal: number;
  confidence: 'high' | 'medium' | 'low';
  sampleSize: number;
  winRate: number;
}

export interface PricingQuery {
  signTypeId?: string;
  materialId?: string;
  sqft: number;
}

export async function getPricingSuggestion(query: PricingQuery): Promise<PricingSuggestion | null> {
  const minSqft = query.sqft * 0.7;
  const maxSqft = query.sqft * 1.3;

  let dbQuery = supabase
    .from('pricing_history')
    .select('unit_price, total_price, width_inches, height_inches, outcome');

  if (query.signTypeId) {
    dbQuery = dbQuery.eq('sign_type_id', query.signTypeId);
  }

  if (query.materialId) {
    dbQuery = dbQuery.eq('material_id', query.materialId);
  }

  // Filter by similar size range using computed sqft
  const { data, error } = await dbQuery.neq('outcome', 'pending');

  if (error || !data || data.length === 0) {
    return null;
  }

  // Filter by sqft range in memory (since sqft is computed)
  const filtered = data.filter(row => {
    const rowSqft = (row.width_inches * row.height_inches) / 144;
    return rowSqft >= minSqft && rowSqft <= maxSqft;
  });

  if (filtered.length === 0) {
    return null;
  }

  // Calculate average price per sqft
  const pricesPerSqft = filtered.map(row => {
    const rowSqft = (row.width_inches * row.height_inches) / 144;
    return row.unit_price / (rowSqft || 1);
  });

  const avgPricePerSqft = pricesPerSqft.reduce((a, b) => a + b, 0) / pricesPerSqft.length;

  // Calculate win rate
  const wins = filtered.filter(row => row.outcome === 'won').length;
  const winRate = wins / filtered.length;

  // Adjust based on win rate
  let adjustedPrice = avgPricePerSqft;
  if (winRate > 0.7) {
    adjustedPrice *= 1.1; // Room for margin
  } else if (winRate < 0.4) {
    adjustedPrice *= 0.9; // Need to be more competitive
  }

  // Determine confidence
  let confidence: 'high' | 'medium' | 'low';
  if (filtered.length >= 10) {
    confidence = 'high';
  } else if (filtered.length >= 3) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  return {
    suggestedPricePerSqft: Math.round(adjustedPrice * 100) / 100,
    suggestedTotal: Math.round(adjustedPrice * query.sqft * 100) / 100,
    confidence,
    sampleSize: filtered.length,
    winRate: Math.round(winRate * 100) / 100,
  };
}

export interface RecordPricingInput {
  signTypeId?: string;
  materialId?: string;
  description: string;
  widthInches: number;
  heightInches: number;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  outcome?: 'won' | 'lost' | 'pending';
  quickbooksEstimateId?: string;
  contactId?: string;
}

export async function recordPricingHistory(input: RecordPricingInput): Promise<boolean> {
  const { error } = await supabase
    .from('pricing_history')
    .insert({
      sign_type_id: input.signTypeId || null,
      material_id: input.materialId || null,
      description: input.description,
      width_inches: input.widthInches,
      height_inches: input.heightInches,
      quantity: input.quantity,
      unit_price: input.unitPrice,
      total_price: input.totalPrice,
      outcome: input.outcome || 'pending',
      quickbooks_estimate_id: input.quickbooksEstimateId || null,
      contact_id: input.contactId || null,
    });

  if (error) {
    console.error('Failed to record pricing history:', error);
    return false;
  }

  return true;
}

export async function updatePricingOutcome(
  quickbooksEstimateId: string,
  outcome: 'won' | 'lost'
): Promise<boolean> {
  const { error } = await supabase
    .from('pricing_history')
    .update({ outcome })
    .eq('quickbooks_estimate_id', quickbooksEstimateId);

  if (error) {
    console.error('Failed to update pricing outcome:', error);
    return false;
  }

  return true;
}

export interface SignType {
  id: string;
  name: string;
  category: string | null;
  base_price_per_sqft: number | null;
  min_price: number | null;
}

export async function getSignTypes(): Promise<SignType[]> {
  const { data, error } = await supabase
    .from('sign_types')
    .select('*')
    .order('name');

  if (error || !data) {
    console.error('Failed to fetch sign types:', error);
    return [];
  }

  return data as SignType[];
}

export async function findSignTypeByName(name: string): Promise<SignType | null> {
  const { data, error } = await supabase
    .from('sign_types')
    .select('*')
    .ilike('name', `%${name}%`)
    .limit(1)
    .single();

  if (error || !data) {
    return null;
  }

  return data as SignType;
}

export interface Material {
  id: string;
  name: string;
  price_multiplier: number;
}

export async function getMaterials(): Promise<Material[]> {
  const { data, error } = await supabase
    .from('materials')
    .select('*')
    .order('name');

  if (error || !data) {
    console.error('Failed to fetch materials:', error);
    return [];
  }

  return data as Material[];
}

export async function findMaterialByName(name: string): Promise<Material | null> {
  const { data, error } = await supabase
    .from('materials')
    .select('*')
    .ilike('name', `%${name}%`)
    .limit(1)
    .single();

  if (error || !data) {
    return null;
  }

  return data as Material;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/db/pricing.test.ts`
Expected: PASS

**Step 5: Update db/index.ts exports**

Add to `src/db/index.ts`:
```typescript
export {
  getPricingSuggestion,
  recordPricingHistory,
  updatePricingOutcome,
  getSignTypes,
  findSignTypeByName,
  getMaterials,
  findMaterialByName,
  type PricingSuggestion,
  type SignType,
  type Material,
} from './pricing.js';
```

**Step 6: Commit**

```bash
git add src/db/pricing.ts src/db/pricing.test.ts src/db/index.ts
git commit -m "feat: add pricing history repository with suggestions"
```

---

## Task 10: Pricing Engine Module

**Files:**
- Create: `src/modules/pricing/engine.ts`
- Create: `src/modules/pricing/engine.test.ts`
- Create: `src/modules/pricing/index.ts`

**Step 1: Write failing test**

Create `src/modules/pricing/engine.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  getPricingSuggestion: vi.fn(() => Promise.resolve({
    suggestedPricePerSqft: 45,
    suggestedTotal: 1800,
    confidence: 'high',
    sampleSize: 15,
    winRate: 0.75,
  })),
  findSignTypeByName: vi.fn(() => Promise.resolve({
    id: 'sign-123',
    name: 'Channel Letters',
    base_price_per_sqft: 45,
    min_price: 500,
  })),
  findMaterialByName: vi.fn(() => Promise.resolve({
    id: 'mat-123',
    name: 'Aluminum',
    price_multiplier: 1.0,
  })),
}));

describe('pricing engine', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('exports suggestPriceForItem function', async () => {
    const engine = await import('./engine.js');
    expect(engine.suggestPriceForItem).toBeDefined();
  });

  it('exports suggestPricesForEstimate function', async () => {
    const engine = await import('./engine.js');
    expect(engine.suggestPricesForEstimate).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/modules/pricing/engine.test.ts`
Expected: FAIL (module not found)

**Step 3: Create engine.ts**

Create `src/modules/pricing/engine.ts`:
```typescript
import {
  getPricingSuggestion,
  findSignTypeByName,
  findMaterialByName,
  type PricingSuggestion,
  type SignType,
  type Material,
} from '../../db/index.js';

export interface PricedItem {
  description: string;
  signType: string | null;
  signTypeId: string | null;
  material: string | null;
  materialId: string | null;
  width: number;
  height: number;
  sqft: number;
  quantity: number;
  suggestedUnitPrice: number;
  suggestedTotal: number;
  confidence: 'high' | 'medium' | 'low';
  sampleSize: number;
  winRate: number;
  priceSource: 'history' | 'base_formula' | 'minimum';
}

export interface ItemInput {
  signType: string;
  size: string;
  quantity: number;
  description?: string;
  material?: string;
}

function parseDimensions(size: string): { width: number; height: number } {
  // Parse common formats: "24x36", "24\"x36\"", "24 x 36", "2'x3'"
  const match = size.match(/(\d+(?:\.\d+)?)\s*['"]?\s*[xX×]\s*(\d+(?:\.\d+)?)\s*['"]?/);

  if (!match) {
    // Default to 24x24 if parsing fails
    return { width: 24, height: 24 };
  }

  let width = parseFloat(match[1]);
  let height = parseFloat(match[2]);

  // If dimensions seem to be in feet (small numbers), convert to inches
  if (width <= 10 && height <= 10) {
    width *= 12;
    height *= 12;
  }

  return { width, height };
}

export async function suggestPriceForItem(input: ItemInput): Promise<PricedItem> {
  const { width, height } = parseDimensions(input.size);
  const sqft = (width * height) / 144;

  // Look up sign type and material
  const signType: SignType | null = await findSignTypeByName(input.signType);
  const material: Material | null = input.material
    ? await findMaterialByName(input.material)
    : null;

  // Try to get pricing from history
  const suggestion = await getPricingSuggestion({
    signTypeId: signType?.id,
    materialId: material?.id,
    sqft,
  });

  let suggestedUnitPrice: number;
  let confidence: 'high' | 'medium' | 'low';
  let sampleSize = 0;
  let winRate = 0;
  let priceSource: 'history' | 'base_formula' | 'minimum';

  if (suggestion && suggestion.sampleSize >= 3) {
    // Use historical pricing
    suggestedUnitPrice = suggestion.suggestedTotal;
    confidence = suggestion.confidence;
    sampleSize = suggestion.sampleSize;
    winRate = suggestion.winRate;
    priceSource = 'history';

    // Apply material multiplier if available
    if (material) {
      suggestedUnitPrice *= material.price_multiplier;
    }
  } else if (signType?.base_price_per_sqft) {
    // Fall back to base formula
    suggestedUnitPrice = sqft * signType.base_price_per_sqft;

    // Apply material multiplier
    if (material) {
      suggestedUnitPrice *= material.price_multiplier;
    }

    // Enforce minimum
    if (signType.min_price && suggestedUnitPrice < signType.min_price) {
      suggestedUnitPrice = signType.min_price;
      priceSource = 'minimum';
    } else {
      priceSource = 'base_formula';
    }

    confidence = 'low';
  } else {
    // No data at all - use generic fallback
    suggestedUnitPrice = sqft * 30; // Generic $30/sqft
    confidence = 'low';
    priceSource = 'base_formula';
  }

  // Round to nearest dollar
  suggestedUnitPrice = Math.round(suggestedUnitPrice);

  return {
    description: input.description || `${input.signType} ${input.size}`,
    signType: signType?.name || input.signType,
    signTypeId: signType?.id || null,
    material: material?.name || input.material || null,
    materialId: material?.id || null,
    width,
    height,
    sqft: Math.round(sqft * 100) / 100,
    quantity: input.quantity,
    suggestedUnitPrice,
    suggestedTotal: suggestedUnitPrice * input.quantity,
    confidence,
    sampleSize,
    winRate,
    priceSource,
  };
}

export async function suggestPricesForEstimate(items: ItemInput[]): Promise<PricedItem[]> {
  return Promise.all(items.map(item => suggestPriceForItem(item)));
}

export function formatPriceConfidence(item: PricedItem): string {
  if (item.confidence === 'high') {
    return `⭐ High confidence (${item.sampleSize} similar jobs, ${Math.round(item.winRate * 100)}% win rate)`;
  } else if (item.confidence === 'medium') {
    return `📊 Medium confidence (${item.sampleSize} similar jobs)`;
  } else {
    if (item.priceSource === 'minimum') {
      return '⚠️ Low confidence (using minimum price)';
    }
    return '⚠️ Low confidence (using base formula)';
  }
}
```

**Step 4: Create index.ts**

Create `src/modules/pricing/index.ts`:
```typescript
export {
  suggestPriceForItem,
  suggestPricesForEstimate,
  formatPriceConfidence,
  type PricedItem,
  type ItemInput,
} from './engine.js';
```

**Step 5: Run test to verify it passes**

Run: `npm test -- src/modules/pricing/engine.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/modules/pricing/engine.ts src/modules/pricing/engine.test.ts src/modules/pricing/index.ts
git commit -m "feat: add pricing engine with historical suggestions"
```

---

## Task 11: Enhanced AI Parser with Pricing

**Files:**
- Modify: `src/modules/ai/parser.ts`

**Step 1: Update parser to include material detection**

Update the `ParsedEstimateRequestSchema` in `src/modules/ai/parser.ts`:
```typescript
export const ParsedEstimateRequestSchema = z.object({
  intent: z.enum(['new_request', 'status_inquiry', 'reorder', 'approval', 'general']),
  items: z.array(z.object({
    signType: z.string(),
    quantity: z.number(),
    size: z.string(),
    material: z.string().nullish(),
    description: z.string().nullish(),
  })),
  specialRequests: z.array(z.string()),
  urgency: z.enum(['normal', 'urgent', 'rush']).nullish(),
  referencedJobDescription: z.string().nullish(),
});
```

**Step 2: Update SYSTEM_PROMPT to extract material**

Update `SYSTEM_PROMPT` in `src/modules/ai/parser.ts`:
```typescript
const SYSTEM_PROMPT = `You are an AI assistant that parses estimate request emails for a sign fabrication company.

Extract the following information from the email:
1. Intent: Is this a new estimate request, a status inquiry about an existing job, a reorder of previous signs, an approval of a quote, or a general message?
2. Items: List each sign type requested with quantity, size, and material if mentioned
3. Special Requests: Any specific requirements like colors (PMS codes), deadlines, installation needs
4. Urgency: normal, urgent, or rush based on language used
5. Referenced Job: If this is a status inquiry or reorder, what job/sign are they referring to?

Common sign types: Channel Letters, Monument Sign, Pylon Sign, Wall Sign, Wayfinding Sign, ADA Sign, Vinyl Graphics, Vehicle Wrap, Banner, A-Frame

Common materials: Aluminum, Acrylic, Dibond, PVC, Coroplast, HDU, Stainless Steel, Bronze

Respond with valid JSON matching this schema:
{
  "intent": "new_request" | "status_inquiry" | "reorder" | "approval" | "general",
  "items": [{ "signType": string, "quantity": number, "size": string, "material": string | null, "description": string | null }],
  "specialRequests": string[],
  "urgency": "normal" | "urgent" | "rush" | null,
  "referencedJobDescription": string | null
}`;
```

**Step 3: Verify build and tests pass**

Run: `npm run build && npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/modules/ai/parser.ts
git commit -m "feat: enhance AI parser to extract material from emails"
```

---

## Task 12: Enhanced Telegram Notifications with Pricing

**Files:**
- Modify: `src/modules/telegram/bot.ts`

**Step 1: Add new notification type for priced estimates**

Add to `src/modules/telegram/bot.ts`:
```typescript
import type { PricedItem } from '../pricing/index.js';

export interface PricedEstimateNotification {
  from: string;
  company: string;
  subject: string;
  items: PricedItem[];
  specialRequests: string[];
  estimateId: string;
  gmailMessageId: string;
}

export async function sendPricedEstimateNotification(notification: PricedEstimateNotification): Promise<void> {
  const itemsList = notification.items
    .map((item, idx) => {
      const confidenceIcon = item.confidence === 'high' ? '⭐' : item.confidence === 'medium' ? '📊' : '⚠️';
      const confidenceText = item.confidence === 'high'
        ? `${item.sampleSize} jobs, ${Math.round(item.winRate * 100)}% win`
        : item.confidence === 'medium'
        ? `${item.sampleSize} jobs`
        : item.priceSource === 'minimum' ? 'min price' : 'base formula';

      return `${idx + 1}. ${item.signType} ${item.width}"×${item.height}"${item.material ? ` (${item.material})` : ''}
   Qty: ${item.quantity} × $${item.suggestedUnitPrice.toLocaleString()} = $${item.suggestedTotal.toLocaleString()}
   ${confidenceIcon} ${confidenceText}`;
    })
    .join('\n\n');

  const total = notification.items.reduce((sum, item) => sum + item.suggestedTotal, 0);

  const specialRequestsList = notification.specialRequests.length > 0
    ? `\n\n📝 Special Requests:\n${notification.specialRequests.map((r) => `• ${r}`).join('\n')}`
    : '';

  const message = `📋 New Estimate Request

From: ${notification.from} (${notification.company})
Subject: ${notification.subject}

${itemsList}

━━━━━━━━━━━━━━━━━━━━
Total: $${total.toLocaleString()}${specialRequestsList}`;

  await bot.telegram.sendMessage(
    env.TELEGRAM_ADMIN_CHAT_ID,
    message,
    Markup.inlineKeyboard([
      [
        Markup.button.callback('✓ Approve', `approve_estimate:${notification.estimateId}`),
        Markup.button.callback('✏️ Edit', `edit_estimate:${notification.estimateId}`),
        Markup.button.callback('✗ Reject', `reject_estimate:${notification.estimateId}`),
      ],
      [
        Markup.button.url('View Email', `https://mail.google.com/mail/u/0/#inbox/${notification.gmailMessageId}`),
      ],
    ])
  );
}
```

**Step 2: Update exports in telegram/index.ts**

Add to `src/modules/telegram/index.ts`:
```typescript
export {
  bot,
  sendNotification,
  sendAuthAlert,
  sendSimpleMessage,
  sendPricedEstimateNotification,
} from './bot.js';
export type { EstimateRequestNotification, PricedEstimateNotification } from './bot.js';
```

**Step 3: Verify build passes**

Run: `npm run build`
Expected: Success

**Step 4: Commit**

```bash
git add src/modules/telegram/bot.ts src/modules/telegram/index.ts
git commit -m "feat: add priced estimate notifications to Telegram"
```

---

## Task 13: Telegram Callback Handlers for Approve/Edit/Reject

**Files:**
- Create: `src/modules/telegram/callbacks.ts`
- Modify: `src/index.ts`

**Step 1: Create callbacks.ts**

Create `src/modules/telegram/callbacks.ts`:
```typescript
import { Context, Markup } from 'telegraf';
import { bot } from './bot.js';
import { env } from '../../config/index.js';
import {
  getEstimateById,
  updateEstimateStatus,
  updateEstimateItems,
  type Estimate,
  type EstimateItem,
} from '../../db/index.js';
import {
  createEstimate as createQBEstimate,
  findCustomerByName,
} from '../quickbooks/index.js';
import { recordPricingHistory } from '../../db/index.js';

// Store for edit sessions
const editSessions = new Map<string, {
  estimateId: string;
  itemIndex: number;
  step: 'select_item' | 'enter_price';
}>();

export function setupCallbackHandlers(): void {
  // Approve estimate
  bot.action(/^approve_estimate:(.+)$/, async (ctx) => {
    const estimateId = ctx.match[1];
    await ctx.answerCbQuery('Processing...');

    try {
      const estimate = await getEstimateById(estimateId);
      if (!estimate) {
        await ctx.reply('❌ Estimate not found');
        return;
      }

      // Find or create QuickBooks customer
      // For now, use a placeholder - in production, match to contact
      const customer = await findCustomerByName('Samsung');
      if (!customer) {
        await ctx.reply('❌ Customer not found in QuickBooks. Please create the customer first.');
        return;
      }

      // Create estimate in QuickBooks
      const qbEstimate = await createQBEstimate({
        customerId: customer.Id,
        customerName: customer.DisplayName,
        lines: estimate.items.map(item => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      });

      // Update local estimate with QuickBooks data
      await updateEstimateStatus(estimateId, 'sent', {
        estimateId: qbEstimate.Id!,
        docNumber: qbEstimate.DocNumber || '',
        customerId: customer.Id,
      });

      // Record pricing history for each item
      for (const item of estimate.items) {
        if (item.width && item.height) {
          await recordPricingHistory({
            signTypeId: item.signType || undefined,
            description: item.description,
            widthInches: item.width,
            heightInches: item.height,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.unitPrice * item.quantity,
            outcome: 'pending',
            quickbooksEstimateId: qbEstimate.Id,
          });
        }
      }

      await ctx.editMessageText(
        `✅ Estimate #${qbEstimate.DocNumber} created in QuickBooks!\n\nTotal: $${estimate.total_amount?.toLocaleString()}\n\nUse /won ${estimateId.slice(0, 8)} or /lost ${estimateId.slice(0, 8)} to track outcome.`
      );
    } catch (error) {
      console.error('Failed to create QuickBooks estimate:', error);
      await ctx.reply(`❌ Failed to create estimate: ${error}`);
    }
  });

  // Start edit flow
  bot.action(/^edit_estimate:(.+)$/, async (ctx) => {
    const estimateId = ctx.match[1];
    await ctx.answerCbQuery();

    const estimate = await getEstimateById(estimateId);
    if (!estimate) {
      await ctx.reply('❌ Estimate not found');
      return;
    }

    const userId = ctx.from?.id.toString() || '';
    editSessions.set(userId, {
      estimateId,
      itemIndex: -1,
      step: 'select_item',
    });

    const buttons = estimate.items.map((item, idx) =>
      [Markup.button.callback(`${idx + 1}. ${item.description.slice(0, 30)}...`, `edit_item:${idx}`)]
    );
    buttons.push([Markup.button.callback('Cancel', 'cancel_edit')]);

    await ctx.reply(
      'Which item do you want to edit?',
      Markup.inlineKeyboard(buttons)
    );
  });

  // Select item to edit
  bot.action(/^edit_item:(\d+)$/, async (ctx) => {
    const itemIndex = parseInt(ctx.match[1]);
    const userId = ctx.from?.id.toString() || '';

    const session = editSessions.get(userId);
    if (!session) {
      await ctx.answerCbQuery('Session expired, please start over');
      return;
    }

    await ctx.answerCbQuery();

    const estimate = await getEstimateById(session.estimateId);
    if (!estimate) {
      await ctx.reply('❌ Estimate not found');
      return;
    }

    const item = estimate.items[itemIndex];
    session.itemIndex = itemIndex;
    session.step = 'enter_price';
    editSessions.set(userId, session);

    await ctx.reply(
      `${item.description}\n\nCurrent price: $${item.unitPrice.toLocaleString()}\n\nReply with new price (number only):`,
      { reply_markup: { force_reply: true } }
    );
  });

  // Cancel edit
  bot.action('cancel_edit', async (ctx) => {
    const userId = ctx.from?.id.toString() || '';
    editSessions.delete(userId);
    await ctx.answerCbQuery('Edit cancelled');
    await ctx.deleteMessage();
  });

  // Reject estimate
  bot.action(/^reject_estimate:(.+)$/, async (ctx) => {
    const estimateId = ctx.match[1];
    await ctx.answerCbQuery();

    await updateEstimateStatus(estimateId, 'expired');
    await ctx.editMessageText('❌ Estimate rejected and archived.');
  });

  // Handle text replies for price editing
  bot.on('text', async (ctx) => {
    const userId = ctx.from?.id.toString() || '';
    const session = editSessions.get(userId);

    if (!session || session.step !== 'enter_price') {
      return; // Not in an edit session
    }

    const newPrice = parseFloat(ctx.message.text.replace(/[,$]/g, ''));
    if (isNaN(newPrice) || newPrice < 0) {
      await ctx.reply('Please enter a valid number (e.g., 1500 or 1,500)');
      return;
    }

    const estimate = await getEstimateById(session.estimateId);
    if (!estimate) {
      await ctx.reply('❌ Estimate not found');
      editSessions.delete(userId);
      return;
    }

    // Update the item price
    const updatedItems = [...estimate.items];
    updatedItems[session.itemIndex] = {
      ...updatedItems[session.itemIndex],
      unitPrice: newPrice,
    };

    await updateEstimateItems(session.estimateId, updatedItems);
    editSessions.delete(userId);

    const newTotal = updatedItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

    await ctx.reply(
      `✅ Updated to $${newPrice.toLocaleString()}\n\nNew total: $${newTotal.toLocaleString()}`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback('✓ Approve', `approve_estimate:${session.estimateId}`),
          Markup.button.callback('✏️ Edit More', `edit_estimate:${session.estimateId}`),
        ],
      ])
    );
  });
}

// Win/lose tracking commands
export function setupOutcomeCommands(): void {
  bot.command('won', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      await ctx.reply('Usage: /won <estimate_id_prefix>');
      return;
    }

    const idPrefix = args[1];
    // Find estimate by ID prefix
    const estimate = await findEstimateByPrefix(idPrefix);
    if (!estimate) {
      await ctx.reply(`❌ No estimate found starting with "${idPrefix}"`);
      return;
    }

    await updateEstimateStatus(estimate.id, 'won');
    if (estimate.quickbooks_estimate_id) {
      const { updatePricingOutcome } = await import('../../db/index.js');
      await updatePricingOutcome(estimate.quickbooks_estimate_id, 'won');
    }

    await ctx.reply(`🎉 Estimate #${estimate.quickbooks_doc_number || estimate.id.slice(0, 8)} marked as WON! Pricing history updated.`);
  });

  bot.command('lost', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      await ctx.reply('Usage: /lost <estimate_id_prefix>');
      return;
    }

    const idPrefix = args[1];
    const estimate = await findEstimateByPrefix(idPrefix);
    if (!estimate) {
      await ctx.reply(`❌ No estimate found starting with "${idPrefix}"`);
      return;
    }

    await updateEstimateStatus(estimate.id, 'lost');
    if (estimate.quickbooks_estimate_id) {
      const { updatePricingOutcome } = await import('../../db/index.js');
      await updatePricingOutcome(estimate.quickbooks_estimate_id, 'lost');
    }

    await ctx.reply(`📉 Estimate #${estimate.quickbooks_doc_number || estimate.id.slice(0, 8)} marked as LOST. Pricing will be adjusted.`);
  });

  bot.command('estimates', async (ctx) => {
    const { getPendingEstimates } = await import('../../db/index.js');
    const pending = await getPendingEstimates();

    if (pending.length === 0) {
      await ctx.reply('No pending estimates.');
      return;
    }

    const list = pending.map(est =>
      `• #${est.quickbooks_doc_number || est.id.slice(0, 8)} - $${est.total_amount?.toLocaleString()} (${est.status})`
    ).join('\n');

    await ctx.reply(`📋 Pending Estimates:\n\n${list}\n\nUse /won <id> or /lost <id> to update.`);
  });
}

async function findEstimateByPrefix(prefix: string): Promise<Estimate | null> {
  const { getRecentEstimates } = await import('../../db/index.js');
  const estimates = await getRecentEstimates(50);

  return estimates.find(e =>
    e.id.startsWith(prefix) ||
    e.quickbooks_doc_number?.includes(prefix) ||
    e.quickbooks_estimate_id?.includes(prefix)
  ) || null;
}
```

**Step 2: Update telegram/index.ts exports**

Add to `src/modules/telegram/index.ts`:
```typescript
export { setupCallbackHandlers, setupOutcomeCommands } from './callbacks.js';
```

**Step 3: Update src/index.ts to register handlers**

Add to `src/index.ts` after bot commands setup:
```typescript
import { setupCallbackHandlers, setupOutcomeCommands } from './modules/telegram/index.js';

// In main(), after existing bot.command() calls:
  setupCallbackHandlers();
  setupOutcomeCommands();
```

**Step 4: Verify build passes**

Run: `npm run build`
Expected: Success

**Step 5: Commit**

```bash
git add src/modules/telegram/callbacks.ts src/modules/telegram/index.ts src/index.ts
git commit -m "feat: add Telegram callback handlers for estimate approval workflow"
```

---

## Task 14: Update Email Processing with Pricing

**Files:**
- Modify: `src/modules/gmail/webhook.ts`

**Step 1: Update processEmailMessage to use pricing**

Update `src/modules/gmail/webhook.ts`:
```typescript
import { getMessage, extractEmailContent } from './client.js';
import { getWatchState, getNewMessagesSinceHistoryId } from './watch.js';
import { findContactByEmail } from '../../db/index.js';
import { parseEstimateRequest } from '../ai/index.js';
import { sendNotification, sendSimpleMessage, sendPricedEstimateNotification } from '../telegram/index.js';
import { suggestPricesForEstimate, type ItemInput } from '../pricing/index.js';
import { createEstimate, type EstimateItem } from '../../db/index.js';
import type { EstimateRequestNotification } from '../telegram/index.js';

// ... keep existing interfaces ...

export async function processEmailMessage(messageId: string): Promise<boolean> {
  // Validate messageId
  if (!messageId || typeof messageId !== 'string' || !messageId.trim()) {
    console.error('Invalid messageId provided');
    return false;
  }

  console.log('Processing email message:', messageId);

  // Fetch the full message
  const message = await getMessage(messageId);
  if (!message) {
    console.log('Could not fetch message, Gmail client not available');
    return false;
  }

  // Extract email content
  const { from, subject, body } = extractEmailContent(message);
  console.log('Email from:', from, 'Subject:', subject);

  // Check if sender is a monitored contact
  const contact = await findContactByEmail(from);
  if (!contact) {
    console.log('Sender not in monitored contacts, skipping');
    return false;
  }

  console.log('Matched contact:', contact.name, contact.company);

  // Parse the email with AI
  const parsed = await parseEstimateRequest({ from, subject, body });
  console.log('Parsed intent:', parsed.intent);

  // Only process new requests with pricing
  if (parsed.intent === 'new_request' && parsed.items.length > 0) {
    // Get pricing suggestions
    const itemInputs: ItemInput[] = parsed.items.map(item => ({
      signType: item.signType,
      size: item.size,
      quantity: item.quantity,
      material: item.material || undefined,
      description: item.description || undefined,
    }));

    const pricedItems = await suggestPricesForEstimate(itemInputs);
    console.log('Priced items:', pricedItems.length);

    // Create local estimate
    const estimateItems: EstimateItem[] = pricedItems.map(item => ({
      description: item.description,
      signType: item.signType || undefined,
      material: item.material || undefined,
      width: item.width,
      height: item.height,
      quantity: item.quantity,
      unitPrice: item.suggestedUnitPrice,
      suggestedPrice: item.suggestedUnitPrice,
      confidence: item.confidence,
    }));

    const estimate = await createEstimate({
      contactId: contact.id,
      gmailMessageId: messageId,
      items: estimateItems,
      notes: parsed.specialRequests.join('; '),
    });

    if (!estimate) {
      console.error('Failed to create estimate');
      return false;
    }

    // Send priced notification
    await sendPricedEstimateNotification({
      from: contact.name,
      company: contact.company || '',
      subject,
      items: pricedItems,
      specialRequests: parsed.specialRequests,
      estimateId: estimate.id,
      gmailMessageId: messageId,
    });

    console.log('Priced estimate notification sent');
    return true;
  }

  // For other intents, use simple notification
  if (parsed.intent !== 'general') {
    await sendSimpleMessage(
      `📧 ${parsed.intent.replace('_', ' ')} from ${contact.name}\n\nSubject: ${subject}`
    );
  }

  return true;
}
```

**Step 2: Verify build passes**

Run: `npm run build`
Expected: Success

**Step 3: Commit**

```bash
git add src/modules/gmail/webhook.ts
git commit -m "feat: integrate pricing suggestions into email processing"
```

---

## Task 15: QuickBooks Historical Import

**Files:**
- Create: `src/modules/quickbooks/import.ts`
- Create: `src/routes/setup.ts` (modify)

**Step 1: Create import.ts**

Create `src/modules/quickbooks/import.ts`:
```typescript
import { getEstimates } from './client.js';
import { recordPricingHistory, findSignTypeByName, findMaterialByName } from '../../db/index.js';

interface ParsedLineItem {
  signType: string | null;
  material: string | null;
  width: number;
  height: number;
  description: string;
}

function parseDescription(description: string): ParsedLineItem {
  // Try to extract sign type from description
  const signTypes = [
    'Channel Letters', 'Monument Sign', 'Pylon Sign', 'Wall Sign',
    'Wayfinding Sign', 'ADA Sign', 'Vinyl Graphics', 'Vehicle Wrap',
    'Banner', 'A-Frame', 'Dimensional Letters', 'Cabinet Sign',
  ];

  const materials = [
    'Aluminum', 'Acrylic', 'Dibond', 'PVC', 'Coroplast',
    'HDU', 'Stainless Steel', 'Bronze', 'LED', 'Neon',
  ];

  let foundSignType: string | null = null;
  let foundMaterial: string | null = null;

  for (const st of signTypes) {
    if (description.toLowerCase().includes(st.toLowerCase())) {
      foundSignType = st;
      break;
    }
  }

  for (const mat of materials) {
    if (description.toLowerCase().includes(mat.toLowerCase())) {
      foundMaterial = mat;
      break;
    }
  }

  // Try to parse dimensions
  const dimMatch = description.match(/(\d+(?:\.\d+)?)\s*['"x×]\s*(\d+(?:\.\d+)?)/i);
  let width = 24; // default
  let height = 24; // default

  if (dimMatch) {
    width = parseFloat(dimMatch[1]);
    height = parseFloat(dimMatch[2]);
    // Convert feet to inches if small numbers
    if (width <= 10 && height <= 10) {
      width *= 12;
      height *= 12;
    }
  }

  return {
    signType: foundSignType,
    material: foundMaterial,
    width,
    height,
    description,
  };
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: number;
}

export async function importHistoricalEstimates(): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, skipped: 0, errors: 0 };

  try {
    const estimates = await getEstimates(500); // Get up to 500 estimates
    console.log(`Found ${estimates.length} estimates to import`);

    for (const estimate of estimates) {
      for (const line of estimate.Line) {
        if (line.DetailType !== 'SalesItemLineDetail') continue;
        if (!line.Description) {
          result.skipped++;
          continue;
        }

        const parsed = parseDescription(line.Description);

        // Look up sign type and material IDs
        const signType = parsed.signType ? await findSignTypeByName(parsed.signType) : null;
        const material = parsed.material ? await findMaterialByName(parsed.material) : null;

        try {
          await recordPricingHistory({
            signTypeId: signType?.id,
            materialId: material?.id,
            description: parsed.description,
            widthInches: parsed.width,
            heightInches: parsed.height,
            quantity: line.SalesItemLineDetail?.Qty || 1,
            unitPrice: line.SalesItemLineDetail?.UnitPrice || line.Amount,
            totalPrice: line.Amount,
            outcome: 'pending', // We don't know from estimates alone
            quickbooksEstimateId: estimate.Id,
          });
          result.imported++;
        } catch (error) {
          console.error('Failed to import line item:', error);
          result.errors++;
        }
      }
    }

    console.log(`Import complete: ${result.imported} imported, ${result.skipped} skipped, ${result.errors} errors`);
    return result;
  } catch (error) {
    console.error('Failed to import historical estimates:', error);
    throw error;
  }
}
```

**Step 2: Add import route to setup.ts**

Add to `src/routes/setup.ts`:
```typescript
import { importHistoricalEstimates } from '../modules/quickbooks/import.js';

// Add inside setupRoutes function:

  // Import historical estimates from QuickBooks
  fastify.post('/setup/quickbooks/import', async (request, reply) => {
    try {
      const result = await importHistoricalEstimates();

      await sendSimpleMessage(
        `✅ QuickBooks import complete\n\nImported: ${result.imported}\nSkipped: ${result.skipped}\nErrors: ${result.errors}`
      );

      return reply.send(result);
    } catch (error) {
      console.error('Import failed:', error);
      return reply.status(500).send({ error: String(error) });
    }
  });
```

**Step 3: Update quickbooks/index.ts exports**

Add to `src/modules/quickbooks/index.ts`:
```typescript
export { importHistoricalEstimates, type ImportResult } from './import.js';
```

**Step 4: Verify build passes**

Run: `npm run build`
Expected: Success

**Step 5: Commit**

```bash
git add src/modules/quickbooks/import.ts src/routes/setup.ts src/modules/quickbooks/index.ts
git commit -m "feat: add QuickBooks historical estimate import"
```

---

## Task 16: Integration Test & Final Tag

**Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 2: Build project**

Run: `npm run build`
Expected: Success

**Step 3: Manual integration test**

1. Start server: `npm run dev`
2. Authorize QuickBooks: `http://localhost:3000/auth/quickbooks/authorize`
3. Import history: `curl -X POST http://localhost:3000/setup/quickbooks/import`
4. Process a test email with `/dev/process-email`
5. Verify priced estimate appears in Telegram
6. Test approve/edit/reject buttons
7. Check estimate created in QuickBooks

**Step 4: Final commit and tag**

```bash
git add -A
git commit -m "feat: complete Phase 2 QuickBooks integration"
git tag -a v0.2.0 -m "Phase 2: QuickBooks integration with AI-powered pricing"
```

---

## Success Criteria

Phase 2 is complete when:

- [ ] QuickBooks OAuth flow works
- [ ] Historical estimates imported and parsed
- [ ] Telegram shows suggested prices with confidence
- [ ] User can edit prices inline in Telegram
- [ ] Approve creates estimate in QuickBooks
- [ ] Win/lose commands update pricing history
- [ ] All tests pass

---

## Production Considerations

### Customer Matching

The current implementation uses simple name matching for QuickBooks customers. For production:
- Add `quickbooks_customer_id` to contacts table
- Create a setup step to map contacts to QuickBooks customers
- Handle case when customer doesn't exist (create or notify)

### Pricing Import Quality

The description parser is basic. Consider:
- Adding manual categorization UI
- Training a simple classifier on your data
- Allowing manual corrections that improve parsing

### Rate Limiting

QuickBooks API has rate limits. For high-volume:
- Add request queuing
- Implement exponential backoff
- Cache customer lookups
