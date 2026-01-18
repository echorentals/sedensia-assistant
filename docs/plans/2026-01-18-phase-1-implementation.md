# Phase 1: Email Monitoring & Telegram Notifications - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Detect estimate requests from Samsung contacts via Gmail and notify the user via Telegram with AI-parsed summaries.

**Architecture:** Fastify server receives Gmail Pub/Sub webhooks, fetches email content via Gmail API with automatic token refresh, parses with Claude API, and sends formatted notifications via Telegraf bot.

**Tech Stack:** TypeScript, Fastify, Telegraf, Supabase (PostgreSQL), Gmail API, Google Cloud Pub/Sub, Anthropic Claude API

---

## Prerequisites

Before starting, you need:
1. Google Cloud project with Gmail API and Pub/Sub enabled
2. Supabase project created
3. Telegram bot created via @BotFather
4. Anthropic API key

---

## Important Notes

### Model Versioning
The Claude model string `claude-sonnet-4-5-20250929` is used in this plan. Verify the current model version at implementation time via the [Anthropic docs](https://docs.anthropic.com/en/docs/about-claude/models) and update if needed.

### Development vs Production
Phase 1 uses a `/dev/process-email` endpoint for manual testing. For production:
- Set up Gmail Pub/Sub watch (Task 13.5 below)
- Track `historyId` to fetch only new messages efficiently
- Add rate limiting for API calls

---

## Task 1: Project Initialization

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `.gitignore`

**Step 1: Initialize npm project**

Run:
```bash
npm init -y
```

**Step 2: Install dependencies**

Run:
```bash
npm install fastify @fastify/cors @supabase/supabase-js telegraf googleapis @anthropic-ai/sdk zod dotenv
```

Run:
```bash
npm install -D typescript @types/node tsx vitest
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Update package.json scripts**

Add to `package.json`:
```json
{
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest",
    "test:run": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

**Step 5: Create .env.example**

```bash
# Server
PORT=3000
NODE_ENV=development

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxx

# Gmail OAuth
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/gmail/callback

# Telegram
TELEGRAM_BOT_TOKEN=xxx
TELEGRAM_ADMIN_CHAT_ID=xxx

# Anthropic
ANTHROPIC_API_KEY=xxx

# Encryption (generate with: openssl rand -hex 32)
ENCRYPTION_KEY=xxx
```

**Step 6: Create .gitignore**

```
node_modules/
dist/
.env
*.log
.DS_Store
```

**Step 7: Commit**

```bash
git add -A
git commit -m "chore: initialize project with TypeScript and dependencies"
```

---

## Task 2: Configuration Module

**Files:**
- Create: `src/config/index.ts`
- Create: `src/config/env.ts`
- Test: `src/config/env.test.ts`

**Step 1: Write failing test for env validation**

Create `src/config/env.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

describe('env validation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws when required env vars are missing', async () => {
    process.env = {};
    await expect(import('./env.js')).rejects.toThrow();
  });

  it('parses valid env vars', async () => {
    process.env = {
      PORT: '3000',
      NODE_ENV: 'development',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-key',
      GOOGLE_CLIENT_ID: 'google-id',
      GOOGLE_CLIENT_SECRET: 'google-secret',
      GOOGLE_REDIRECT_URI: 'http://localhost:3000/auth/gmail/callback',
      TELEGRAM_BOT_TOKEN: 'bot-token',
      TELEGRAM_ADMIN_CHAT_ID: '123456',
      ANTHROPIC_API_KEY: 'anthropic-key',
      ENCRYPTION_KEY: 'a'.repeat(64),
    };

    const { env } = await import('./env.js');
    expect(env.PORT).toBe(3000);
    expect(env.SUPABASE_URL).toBe('https://test.supabase.co');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/config/env.test.ts`

Expected: FAIL (module not found)

**Step 3: Create env.ts**

Create `src/config/env.ts`:
```typescript
import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().url(),

  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_ADMIN_CHAT_ID: z.string().min(1),

  ANTHROPIC_API_KEY: z.string().min(1),

  ENCRYPTION_KEY: z.string().length(64, 'Must be 64 hex characters (32 bytes)'),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error('Invalid environment variables:');
  console.error(result.error.flatten().fieldErrors);
  throw new Error('Invalid environment variables');
}

export const env = result.data;
export type Env = z.infer<typeof envSchema>;
```

**Step 4: Create config/index.ts**

Create `src/config/index.ts`:
```typescript
export { env, type Env } from './env.js';
```

**Step 5: Run test to verify it passes**

Run: `npm test -- src/config/env.test.ts`

Expected: PASS

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add environment configuration with Zod validation"
```

---

## Task 3: Supabase Client & Database Schema

**Files:**
- Create: `src/db/client.ts`
- Create: `src/db/index.ts`
- Create: `supabase/migrations/001_initial_schema.sql`

**Step 1: Create Supabase client**

Create `src/db/client.ts`:
```typescript
import { createClient } from '@supabase/supabase-js';
import { env } from '../config/index.js';

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
```

**Step 2: Create db/index.ts**

Create `src/db/index.ts`:
```typescript
export { supabase } from './client.js';
```

**Step 3: Create initial migration**

Create `supabase/migrations/001_initial_schema.sql`:
```sql
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Contacts table: configurable client contacts to monitor
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  company TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- OAuth tokens table: persistent storage for Gmail/QuickBooks tokens
CREATE TABLE oauth_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider TEXT NOT NULL CHECK (provider IN ('gmail', 'quickbooks')),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_type TEXT DEFAULT 'Bearer',
  expires_at TIMESTAMPTZ NOT NULL,
  scope TEXT,
  realm_id TEXT, -- QuickBooks company ID, null for Gmail
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(provider, realm_id)
);

-- Index for quick token lookups
CREATE INDEX idx_oauth_tokens_provider ON oauth_tokens(provider);
CREATE INDEX idx_oauth_tokens_expires_at ON oauth_tokens(expires_at);

-- Contacts index for email lookup
CREATE INDEX idx_contacts_email ON contacts(email);
CREATE INDEX idx_contacts_is_active ON contacts(is_active);

-- Insert initial Samsung contact
INSERT INTO contacts (name, email, company, is_active)
VALUES ('Minseok Kim', 'minseoks.kim@samsung.com', 'Samsung Taylor', true);
```

**Step 4: Apply migration via Supabase MCP**

Use Supabase MCP tool to apply the migration to your project.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Supabase client and initial database schema"
```

---

## Task 4: Encryption Utilities

**Files:**
- Create: `src/utils/encryption.ts`
- Test: `src/utils/encryption.test.ts`

**Step 1: Write failing test for encryption**

Create `src/utils/encryption.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock env before importing encryption
vi.mock('../config/index.js', () => ({
  env: {
    ENCRYPTION_KEY: 'a'.repeat(64), // 64 hex chars = 32 bytes
  },
}));

describe('encryption', () => {
  it('encrypts and decrypts a string', async () => {
    const { encrypt, decrypt } = await import('./encryption.js');

    const original = 'my-secret-token';
    const encrypted = encrypt(original);

    expect(encrypted).not.toBe(original);
    expect(encrypted).toContain(':'); // IV:ciphertext format

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  it('produces different ciphertext for same input', async () => {
    const { encrypt } = await import('./encryption.js');

    const original = 'my-secret-token';
    const encrypted1 = encrypt(original);
    const encrypted2 = encrypt(original);

    expect(encrypted1).not.toBe(encrypted2); // Different IVs
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/utils/encryption.test.ts`

Expected: FAIL (module not found)

**Step 3: Create encryption.ts**

Create `src/utils/encryption.ts`:
```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  return Buffer.from(env.ENCRYPTION_KEY, 'hex');
}

export function encrypt(text: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

export function decrypt(encryptedText: string): string {
  const [ivHex, authTagHex, ciphertext] = encryptedText.split(':');

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/utils/encryption.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add AES-256-GCM encryption utilities for token storage"
```

---

## Task 5: Telegram Bot Setup

**Files:**
- Create: `src/modules/telegram/bot.ts`
- Create: `src/modules/telegram/index.ts`
- Test: `src/modules/telegram/bot.test.ts`

**Step 1: Write failing test for bot initialization**

Create `src/modules/telegram/bot.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/index.js', () => ({
  env: {
    TELEGRAM_BOT_TOKEN: 'test-bot-token',
    TELEGRAM_ADMIN_CHAT_ID: '123456789',
  },
}));

describe('telegram bot', () => {
  it('exports bot instance and sendNotification function', async () => {
    const telegram = await import('./index.js');

    expect(telegram.bot).toBeDefined();
    expect(telegram.sendNotification).toBeDefined();
    expect(typeof telegram.sendNotification).toBe('function');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/modules/telegram/bot.test.ts`

Expected: FAIL (module not found)

**Step 3: Create bot.ts**

Create `src/modules/telegram/bot.ts`:
```typescript
import { Telegraf, Markup } from 'telegraf';
import { env } from '../../config/index.js';

export const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);

export interface EstimateRequestNotification {
  from: string;
  company: string;
  subject: string;
  items: Array<{
    signType: string;
    quantity: number;
    size: string;
  }>;
  specialRequests: string[];
  gmailMessageId: string;
}

export async function sendNotification(notification: EstimateRequestNotification): Promise<void> {
  const itemsList = notification.items
    .map((item) => `• ${item.signType} - ${item.quantity} pcs - ${item.size}`)
    .join('\n');

  const specialRequestsList = notification.specialRequests.length > 0
    ? `\n\nSpecial Requests:\n${notification.specialRequests.map((r) => `• ${r}`).join('\n')}`
    : '';

  const message = `📬 New Estimate Request from ${notification.company}

From: ${notification.from}
Subject: ${notification.subject}

Signs Requested:
${itemsList}${specialRequestsList}`;

  await bot.telegram.sendMessage(
    env.TELEGRAM_ADMIN_CHAT_ID,
    message,
    Markup.inlineKeyboard([
      [
        Markup.button.url('View Email', `https://mail.google.com/mail/u/0/#inbox/${notification.gmailMessageId}`),
        Markup.button.callback('Create Estimate', `create_estimate:${notification.gmailMessageId}`),
      ],
    ])
  );
}

export async function sendAuthAlert(provider: 'gmail' | 'quickbooks', authUrl: string): Promise<void> {
  const providerName = provider === 'gmail' ? 'Gmail' : 'QuickBooks';

  await bot.telegram.sendMessage(
    env.TELEGRAM_ADMIN_CHAT_ID,
    `⚠️ ${providerName} authorization expired\n\n${providerName} access has been revoked or expired.\nPlease re-authorize to continue.`,
    Markup.inlineKeyboard([
      [Markup.button.url(`Re-authorize ${providerName}`, authUrl)],
    ])
  );
}

export async function sendSimpleMessage(message: string): Promise<void> {
  await bot.telegram.sendMessage(env.TELEGRAM_ADMIN_CHAT_ID, message);
}
```

**Step 4: Create telegram/index.ts**

Create `src/modules/telegram/index.ts`:
```typescript
export { bot, sendNotification, sendAuthAlert, sendSimpleMessage } from './bot.js';
export type { EstimateRequestNotification } from './bot.js';
```

**Step 5: Run test to verify it passes**

Run: `npm test -- src/modules/telegram/bot.test.ts`

Expected: PASS

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add Telegram bot with notification formatting"
```

---

## Task 6: Gmail OAuth Token Management

**Files:**
- Create: `src/modules/gmail/tokens.ts`
- Create: `src/modules/gmail/client.ts`
- Test: `src/modules/gmail/tokens.test.ts`

**Step 1: Write failing test for token management**

Create `src/modules/gmail/tokens.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/index.js', () => ({
  env: {
    ENCRYPTION_KEY: 'a'.repeat(64),
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    GOOGLE_REDIRECT_URI: 'http://localhost:3000/auth/gmail/callback',
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

describe('gmail tokens', () => {
  it('exports getGmailTokens and saveGmailTokens', async () => {
    const tokens = await import('./tokens.js');

    expect(tokens.getGmailTokens).toBeDefined();
    expect(tokens.saveGmailTokens).toBeDefined();
  });

  it('getGmailTokens returns null when no tokens exist', async () => {
    const { getGmailTokens } = await import('./tokens.js');
    const result = await getGmailTokens();
    expect(result).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/modules/gmail/tokens.test.ts`

Expected: FAIL (module not found)

**Step 3: Create tokens.ts**

Create `src/modules/gmail/tokens.ts`:
```typescript
import { supabase } from '../../db/index.js';
import { encrypt, decrypt } from '../../utils/encryption.js';

export interface GmailTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string;
}

export async function getGmailTokens(): Promise<GmailTokens | null> {
  const { data, error } = await supabase
    .from('oauth_tokens')
    .select('*')
    .eq('provider', 'gmail')
    .single();

  if (error || !data) {
    return null;
  }

  return {
    accessToken: decrypt(data.access_token),
    refreshToken: decrypt(data.refresh_token),
    expiresAt: new Date(data.expires_at),
    scope: data.scope,
  };
}

export async function saveGmailTokens(tokens: GmailTokens): Promise<void> {
  const { error } = await supabase
    .from('oauth_tokens')
    .upsert({
      provider: 'gmail',
      access_token: encrypt(tokens.accessToken),
      refresh_token: encrypt(tokens.refreshToken),
      expires_at: tokens.expiresAt.toISOString(),
      scope: tokens.scope,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'provider,realm_id',
    });

  if (error) {
    throw new Error(`Failed to save Gmail tokens: ${error.message}`);
  }
}

export function isTokenExpired(expiresAt: Date, bufferMinutes = 5): boolean {
  const bufferMs = bufferMinutes * 60 * 1000;
  return new Date(Date.now() + bufferMs) >= expiresAt;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/modules/gmail/tokens.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Gmail token management with encryption"
```

---

## Task 7: Gmail API Client with Auto-Refresh

**Files:**
- Create: `src/modules/gmail/client.ts`
- Create: `src/modules/gmail/index.ts`

**Step 1: Create Gmail client with token refresh**

Create `src/modules/gmail/client.ts`:
```typescript
import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { env } from '../../config/index.js';
import { getGmailTokens, saveGmailTokens, isTokenExpired } from './tokens.js';
import { sendAuthAlert } from '../telegram/index.js';

let oauth2Client: OAuth2Client | null = null;
let gmailClient: gmail_v1.Gmail | null = null;

function getOAuth2Client(): OAuth2Client {
  if (!oauth2Client) {
    oauth2Client = new google.auth.OAuth2(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      env.GOOGLE_REDIRECT_URI
    );
  }
  return oauth2Client;
}

export function getAuthUrl(): string {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',
    ],
  });
}

export async function handleAuthCallback(code: string): Promise<void> {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);

  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error('Missing tokens from OAuth response');
  }

  await saveGmailTokens({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: new Date(tokens.expiry_date || Date.now() + 3600 * 1000),
    scope: tokens.scope || '',
  });

  // Reset cached client to pick up new tokens
  gmailClient = null;
}

async function refreshTokenIfNeeded(): Promise<boolean> {
  const tokens = await getGmailTokens();

  if (!tokens) {
    const authUrl = getAuthUrl();
    await sendAuthAlert('gmail', authUrl);
    return false;
  }

  if (!isTokenExpired(tokens.expiresAt)) {
    return true;
  }

  // Token is expired, refresh it
  const client = getOAuth2Client();
  client.setCredentials({
    refresh_token: tokens.refreshToken,
  });

  try {
    const { credentials } = await client.refreshAccessToken();

    if (!credentials.access_token) {
      throw new Error('No access token returned');
    }

    await saveGmailTokens({
      accessToken: credentials.access_token,
      refreshToken: tokens.refreshToken, // Keep existing refresh token
      expiresAt: new Date(credentials.expiry_date || Date.now() + 3600 * 1000),
      scope: credentials.scope || tokens.scope,
    });

    // Reset cached client
    gmailClient = null;
    return true;
  } catch (error) {
    console.error('Failed to refresh Gmail token:', error);
    const authUrl = getAuthUrl();
    await sendAuthAlert('gmail', authUrl);
    return false;
  }
}

export async function getGmailClient(): Promise<gmail_v1.Gmail | null> {
  const hasValidToken = await refreshTokenIfNeeded();

  if (!hasValidToken) {
    return null;
  }

  if (gmailClient) {
    return gmailClient;
  }

  const tokens = await getGmailTokens();
  if (!tokens) {
    return null;
  }

  const client = getOAuth2Client();
  client.setCredentials({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });

  gmailClient = google.gmail({ version: 'v1', auth: client });
  return gmailClient;
}

export async function getMessage(messageId: string): Promise<gmail_v1.Schema$Message | null> {
  const gmail = await getGmailClient();
  if (!gmail) return null;

  const response = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  return response.data;
}

export function extractEmailContent(message: gmail_v1.Schema$Message): {
  from: string;
  subject: string;
  body: string;
} {
  const headers = message.payload?.headers || [];

  const from = headers.find((h) => h.name?.toLowerCase() === 'from')?.value || '';
  const subject = headers.find((h) => h.name?.toLowerCase() === 'subject')?.value || '';

  // Extract body from parts
  let body = '';

  function extractText(part: gmail_v1.Schema$MessagePart): string {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return Buffer.from(part.body.data, 'base64').toString('utf-8');
    }
    if (part.parts) {
      return part.parts.map(extractText).join('\n');
    }
    return '';
  }

  if (message.payload) {
    body = extractText(message.payload);
  }

  return { from, subject, body };
}
```

**Step 2: Create gmail/index.ts**

Create `src/modules/gmail/index.ts`:
```typescript
export {
  getAuthUrl,
  handleAuthCallback,
  getGmailClient,
  getMessage,
  extractEmailContent,
} from './client.js';
export { getGmailTokens, saveGmailTokens } from './tokens.js';
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add Gmail API client with automatic token refresh"
```

---

## Task 8: AI Email Parser

**Files:**
- Create: `src/modules/ai/parser.ts`
- Create: `src/modules/ai/index.ts`
- Test: `src/modules/ai/parser.test.ts`

**Step 1: Write failing test for email parser**

Create `src/modules/ai/parser.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/index.js', () => ({
  env: {
    ANTHROPIC_API_KEY: 'test-api-key',
  },
}));

describe('ai parser', () => {
  it('exports parseEstimateRequest function', async () => {
    const parser = await import('./parser.js');
    expect(parser.parseEstimateRequest).toBeDefined();
    expect(typeof parser.parseEstimateRequest).toBe('function');
  });

  it('exports ParsedEstimateRequest type', async () => {
    const parser = await import('./parser.js');
    // Type exists if module loads without error
    expect(parser).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/modules/ai/parser.test.ts`

Expected: FAIL (module not found)

**Step 3: Create parser.ts**

Create `src/modules/ai/parser.ts`:
```typescript
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { env } from '../../config/index.js';

const client = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
});

export const ParsedEstimateRequestSchema = z.object({
  intent: z.enum(['new_request', 'status_inquiry', 'reorder', 'approval', 'general']),
  items: z.array(z.object({
    signType: z.string(),
    quantity: z.number(),
    size: z.string(),
    description: z.string().optional(),
  })),
  specialRequests: z.array(z.string()),
  urgency: z.enum(['normal', 'urgent', 'rush']).optional(),
  referencedJobDescription: z.string().optional(),
});

export type ParsedEstimateRequest = z.infer<typeof ParsedEstimateRequestSchema>;

const SYSTEM_PROMPT = `You are an AI assistant that parses estimate request emails for a sign fabrication company.

Extract the following information from the email:
1. Intent: Is this a new estimate request, a status inquiry about an existing job, a reorder of previous signs, an approval of a quote, or a general message?
2. Items: List each sign type requested with quantity and size
3. Special Requests: Any specific requirements like colors (PMS codes), materials, deadlines
4. Urgency: normal, urgent, or rush based on language used
5. Referenced Job: If this is a status inquiry or reorder, what job/sign are they referring to?

Respond with valid JSON matching this schema:
{
  "intent": "new_request" | "status_inquiry" | "reorder" | "approval" | "general",
  "items": [{ "signType": string, "quantity": number, "size": string, "description": string }],
  "specialRequests": string[],
  "urgency": "normal" | "urgent" | "rush",
  "referencedJobDescription": string | null
}`;

export async function parseEstimateRequest(email: {
  from: string;
  subject: string;
  body: string;
}): Promise<ParsedEstimateRequest> {
  const userMessage = `From: ${email.from}
Subject: ${email.subject}

${email.body}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const textContent = response.content.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  // Extract JSON from response (handle markdown code blocks)
  let jsonStr = textContent.text;
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  }

  const parsed = JSON.parse(jsonStr.trim());
  return ParsedEstimateRequestSchema.parse(parsed);
}
```

**Step 4: Create ai/index.ts**

Create `src/modules/ai/index.ts`:
```typescript
export { parseEstimateRequest, ParsedEstimateRequestSchema } from './parser.js';
export type { ParsedEstimateRequest } from './parser.js';
```

**Step 5: Run test to verify it passes**

Run: `npm test -- src/modules/ai/parser.test.ts`

Expected: PASS

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add Claude-powered email parser for estimate requests"
```

---

## Task 9: Contacts Repository

**Files:**
- Create: `src/db/contacts.ts`
- Test: `src/db/contacts.test.ts`

**Step 1: Write failing test**

Create `src/db/contacts.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('./client.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() => Promise.resolve({
              data: { id: '1', name: 'Test', email: 'test@example.com', company: 'Test Co' },
              error: null,
            })),
          })),
        })),
      })),
    })),
  },
}));

describe('contacts repository', () => {
  it('exports findContactByEmail function', async () => {
    const contacts = await import('./contacts.js');
    expect(contacts.findContactByEmail).toBeDefined();
  });

  it('returns contact when email matches', async () => {
    const { findContactByEmail } = await import('./contacts.js');
    const contact = await findContactByEmail('test@example.com');
    expect(contact).not.toBeNull();
    expect(contact?.email).toBe('test@example.com');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/db/contacts.test.ts`

Expected: FAIL

**Step 3: Create contacts.ts**

Create `src/db/contacts.ts`:
```typescript
import { supabase } from './client.js';

export interface Contact {
  id: string;
  name: string;
  email: string;
  company: string | null;
  is_active: boolean;
  created_at: string;
}

export async function findContactByEmail(email: string): Promise<Contact | null> {
  // Extract email from "Name <email@domain.com>" format
  const emailMatch = email.match(/<(.+)>/) || [null, email];
  const cleanEmail = emailMatch[1]?.toLowerCase().trim();

  if (!cleanEmail) return null;

  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('email', cleanEmail)
    .eq('is_active', true)
    .single();

  if (error || !data) {
    return null;
  }

  return data as Contact;
}

export async function getAllActiveContacts(): Promise<Contact[]> {
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('is_active', true);

  if (error || !data) {
    return [];
  }

  return data as Contact[];
}
```

**Step 4: Update db/index.ts**

Update `src/db/index.ts`:
```typescript
export { supabase } from './client.js';
export { findContactByEmail, getAllActiveContacts } from './contacts.js';
export type { Contact } from './contacts.js';
```

**Step 5: Run test to verify it passes**

Run: `npm test -- src/db/contacts.test.ts`

Expected: PASS

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add contacts repository with email lookup"
```

---

## Task 10: Gmail Webhook Handler

**Files:**
- Create: `src/modules/gmail/webhook.ts`
- Create: `src/routes/webhooks.ts`

**Step 1: Create webhook handler**

Create `src/modules/gmail/webhook.ts`:
```typescript
import { getMessage, extractEmailContent } from './client.js';
import { findContactByEmail } from '../../db/index.js';
import { parseEstimateRequest } from '../ai/index.js';
import { sendNotification, sendSimpleMessage } from '../telegram/index.js';
import type { EstimateRequestNotification } from '../telegram/index.js';

export interface PubSubMessage {
  message: {
    data: string; // base64 encoded
    messageId: string;
    publishTime: string;
  };
  subscription: string;
}

interface GmailNotification {
  emailAddress: string;
  historyId: number;
}

export async function handleGmailWebhook(pubsubMessage: PubSubMessage): Promise<void> {
  // Decode the Pub/Sub message
  const data = Buffer.from(pubsubMessage.message.data, 'base64').toString('utf-8');
  const notification: GmailNotification = JSON.parse(data);

  console.log('Gmail notification received:', notification);

  // For now, we'll need to fetch recent messages
  // In production, you'd use historyId to get only new messages
  // This is a simplified implementation for Phase 1

  // Note: This webhook is triggered by Pub/Sub when new emails arrive
  // The actual message ID needs to be obtained via Gmail API history
  // For Phase 1, we'll handle this in the polling approach below
}

export async function processEmailMessage(messageId: string): Promise<boolean> {
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

  // Only send notification for new requests (Phase 1)
  if (parsed.intent === 'new_request') {
    const notification: EstimateRequestNotification = {
      from: contact.name,
      company: contact.company || '',
      subject,
      items: parsed.items,
      specialRequests: parsed.specialRequests,
      gmailMessageId: messageId,
    };

    await sendNotification(notification);
    console.log('Telegram notification sent');
    return true;
  }

  // For other intents, send a simple notification for now
  if (parsed.intent !== 'general') {
    await sendSimpleMessage(
      `📧 ${parsed.intent.replace('_', ' ')} from ${contact.name}\n\nSubject: ${subject}`
    );
  }

  return true;
}
```

**Step 2: Create webhooks routes**

Create `src/routes/webhooks.ts`:
```typescript
import { FastifyInstance } from 'fastify';
import { handleGmailWebhook, type PubSubMessage } from '../modules/gmail/webhook.js';

export async function webhookRoutes(fastify: FastifyInstance): Promise<void> {
  // Gmail Pub/Sub webhook
  fastify.post<{ Body: PubSubMessage }>('/webhooks/gmail', async (request, reply) => {
    try {
      await handleGmailWebhook(request.body);
      return reply.status(200).send({ ok: true });
    } catch (error) {
      console.error('Gmail webhook error:', error);
      // Always return 200 to Pub/Sub to prevent retries on processing errors
      return reply.status(200).send({ ok: false });
    }
  });

  // Health check
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });
}
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add Gmail webhook handler with email processing"
```

---

## Task 11: OAuth Routes

**Files:**
- Create: `src/routes/auth.ts`

**Step 1: Create auth routes**

Create `src/routes/auth.ts`:
```typescript
import { FastifyInstance } from 'fastify';
import { getAuthUrl, handleAuthCallback } from '../modules/gmail/index.js';
import { sendSimpleMessage } from '../modules/telegram/index.js';

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // Gmail OAuth - initiate
  fastify.get('/auth/gmail/authorize', async (request, reply) => {
    const authUrl = getAuthUrl();
    return reply.redirect(authUrl);
  });

  // Gmail OAuth - callback
  fastify.get<{ Querystring: { code?: string; error?: string } }>(
    '/auth/gmail/callback',
    async (request, reply) => {
      const { code, error } = request.query;

      if (error) {
        return reply.status(400).send({ error: 'OAuth authorization failed', details: error });
      }

      if (!code) {
        return reply.status(400).send({ error: 'Missing authorization code' });
      }

      try {
        await handleAuthCallback(code);
        await sendSimpleMessage('✅ Gmail authorized successfully');

        return reply.type('text/html').send(`
          <!DOCTYPE html>
          <html>
            <head><title>Authorization Successful</title></head>
            <body style="font-family: sans-serif; text-align: center; padding: 50px;">
              <h1>✅ Gmail Authorized</h1>
              <p>You can close this window and return to Telegram.</p>
            </body>
          </html>
        `);
      } catch (err) {
        console.error('OAuth callback error:', err);
        return reply.status(500).send({ error: 'Failed to complete authorization' });
      }
    }
  );
}
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: add Gmail OAuth authorization routes"
```

---

## Task 12: Main Server Entry Point

**Files:**
- Create: `src/index.ts`

**Step 1: Create main server**

Create `src/index.ts`:
```typescript
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { env } from './config/index.js';
import { webhookRoutes } from './routes/webhooks.js';
import { authRoutes } from './routes/auth.js';
import { bot } from './modules/telegram/index.js';

async function main() {
  const fastify = Fastify({
    logger: true,
  });

  // Register plugins
  await fastify.register(cors, {
    origin: true,
  });

  // Register routes
  await fastify.register(webhookRoutes);
  await fastify.register(authRoutes);

  // Setup Telegram bot commands
  bot.command('start', (ctx) => {
    ctx.reply('Sedensia Assistant is running. I will notify you of new estimate requests.');
  });

  bot.command('status', (ctx) => {
    ctx.reply('✅ Bot is online and monitoring for estimate requests.');
  });

  // Handle callback queries (for future phases)
  bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (data?.startsWith('create_estimate:')) {
      const messageId = data.replace('create_estimate:', '');
      await ctx.answerCbQuery('Estimate creation will be available in Phase 2');
      await ctx.reply(`📋 Estimate creation for message ${messageId} - Coming in Phase 2!`);
    }
  });

  // Start Telegram bot (polling for development)
  if (env.NODE_ENV === 'development') {
    bot.launch();
    console.log('Telegram bot started in polling mode');
  }

  // Start HTTP server
  try {
    await fastify.listen({ port: env.PORT, host: '0.0.0.0' });
    console.log(`Server listening on port ${env.PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...');
    bot.stop('SIGTERM');
    await fastify.close();
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch(console.error);
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: add main server entry point with Fastify and Telegram bot"
```

---

## Task 13: Manual Test Email Endpoint (Development)

**Files:**
- Modify: `src/routes/webhooks.ts`

**Step 1: Add test endpoint for development**

Update `src/routes/webhooks.ts` to add a test endpoint:

```typescript
import { FastifyInstance } from 'fastify';
import { handleGmailWebhook, processEmailMessage, type PubSubMessage } from '../modules/gmail/webhook.js';
import { env } from '../config/index.js';

export async function webhookRoutes(fastify: FastifyInstance): Promise<void> {
  // Gmail Pub/Sub webhook
  fastify.post<{ Body: PubSubMessage }>('/webhooks/gmail', async (request, reply) => {
    try {
      await handleGmailWebhook(request.body);
      return reply.status(200).send({ ok: true });
    } catch (error) {
      console.error('Gmail webhook error:', error);
      return reply.status(200).send({ ok: false });
    }
  });

  // Development: manually trigger email processing
  if (env.NODE_ENV === 'development') {
    fastify.post<{ Body: { messageId: string } }>(
      '/dev/process-email',
      async (request, reply) => {
        const { messageId } = request.body;

        if (!messageId) {
          return reply.status(400).send({ error: 'messageId required' });
        }

        try {
          const processed = await processEmailMessage(messageId);
          return reply.send({ processed, messageId });
        } catch (error) {
          console.error('Email processing error:', error);
          return reply.status(500).send({ error: String(error) });
        }
      }
    );
  }

  // Health check
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });
}
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: add development endpoint for manual email processing"
```

---

## Task 13.5: Gmail Pub/Sub Watch Setup (Production)

> **Note:** This task sets up real-time email notifications. Skip for initial development testing, but required before production deployment.

**Files:**
- Create: `src/modules/gmail/watch.ts`
- Modify: `src/modules/gmail/index.ts`
- Create: `src/routes/setup.ts`
- Modify: `src/index.ts`

**Step 1: Add environment variable for Pub/Sub topic**

Add to `.env.example`:
```bash
# Gmail Pub/Sub (for production real-time notifications)
GMAIL_PUBSUB_TOPIC=projects/YOUR_PROJECT_ID/topics/gmail-notifications
```

Update `src/config/env.ts` to add:
```typescript
GMAIL_PUBSUB_TOPIC: z.string().optional(),
```

**Step 2: Create watch.ts for Pub/Sub watch management**

Create `src/modules/gmail/watch.ts`:
```typescript
import { getGmailClient } from './client.js';
import { supabase } from '../../db/index.js';
import { env } from '../../config/index.js';

interface WatchState {
  historyId: string;
  expiration: string;
}

export async function setupGmailWatch(): Promise<{ historyId: string; expiration: Date } | null> {
  if (!env.GMAIL_PUBSUB_TOPIC) {
    console.log('GMAIL_PUBSUB_TOPIC not configured, skipping watch setup');
    return null;
  }

  const gmail = await getGmailClient();
  if (!gmail) {
    console.error('Gmail client not available for watch setup');
    return null;
  }

  try {
    const response = await gmail.users.watch({
      userId: 'me',
      requestBody: {
        topicName: env.GMAIL_PUBSUB_TOPIC,
        labelIds: ['INBOX'],
      },
    });

    const historyId = response.data.historyId || '';
    const expiration = new Date(Number(response.data.expiration));

    // Store the historyId for incremental sync
    await saveWatchState({ historyId, expiration: expiration.toISOString() });

    console.log('Gmail watch established:', { historyId, expiration });
    return { historyId, expiration };
  } catch (error) {
    console.error('Failed to set up Gmail watch:', error);
    return null;
  }
}

export async function getWatchState(): Promise<WatchState | null> {
  const { data } = await supabase
    .from('app_state')
    .select('value')
    .eq('key', 'gmail_watch')
    .single();

  return data?.value as WatchState | null;
}

async function saveWatchState(state: WatchState): Promise<void> {
  await supabase
    .from('app_state')
    .upsert({
      key: 'gmail_watch',
      value: state,
      updated_at: new Date().toISOString(),
    });
}

export async function getNewMessagesSinceHistoryId(historyId: string): Promise<string[]> {
  const gmail = await getGmailClient();
  if (!gmail) return [];

  try {
    const response = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: historyId,
      historyTypes: ['messageAdded'],
    });

    const messageIds: string[] = [];
    for (const history of response.data.history || []) {
      for (const added of history.messagesAdded || []) {
        if (added.message?.id) {
          messageIds.push(added.message.id);
        }
      }
    }

    // Update stored historyId to latest
    if (response.data.historyId) {
      const state = await getWatchState();
      if (state) {
        await saveWatchState({
          ...state,
          historyId: response.data.historyId,
        });
      }
    }

    return messageIds;
  } catch (error) {
    console.error('Failed to fetch history:', error);
    return [];
  }
}
```

**Step 3: Add app_state table migration**

Create `supabase/migrations/002_app_state.sql`:
```sql
-- App state table for storing runtime state like Gmail watch historyId
CREATE TABLE app_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Step 4: Create setup routes**

Create `src/routes/setup.ts`:
```typescript
import { FastifyInstance } from 'fastify';
import { setupGmailWatch, getWatchState } from '../modules/gmail/watch.js';
import { sendSimpleMessage } from '../modules/telegram/index.js';

export async function setupRoutes(fastify: FastifyInstance): Promise<void> {
  // Set up Gmail Pub/Sub watch
  fastify.post('/setup/gmail-watch', async (request, reply) => {
    const result = await setupGmailWatch();

    if (result) {
      await sendSimpleMessage(
        `✅ Gmail watch established\n\nHistory ID: ${result.historyId}\nExpires: ${result.expiration.toISOString()}`
      );
      return reply.send({
        success: true,
        historyId: result.historyId,
        expiration: result.expiration,
      });
    }

    return reply.status(500).send({ success: false, error: 'Failed to set up watch' });
  });

  // Check current watch status
  fastify.get('/setup/gmail-watch/status', async (request, reply) => {
    const state = await getWatchState();

    if (!state) {
      return reply.send({ active: false });
    }

    const expiration = new Date(state.expiration);
    const isExpired = expiration < new Date();

    return reply.send({
      active: !isExpired,
      historyId: state.historyId,
      expiration: state.expiration,
      isExpired,
    });
  });
}
```

**Step 5: Update gmail/index.ts exports**

Add to `src/modules/gmail/index.ts`:
```typescript
export { setupGmailWatch, getWatchState, getNewMessagesSinceHistoryId } from './watch.js';
```

**Step 6: Register setup routes in main server**

Add to `src/index.ts`:
```typescript
import { setupRoutes } from './routes/setup.js';
// ... in main():
await fastify.register(setupRoutes);
```

**Step 7: Update webhook handler to use historyId**

Update `src/modules/gmail/webhook.ts` `handleGmailWebhook` function:
```typescript
import { getWatchState, getNewMessagesSinceHistoryId } from './watch.js';

export async function handleGmailWebhook(pubsubMessage: PubSubMessage): Promise<void> {
  const data = Buffer.from(pubsubMessage.message.data, 'base64').toString('utf-8');
  const notification: GmailNotification = JSON.parse(data);

  console.log('Gmail notification received:', notification);

  // Get stored state and fetch new messages since last historyId
  const state = await getWatchState();
  if (!state) {
    console.log('No watch state found, skipping');
    return;
  }

  const messageIds = await getNewMessagesSinceHistoryId(state.historyId);
  console.log(`Found ${messageIds.length} new messages`);

  // Process each new message
  for (const messageId of messageIds) {
    try {
      await processEmailMessage(messageId);
    } catch (error) {
      console.error(`Error processing message ${messageId}:`, error);
    }
  }
}
```

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: add Gmail Pub/Sub watch setup with historyId tracking"
```

---

## Task 14: Create .env from Example

**Step 1: Create your .env file**

Copy `.env.example` to `.env` and fill in your actual values:

```bash
cp .env.example .env
```

Edit `.env` with your actual credentials:
- Supabase URL and service role key from Supabase dashboard
- Google OAuth credentials from Google Cloud Console
- Telegram bot token from @BotFather
- Your Telegram chat ID (send `/start` to @userinfobot to get it)
- Anthropic API key
- Generate encryption key: `openssl rand -hex 32`

**Step 2: Test the server starts**

Run: `npm run dev`

Expected: Server starts on port 3000, Telegram bot launches

**Step 3: Test Telegram bot**

Send `/start` to your bot in Telegram.

Expected: Bot responds with welcome message

---

## Task 15: Integration Test

**Step 1: Authorize Gmail**

1. Open `http://localhost:3000/auth/gmail/authorize` in browser
2. Complete Google OAuth flow
3. Check Telegram for "✅ Gmail authorized successfully" message

**Step 2: Test email processing**

1. Get a message ID from your Gmail (from URL: `#inbox/MESSAGE_ID`)
2. Test the endpoint:

```bash
curl -X POST http://localhost:3000/dev/process-email \
  -H "Content-Type: application/json" \
  -d '{"messageId": "YOUR_MESSAGE_ID"}'
```

**Step 3: Verify Telegram notification**

If the email is from a monitored contact and contains an estimate request, you should receive a formatted notification in Telegram.

---

## Task 16: Final Commit & Tag

**Step 1: Final commit**

```bash
git add -A
git commit -m "docs: complete Phase 1 implementation"
```

**Step 2: Tag release**

```bash
git tag -a v0.1.0 -m "Phase 1: Email monitoring and Telegram notifications"
```

---

## Success Criteria

Phase 1 is complete when:

- [ ] Server starts without errors
- [ ] Gmail OAuth flow completes successfully
- [ ] Telegram bot responds to `/start` and `/status`
- [ ] Emails from monitored contacts trigger AI parsing
- [ ] New estimate requests generate formatted Telegram notifications
- [ ] Notifications include sign types, quantities, sizes, and special requests
- [ ] "Create Estimate" button appears (stub for Phase 2)

---

## Next Steps (Phase 2)

After Phase 1 is validated:
1. Set up Gmail Pub/Sub watch for real-time notifications
2. Implement QuickBooks OAuth and estimate creation
3. Add job/estimate database tables
4. Build pricing recommendation engine
5. Implement Telegram approval workflow

---

## Production Considerations

### Rate Limiting

Both Gmail API and Claude API have rate limits that could be hit during email bursts:

| API | Limit | Mitigation |
|-----|-------|------------|
| Gmail API | 250 quota units/user/second | Add exponential backoff, queue messages |
| Claude API | Varies by tier | Add request queue with delays between calls |

**Recommended:** Add a simple in-memory queue or use a job queue (e.g., BullMQ with Redis) for Phase 2 when handling multiple contacts.

### Gmail Watch Renewal

Gmail Pub/Sub watch expires after 7 days. Options:
1. **Cron job:** Call `/setup/gmail-watch` weekly via external scheduler
2. **Self-renewal:** Add a check on each webhook to renew if expiring within 24 hours
3. **Startup renewal:** Call `setupGmailWatch()` on server start

### Error Alerting

For production, consider adding:
- Telegram alerts for processing failures
- Structured logging (e.g., Pino with JSON output)
- Error tracking service (e.g., Sentry)

### Security Hardening

Before production:
- [ ] Restrict `/setup/*` routes to authenticated requests
- [ ] Validate Pub/Sub webhook signatures
- [ ] Enable RLS policies on Supabase tables
- [ ] Use environment-specific encryption keys
