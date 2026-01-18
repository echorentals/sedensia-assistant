# Phase 4: Status Inquiries & Reorder Requests - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Handle status inquiries and reorder requests from emails with AI-drafted responses for Telegram approval, supporting Korean and English languages.

**Architecture:** Expand the email processing pipeline to route by intent. Add a `telegram_users` table for language preferences. Implement job matching with fuzzy search. Create localized Telegram message templates and new callbacks for Send/Edit/Ignore actions. Add Gmail reply-to-thread capability.

**Tech Stack:** TypeScript, Supabase (PostgreSQL), Telegraf, Anthropic Claude API, Gmail API

---

## Task 1: Create telegram_users Table Migration

**Files:**
- Create: `supabase/migrations/20260118_create_telegram_users.sql`

**Step 1: Write the migration SQL**

Create the migration file:

```sql
-- Create telegram_users table for language preferences
CREATE TABLE telegram_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id TEXT NOT NULL UNIQUE,
  name TEXT,
  language TEXT NOT NULL DEFAULT 'ko' CHECK (language IN ('ko', 'en')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookup by telegram_id
CREATE INDEX idx_telegram_users_telegram_id ON telegram_users(telegram_id);

-- RLS policies
ALTER TABLE telegram_users ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role has full access to telegram_users"
  ON telegram_users
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
```

**Step 2: Apply migration via Supabase MCP**

Run the migration using the Supabase MCP tool `apply_migration`.

**Step 3: Verify table exists**

Run SQL query: `SELECT * FROM telegram_users LIMIT 1;`

**Step 4: Commit**

```bash
git add supabase/migrations/20260118_create_telegram_users.sql
git commit -m "feat: add telegram_users table for language preferences"
```

---

## Task 2: Create telegram_users Database Module

**Files:**
- Create: `src/db/telegram-users.ts`
- Create: `src/db/telegram-users.test.ts`
- Modify: `src/db/index.ts`

**Step 1: Write the failing test**

```typescript
// src/db/telegram-users.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./client.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(),
        })),
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(),
      })),
      upsert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(),
        })),
      })),
    })),
  },
}));

import { getTelegramUser, upsertTelegramUser, setUserLanguage } from './telegram-users.js';
import { supabase } from './client.js';

describe('telegram-users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getTelegramUser', () => {
    it('returns user when found', async () => {
      const mockUser = {
        id: 'uuid-123',
        telegram_id: '12345',
        name: 'Patrick',
        language: 'en',
        created_at: '2026-01-18T00:00:00Z',
        updated_at: '2026-01-18T00:00:00Z',
      };

      const mockSingle = vi.fn().mockResolvedValue({ data: mockUser, error: null });
      const mockEq = vi.fn().mockReturnValue({ single: mockSingle });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
      vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as any);

      const result = await getTelegramUser('12345');

      expect(result).toEqual(mockUser);
      expect(supabase.from).toHaveBeenCalledWith('telegram_users');
      expect(mockSelect).toHaveBeenCalledWith('*');
      expect(mockEq).toHaveBeenCalledWith('telegram_id', '12345');
    });

    it('returns null when user not found', async () => {
      const mockSingle = vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } });
      const mockEq = vi.fn().mockReturnValue({ single: mockSingle });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
      vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as any);

      const result = await getTelegramUser('99999');

      expect(result).toBeNull();
    });
  });

  describe('upsertTelegramUser', () => {
    it('creates new user with default Korean language', async () => {
      const mockUser = {
        id: 'uuid-123',
        telegram_id: '12345',
        name: 'Test User',
        language: 'ko',
        created_at: '2026-01-18T00:00:00Z',
        updated_at: '2026-01-18T00:00:00Z',
      };

      const mockSingle = vi.fn().mockResolvedValue({ data: mockUser, error: null });
      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
      const mockUpsert = vi.fn().mockReturnValue({ select: mockSelect });
      vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as any);

      const result = await upsertTelegramUser('12345', 'Test User');

      expect(result).toEqual(mockUser);
      expect(mockUpsert).toHaveBeenCalledWith(
        { telegram_id: '12345', name: 'Test User', updated_at: expect.any(String) },
        { onConflict: 'telegram_id' }
      );
    });
  });

  describe('setUserLanguage', () => {
    it('updates user language preference', async () => {
      const mockEq = vi.fn().mockResolvedValue({ error: null });
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
      vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as any);

      const result = await setUserLanguage('12345', 'en');

      expect(result).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith({
        language: 'en',
        updated_at: expect.any(String),
      });
      expect(mockEq).toHaveBeenCalledWith('telegram_id', '12345');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/db/telegram-users.test.ts`
Expected: FAIL with "Cannot find module './telegram-users.js'"

**Step 3: Write the implementation**

```typescript
// src/db/telegram-users.ts
import { supabase } from './client.js';

export interface TelegramUser {
  id: string;
  telegram_id: string;
  name: string | null;
  language: 'ko' | 'en';
  created_at: string;
  updated_at: string;
}

export async function getTelegramUser(telegramId: string): Promise<TelegramUser | null> {
  const { data, error } = await supabase
    .from('telegram_users')
    .select('*')
    .eq('telegram_id', telegramId)
    .single();

  if (error || !data) {
    return null;
  }

  return data as TelegramUser;
}

export async function upsertTelegramUser(
  telegramId: string,
  name?: string
): Promise<TelegramUser | null> {
  const { data, error } = await supabase
    .from('telegram_users')
    .upsert(
      {
        telegram_id: telegramId,
        name: name || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'telegram_id' }
    )
    .select()
    .single();

  if (error) {
    console.error('Failed to upsert telegram user:', error);
    return null;
  }

  return data as TelegramUser;
}

export async function setUserLanguage(
  telegramId: string,
  language: 'ko' | 'en'
): Promise<boolean> {
  const { error } = await supabase
    .from('telegram_users')
    .update({
      language,
      updated_at: new Date().toISOString(),
    })
    .eq('telegram_id', telegramId);

  if (error) {
    console.error('Failed to set user language:', error);
    return false;
  }

  return true;
}

export async function getUserLanguage(telegramId: string): Promise<'ko' | 'en'> {
  const user = await getTelegramUser(telegramId);
  return user?.language || 'ko';
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/db/telegram-users.test.ts`
Expected: PASS

**Step 5: Export from db/index.ts**

Add to `src/db/index.ts`:

```typescript
export {
  getTelegramUser,
  upsertTelegramUser,
  setUserLanguage,
  getUserLanguage,
  type TelegramUser,
} from './telegram-users.js';
```

**Step 6: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 7: Commit**

```bash
git add src/db/telegram-users.ts src/db/telegram-users.test.ts src/db/index.ts
git commit -m "feat: add telegram_users database module"
```

---

## Task 3: Add Language Detection to AI Parser

**Files:**
- Modify: `src/modules/ai/parser.ts`
- Modify: `src/modules/ai/parser.test.ts`

**Step 1: Update the schema to include language**

In `src/modules/ai/parser.ts`, update the schema:

```typescript
export const ParsedEstimateRequestSchema = z.object({
  intent: z.enum(['new_request', 'status_inquiry', 'reorder', 'approval', 'general']),
  language: z.enum(['ko', 'en']).default('en'),
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
  keywords: z.array(z.string()).default([]),
});
```

**Step 2: Update the system prompt**

Update SYSTEM_PROMPT to add:

```typescript
const SYSTEM_PROMPT = `You are an AI assistant that parses estimate request emails for a sign fabrication company.

Extract the following information from the email:
1. Intent: Is this a new estimate request, a status inquiry about an existing job, a reorder of previous signs, an approval of a quote, or a general message?
2. Language: Detect the primary language of the email - "ko" for Korean, "en" for English
3. Items: List each sign type requested with quantity, size, and material if mentioned
4. Special Requests: Any specific requirements like colors (PMS codes), deadlines, installation needs
5. Urgency: normal, urgent, or rush based on language used
6. Referenced Job: If this is a status inquiry or reorder, what job/sign are they referring to?
7. Keywords: Extract key search terms that could identify a specific job (e.g., "channel letters", "Taylor facility", "wayfinding signs")

Common sign types: Channel Letters, Monument Sign, Pylon Sign, Wall Sign, Wayfinding Sign, ADA Sign, Vinyl Graphics, Vehicle Wrap, Banner, A-Frame

Common materials: Aluminum, Acrylic, Dibond, PVC, Coroplast, HDU, Stainless Steel, Bronze

Respond with valid JSON matching this schema:
{
  "intent": "new_request" | "status_inquiry" | "reorder" | "approval" | "general",
  "language": "ko" | "en",
  "items": [{ "signType": string, "quantity": number, "size": string, "material": string | null, "description": string | null }],
  "specialRequests": string[],
  "urgency": "normal" | "urgent" | "rush" | null,
  "referencedJobDescription": string | null,
  "keywords": string[]
}`;
```

**Step 3: Add test for language detection**

Add to `src/modules/ai/parser.test.ts`:

```typescript
it('detects Korean language from email', async () => {
  const koreanResponse = {
    intent: 'status_inquiry' as const,
    language: 'ko' as const,
    items: [],
    specialRequests: [],
    keywords: ['채널 레터'],
    referencedJobDescription: '채널 레터',
  };

  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text: JSON.stringify(koreanResponse) }],
  });

  const result = await parseEstimateRequest({
    from: 'minseok@samsung.com',
    subject: '채널 레터 진행 상황',
    body: '채널 레터 진행 상황이 어떻게 되나요?',
  });

  expect(result.language).toBe('ko');
  expect(result.keywords).toContain('채널 레터');
});

it('detects English language from email', async () => {
  const englishResponse = {
    intent: 'status_inquiry' as const,
    language: 'en' as const,
    items: [],
    specialRequests: [],
    keywords: ['channel letters'],
    referencedJobDescription: 'channel letters',
  };

  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text: JSON.stringify(englishResponse) }],
  });

  const result = await parseEstimateRequest({
    from: 'minseok@samsung.com',
    subject: 'Channel Letters Status',
    body: 'What is the status on the channel letters?',
  });

  expect(result.language).toBe('en');
  expect(result.keywords).toContain('channel letters');
});

it('defaults language to en when not specified', async () => {
  const responseWithoutLanguage = {
    intent: 'general' as const,
    items: [],
    specialRequests: [],
  };

  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text: JSON.stringify(responseWithoutLanguage) }],
  });

  const result = await parseEstimateRequest(mockEmail);

  expect(result.language).toBe('en');
  expect(result.keywords).toEqual([]);
});
```

**Step 4: Run tests**

Run: `npm test -- src/modules/ai/parser.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/modules/ai/parser.ts src/modules/ai/parser.test.ts
git commit -m "feat: add language detection and keywords to AI parser"
```

---

## Task 4: Create Response Drafter Module

**Files:**
- Create: `src/modules/ai/drafter.ts`
- Create: `src/modules/ai/drafter.test.ts`
- Modify: `src/modules/ai/index.ts`

**Step 1: Write the failing test**

```typescript
// src/modules/ai/drafter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/index.js', () => ({
  env: {
    ANTHROPIC_API_KEY: 'test-api-key',
  },
}));

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: mockCreate,
      };
    },
  };
});

import { draftStatusResponse } from './drafter.js';

describe('drafter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('draftStatusResponse', () => {
    it('drafts Korean response for status inquiry', async () => {
      const koreanDraft = '안녕하세요 민석님,\n\n채널 레터 제작 현황 안내드립니다.\n현재 제작 중이며 1월 24일 완료 예정입니다.\n\n감사합니다,\n세덴시아 사인';

      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: koreanDraft }],
      });

      const result = await draftStatusResponse({
        language: 'ko',
        recipientName: '민석',
        jobDescription: 'Channel Letters (24"x18")',
        currentStage: 'in_production',
        eta: '2026-01-24',
      });

      expect(result).toContain('민석');
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: expect.stringContaining('Korean'),
            }),
          ]),
        })
      );
    });

    it('drafts English response for status inquiry', async () => {
      const englishDraft = 'Hi Minseok,\n\nHere\'s an update on the channel letters.\nCurrently in production, estimated completion Jan 24.\n\nBest regards,\nSedensia Signs';

      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: englishDraft }],
      });

      const result = await draftStatusResponse({
        language: 'en',
        recipientName: 'Minseok',
        jobDescription: 'Channel Letters (24"x18")',
        currentStage: 'in_production',
        eta: '2026-01-24',
      });

      expect(result).toContain('Minseok');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/modules/ai/drafter.test.ts`
Expected: FAIL

**Step 3: Write the implementation**

```typescript
// src/modules/ai/drafter.ts
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/index.js';

let client: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return client;
}

const STAGE_NAMES_KO: Record<string, string> = {
  pending: '대기 중',
  in_production: '제작 중',
  ready: '완료 (배송 대기)',
  installed: '설치 완료',
  completed: '완료',
};

const STAGE_NAMES_EN: Record<string, string> = {
  pending: 'Pending',
  in_production: 'In Production',
  ready: 'Ready for Delivery',
  installed: 'Installed',
  completed: 'Completed',
};

export interface StatusResponseInput {
  language: 'ko' | 'en';
  recipientName: string;
  jobDescription: string;
  currentStage: string;
  eta?: string | null;
}

export async function draftStatusResponse(input: StatusResponseInput): Promise<string> {
  const stageName = input.language === 'ko'
    ? STAGE_NAMES_KO[input.currentStage] || input.currentStage
    : STAGE_NAMES_EN[input.currentStage] || input.currentStage;

  const etaText = input.eta
    ? input.language === 'ko'
      ? `예상 완료일: ${input.eta}`
      : `Estimated completion: ${input.eta}`
    : '';

  const systemPrompt = input.language === 'ko'
    ? `You are writing a professional status update email in Korean for a sign fabrication company (세덴시아 사인).
Keep it concise and polite. Use formal Korean (존댓말).
Sign off with "감사합니다,\n세덴시아 사인"`
    : `You are writing a professional status update email in English for a sign fabrication company (Sedensia Signs).
Keep it concise and professional.
Sign off with "Best regards,\nSedensia Signs"`;

  const userMessage = input.language === 'ko'
    ? `Write a brief status update email to ${input.recipientName} about their order:
Job: ${input.jobDescription}
Status: ${stageName}
${etaText}

Keep it to 3-4 sentences maximum.`
    : `Write a brief status update email to ${input.recipientName} about their order:
Job: ${input.jobDescription}
Status: ${stageName}
${etaText}

Keep it to 3-4 sentences maximum.`;

  const response = await getAnthropicClient().messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 500,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const textContent = response.content.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from AI');
  }

  return textContent.text.trim();
}

export interface ReorderResponseInput {
  language: 'ko' | 'en';
  recipientName: string;
  previousOrderDescription: string;
  previousTotal: number;
}

export async function draftReorderConfirmation(input: ReorderResponseInput): Promise<string> {
  const systemPrompt = input.language === 'ko'
    ? `You are writing a professional email in Korean for a sign fabrication company (세덴시아 사인).
Keep it concise and polite. Use formal Korean (존댓말).
Sign off with "감사합니다,\n세덴시아 사인"`
    : `You are writing a professional email in English for a sign fabrication company (Sedensia Signs).
Keep it concise and professional.
Sign off with "Best regards,\nSedensia Signs"`;

  const userMessage = input.language === 'ko'
    ? `Write a brief email to ${input.recipientName} confirming we received their reorder request:
Previous order: ${input.previousOrderDescription}
Previous total: $${input.previousTotal.toLocaleString()}

Ask them to confirm they want the same items at the same price. Keep it to 3-4 sentences.`
    : `Write a brief email to ${input.recipientName} confirming we received their reorder request:
Previous order: ${input.previousOrderDescription}
Previous total: $${input.previousTotal.toLocaleString()}

Ask them to confirm they want the same items at the same price. Keep it to 3-4 sentences.`;

  const response = await getAnthropicClient().messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 500,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const textContent = response.content.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from AI');
  }

  return textContent.text.trim();
}
```

**Step 4: Run tests**

Run: `npm test -- src/modules/ai/drafter.test.ts`
Expected: PASS

**Step 5: Export from ai/index.ts**

Add to `src/modules/ai/index.ts`:

```typescript
export { parseEstimateRequest, type ParsedEstimateRequest } from './parser.js';
export { draftStatusResponse, draftReorderConfirmation, type StatusResponseInput, type ReorderResponseInput } from './drafter.js';
```

**Step 6: Commit**

```bash
git add src/modules/ai/drafter.ts src/modules/ai/drafter.test.ts src/modules/ai/index.ts
git commit -m "feat: add AI response drafter for status and reorder emails"
```

---

## Task 5: Create Job Matching Module

**Files:**
- Create: `src/modules/jobs/matcher.ts`
- Create: `src/modules/jobs/matcher.test.ts`
- Create: `src/modules/jobs/index.ts`

**Step 1: Write the failing test**

```typescript
// src/modules/jobs/matcher.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  getActiveJobs: vi.fn(),
  getRecentEstimates: vi.fn(),
}));

import { findMatchingJob, type JobMatch } from './matcher.js';
import { getActiveJobs, getRecentEstimates } from '../../db/index.js';

describe('job matcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('findMatchingJob', () => {
    const mockJobs = [
      {
        id: 'job-1',
        description: 'Channel Letters (24"x18") for Taylor Facility',
        stage: 'in_production',
        eta: '2026-01-24',
        contact_id: 'contact-samsung',
        total_amount: 3600,
        created_at: '2026-01-10T00:00:00Z',
      },
      {
        id: 'job-2',
        description: 'Wayfinding Signs (12"x8")',
        stage: 'pending',
        eta: null,
        contact_id: 'contact-samsung',
        total_amount: 960,
        created_at: '2026-01-05T00:00:00Z',
      },
      {
        id: 'job-3',
        description: 'Monument Sign for Other Company',
        stage: 'in_production',
        eta: null,
        contact_id: 'contact-other',
        total_amount: 5000,
        created_at: '2026-01-08T00:00:00Z',
      },
    ];

    it('finds job by keyword match and contact', async () => {
      vi.mocked(getActiveJobs).mockResolvedValue(mockJobs as any);

      const result = await findMatchingJob({
        contactId: 'contact-samsung',
        keywords: ['channel letters'],
      });

      expect(result).not.toBeNull();
      expect(result?.job.id).toBe('job-1');
      expect(result?.confidence).toBeGreaterThan(0.7);
    });

    it('filters by contact when provided', async () => {
      vi.mocked(getActiveJobs).mockResolvedValue(mockJobs as any);

      const result = await findMatchingJob({
        contactId: 'contact-samsung',
        keywords: ['monument sign'],
      });

      // Should not match job-3 because it belongs to different contact
      expect(result).toBeNull();
    });

    it('returns null when no keywords match', async () => {
      vi.mocked(getActiveJobs).mockResolvedValue(mockJobs as any);

      const result = await findMatchingJob({
        contactId: 'contact-samsung',
        keywords: ['banner', 'vinyl'],
      });

      expect(result).toBeNull();
    });

    it('prefers recent jobs over older ones', async () => {
      vi.mocked(getActiveJobs).mockResolvedValue(mockJobs as any);

      const result = await findMatchingJob({
        contactId: 'contact-samsung',
        keywords: ['signs'],
      });

      // Both job-1 and job-2 have "signs" but job-1 is more recent
      expect(result?.job.id).toBe('job-1');
    });

    it('returns multiple matches when requested', async () => {
      vi.mocked(getActiveJobs).mockResolvedValue(mockJobs as any);

      const results = await findMatchingJob({
        contactId: 'contact-samsung',
        keywords: ['signs'],
        maxResults: 3,
      });

      // This returns single best match, use findAllMatchingJobs for multiple
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/modules/jobs/matcher.test.ts`
Expected: FAIL

**Step 3: Write the implementation**

```typescript
// src/modules/jobs/matcher.ts
import { getActiveJobs, type Job } from '../../db/index.js';

export interface JobMatch {
  job: Job;
  confidence: number;
  matchedKeywords: string[];
}

export interface FindJobInput {
  contactId?: string;
  keywords: string[];
  maxResults?: number;
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9가-힣\s]/g, ' ').trim();
}

function calculateMatchScore(description: string, keywords: string[]): { score: number; matched: string[] } {
  const normalizedDesc = normalizeText(description);
  const matched: string[] = [];
  let score = 0;

  for (const keyword of keywords) {
    const normalizedKeyword = normalizeText(keyword);
    if (normalizedDesc.includes(normalizedKeyword)) {
      matched.push(keyword);
      // Longer keyword matches are more specific, so weight them higher
      score += normalizedKeyword.length / 10;
    }
  }

  // Normalize score to 0-1 range based on keyword coverage
  const maxPossibleScore = keywords.reduce((sum, k) => sum + normalizeText(k).length / 10, 0);
  const normalizedScore = maxPossibleScore > 0 ? score / maxPossibleScore : 0;

  return { score: normalizedScore, matched };
}

function getRecencyBonus(createdAt: string): number {
  const daysAgo = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
  // Jobs from last 30 days get bonus, decaying over 90 days
  if (daysAgo <= 30) return 0.2;
  if (daysAgo <= 60) return 0.1;
  if (daysAgo <= 90) return 0.05;
  return 0;
}

export async function findMatchingJob(input: FindJobInput): Promise<JobMatch | null> {
  const jobs = await getActiveJobs();

  if (!jobs.length || !input.keywords.length) {
    return null;
  }

  // Filter by contact if provided
  const filteredJobs = input.contactId
    ? jobs.filter(job => job.contact_id === input.contactId)
    : jobs;

  if (!filteredJobs.length) {
    return null;
  }

  // Score each job
  const scored: JobMatch[] = [];

  for (const job of filteredJobs) {
    const { score, matched } = calculateMatchScore(job.description, input.keywords);

    if (matched.length > 0) {
      const recencyBonus = getRecencyBonus(job.created_at);
      const confidence = Math.min(score + recencyBonus, 1);

      scored.push({
        job,
        confidence,
        matchedKeywords: matched,
      });
    }
  }

  if (!scored.length) {
    return null;
  }

  // Sort by confidence descending
  scored.sort((a, b) => b.confidence - a.confidence);

  return scored[0];
}

export async function findAllMatchingJobs(input: FindJobInput): Promise<JobMatch[]> {
  const jobs = await getActiveJobs();

  if (!jobs.length || !input.keywords.length) {
    return [];
  }

  const filteredJobs = input.contactId
    ? jobs.filter(job => job.contact_id === input.contactId)
    : jobs;

  const scored: JobMatch[] = [];

  for (const job of filteredJobs) {
    const { score, matched } = calculateMatchScore(job.description, input.keywords);

    if (matched.length > 0) {
      const recencyBonus = getRecencyBonus(job.created_at);
      const confidence = Math.min(score + recencyBonus, 1);

      scored.push({
        job,
        confidence,
        matchedKeywords: matched,
      });
    }
  }

  scored.sort((a, b) => b.confidence - a.confidence);

  const maxResults = input.maxResults || 3;
  return scored.slice(0, maxResults);
}
```

**Step 4: Create index file**

```typescript
// src/modules/jobs/index.ts
export { findMatchingJob, findAllMatchingJobs, type JobMatch, type FindJobInput } from './matcher.js';
```

**Step 5: Run tests**

Run: `npm test -- src/modules/jobs/matcher.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/modules/jobs/
git commit -m "feat: add job matching module with fuzzy search"
```

---

## Task 6: Create Localized Message Templates

**Files:**
- Create: `src/modules/telegram/i18n.ts`
- Create: `src/modules/telegram/i18n.test.ts`

**Step 1: Write the failing test**

```typescript
// src/modules/telegram/i18n.test.ts
import { describe, it, expect } from 'vitest';
import { t, formatStatusInquiry, formatReorderRequest } from './i18n.js';

describe('i18n', () => {
  describe('t (translate)', () => {
    it('returns Korean text for ko locale', () => {
      expect(t('ko', 'send')).toBe('보내기');
      expect(t('ko', 'edit')).toBe('수정');
      expect(t('ko', 'ignore')).toBe('무시');
    });

    it('returns English text for en locale', () => {
      expect(t('en', 'send')).toBe('Send');
      expect(t('en', 'edit')).toBe('Edit');
      expect(t('en', 'ignore')).toBe('Ignore');
    });
  });

  describe('formatStatusInquiry', () => {
    const mockData = {
      company: 'Samsung',
      from: 'Minseok Kim',
      subject: 'Channel Letters Progress',
      jobId: 'abc123',
      stage: 'in_production',
      eta: '2026-01-24',
      draftResponse: 'Hi Minseok, the channel letters are in production...',
    };

    it('formats Korean status inquiry message', () => {
      const result = formatStatusInquiry('ko', mockData);

      expect(result).toContain('❓ 상태 문의');
      expect(result).toContain('Samsung');
      expect(result).toContain('발신:');
      expect(result).toContain('제작 중');
    });

    it('formats English status inquiry message', () => {
      const result = formatStatusInquiry('en', mockData);

      expect(result).toContain('❓ Status Inquiry');
      expect(result).toContain('Samsung');
      expect(result).toContain('From:');
      expect(result).toContain('In Production');
    });
  });

  describe('formatReorderRequest', () => {
    const mockData = {
      company: 'Samsung',
      from: 'Minseok Kim',
      originalMessage: 'Can we get the same signs from last month?',
      previousOrderDate: '2025-12-15',
      items: [{ description: 'Wayfinding Signs (12"x8")', quantity: 8, unitPrice: 120, total: 960 }],
      total: 960,
    };

    it('formats Korean reorder message', () => {
      const result = formatReorderRequest('ko', mockData);

      expect(result).toContain('🔄 재주문 요청');
      expect(result).toContain('이전 주문');
      expect(result).toContain('$960');
    });

    it('formats English reorder message', () => {
      const result = formatReorderRequest('en', mockData);

      expect(result).toContain('🔄 Reorder Request');
      expect(result).toContain('Previous Order');
      expect(result).toContain('$960');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/modules/telegram/i18n.test.ts`
Expected: FAIL

**Step 3: Write the implementation**

```typescript
// src/modules/telegram/i18n.ts

type Locale = 'ko' | 'en';

const translations: Record<string, Record<Locale, string>> = {
  // Buttons
  send: { ko: '보내기', en: 'Send' },
  edit: { ko: '수정', en: 'Edit' },
  ignore: { ko: '무시', en: 'Ignore' },
  createEstimateSamePrice: { ko: '동일 가격으로 견적 생성', en: 'Create Estimate (Same Price)' },
  editPrices: { ko: '가격 수정', en: 'Edit Prices' },
  select: { ko: '선택', en: 'Select' },
  newEstimate: { ko: '새 견적으로 처리', en: 'Treat as New Estimate' },
  manualSearch: { ko: '수동 검색', en: 'Manual Search' },

  // Labels
  statusInquiry: { ko: '상태 문의', en: 'Status Inquiry' },
  reorderRequest: { ko: '재주문 요청', en: 'Reorder Request' },
  from: { ko: '발신', en: 'From' },
  subject: { ko: '제목', en: 'Subject' },
  matchedJob: { ko: '매칭된 작업', en: 'Matched Job' },
  currentStage: { ko: '현재 단계', en: 'Current Stage' },
  eta: { ko: '예상 완료', en: 'ETA' },
  draftResponse: { ko: '답변 초안', en: 'Draft Response' },
  previousOrder: { ko: '이전 주문', en: 'Previous Order' },
  unitPrice: { ko: '단가', en: 'Unit Price' },
  total: { ko: '총액', en: 'Total' },
  noMatchFound: { ko: '이전 주문을 찾을 수 없습니다', en: 'No previous order found' },
  multipleMatches: { ko: '여러 작업이 검색되었습니다', en: 'Multiple jobs found' },

  // Stages
  pending: { ko: '대기 중', en: 'Pending' },
  in_production: { ko: '제작 중', en: 'In Production' },
  ready: { ko: '완료 (배송 대기)', en: 'Ready for Delivery' },
  installed: { ko: '설치 완료', en: 'Installed' },
  completed: { ko: '완료', en: 'Completed' },

  // Language command
  languageSet: { ko: '언어가 한국어로 설정되었습니다.\n모든 알림이 한국어로 표시됩니다.', en: 'Language set to English.\nAll notifications will now be in English.' },
};

export function t(locale: Locale, key: string): string {
  return translations[key]?.[locale] || translations[key]?.['en'] || key;
}

export interface StatusInquiryData {
  company: string;
  from: string;
  subject: string;
  jobId: string;
  stage: string;
  eta?: string | null;
  draftResponse: string;
}

export function formatStatusInquiry(locale: Locale, data: StatusInquiryData): string {
  const stageName = t(locale, data.stage);
  const etaLine = data.eta ? `${t(locale, 'eta')}: ${data.eta}` : '';

  return `❓ ${t(locale, 'statusInquiry')} - ${data.company}

${t(locale, 'from')}: ${data.from}
${t(locale, 'subject')}: ${data.subject}

${t(locale, 'matchedJob')}: #${data.jobId.slice(0, 8)}
${t(locale, 'currentStage')}: ${stageName}
${etaLine}

━━━━━━━━━━━━━━━━━━
📝 ${t(locale, 'draftResponse')}:
"${data.draftResponse.slice(0, 150)}${data.draftResponse.length > 150 ? '...' : ''}"`;
}

export interface ReorderRequestData {
  company: string;
  from: string;
  originalMessage: string;
  previousOrderDate: string;
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
  total: number;
}

export function formatReorderRequest(locale: Locale, data: ReorderRequestData): string {
  const itemsList = data.items
    .map(item => `• ${item.description} × ${item.quantity} ... $${item.total.toLocaleString()}\n  ${t(locale, 'unitPrice')}: $${item.unitPrice.toLocaleString()}`)
    .join('\n');

  return `🔄 ${t(locale, 'reorderRequest')} - ${data.company}

${t(locale, 'from')}: ${data.from}
"${data.originalMessage}"

━━━━━━━━━━━━━━━━━━
📋 ${t(locale, 'previousOrder')} (${data.previousOrderDate}):
${itemsList}

${t(locale, 'total')}: $${data.total.toLocaleString()}`;
}

export function formatNoMatch(locale: Locale, searchTerms: string): string {
  return `❓ ${t(locale, 'statusInquiry')}

${t(locale, 'noMatchFound')}
"${searchTerms}" ${locale === 'ko' ? '검색 결과 없음' : 'no results'}`;
}

export interface MultipleMatchData {
  company: string;
  matches: Array<{
    jobId: string;
    description: string;
    date: string;
  }>;
}

export function formatMultipleMatches(locale: Locale, data: MultipleMatchData): string {
  const matchesList = data.matches
    .map((m, i) => `${i + 1}. #${m.jobId.slice(0, 8)} - ${m.description.slice(0, 30)} - ${m.date}`)
    .join('\n');

  return `❓ ${t(locale, 'statusInquiry')} - ${data.company}

${t(locale, 'multipleMatches')}:

${matchesList}`;
}
```

**Step 4: Run tests**

Run: `npm test -- src/modules/telegram/i18n.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/modules/telegram/i18n.ts src/modules/telegram/i18n.test.ts
git commit -m "feat: add localized message templates for Telegram"
```

---

## Task 7: Add /lang Command

**Files:**
- Modify: `src/modules/telegram/callbacks.ts`

**Step 1: Add the /lang command handler**

Add to `src/modules/telegram/callbacks.ts` in `setupOutcomeCommands()`:

```typescript
// Language preference command
bot.command('lang', async (ctx) => {
  const args = ctx.message.text.split(' ');
  const userId = ctx.from?.id.toString();

  if (!userId) {
    await ctx.reply('Could not identify user.');
    return;
  }

  if (args.length < 2) {
    const user = await getTelegramUser(userId);
    const currentLang = user?.language || 'ko';
    await ctx.reply(
      currentLang === 'ko'
        ? `현재 언어: 한국어\n\n사용법: /lang <ko|en>`
        : `Current language: English\n\nUsage: /lang <ko|en>`
    );
    return;
  }

  const lang = args[1].toLowerCase();
  if (lang !== 'ko' && lang !== 'en') {
    await ctx.reply('Invalid language. Use: /lang ko or /lang en');
    return;
  }

  // Ensure user exists
  await upsertTelegramUser(userId, ctx.from?.first_name);
  const success = await setUserLanguage(userId, lang);

  if (success) {
    const message = lang === 'ko'
      ? '✅ 언어가 한국어로 설정되었습니다.\n모든 알림이 한국어로 표시됩니다.'
      : '✅ Language set to English.\nAll notifications will now be in English.';
    await ctx.reply(message);
  } else {
    await ctx.reply('Failed to update language preference.');
  }
});
```

**Step 2: Add imports at top of callbacks.ts**

```typescript
import {
  getTelegramUser,
  upsertTelegramUser,
  setUserLanguage,
} from '../../db/index.js';
```

**Step 3: Test manually**

Start the bot and test `/lang ko` and `/lang en` commands.

**Step 4: Commit**

```bash
git add src/modules/telegram/callbacks.ts
git commit -m "feat: add /lang command for language preferences"
```

---

## Task 8: Add Gmail Reply-to-Thread Function

**Files:**
- Modify: `src/modules/gmail/client.ts`
- Create: `src/modules/gmail/client.reply.test.ts`

**Step 1: Write the failing test**

```typescript
// src/modules/gmail/client.reply.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({
        setCredentials: vi.fn(),
        generateAuthUrl: vi.fn(),
        getToken: vi.fn(),
        refreshAccessToken: vi.fn(),
      })),
    },
    gmail: vi.fn().mockReturnValue({
      users: {
        messages: {
          send: vi.fn(),
          get: vi.fn(),
        },
      },
    }),
  },
}));

vi.mock('./tokens.js', () => ({
  getGmailTokens: vi.fn().mockResolvedValue({
    accessToken: 'test-token',
    refreshToken: 'test-refresh',
    expiresAt: new Date(Date.now() + 3600000),
    scope: 'test',
  }),
  saveGmailTokens: vi.fn(),
  isTokenExpired: vi.fn().mockReturnValue(false),
}));

vi.mock('../telegram/index.js', () => ({
  sendAuthAlert: vi.fn(),
}));

vi.mock('../../config/index.js', () => ({
  env: {
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    GOOGLE_REDIRECT_URI: 'http://localhost:3000/auth/gmail/callback',
  },
}));

import { replyToThread } from './client.js';

describe('replyToThread', () => {
  it('should be a function', () => {
    expect(typeof replyToThread).toBe('function');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/modules/gmail/client.reply.test.ts`
Expected: FAIL (replyToThread not exported)

**Step 3: Add replyToThread function to client.ts**

Add to `src/modules/gmail/client.ts`:

```typescript
export interface ReplyOptions {
  threadId: string;
  messageId: string;
  to: string;
  subject: string;
  body: string;
  attachments?: Array<{
    filename: string;
    mimeType: string;
    data: Buffer;
  }>;
}

function createMimeMessage(options: ReplyOptions): string {
  const boundary = `boundary_${Date.now()}`;
  const hasAttachments = options.attachments && options.attachments.length > 0;

  let message = '';
  message += `From: me\r\n`;
  message += `To: ${options.to}\r\n`;
  message += `Subject: ${options.subject}\r\n`;
  message += `In-Reply-To: ${options.messageId}\r\n`;
  message += `References: ${options.messageId}\r\n`;

  if (hasAttachments) {
    message += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n`;
    message += `\r\n`;
    message += `--${boundary}\r\n`;
    message += `Content-Type: text/plain; charset="UTF-8"\r\n`;
    message += `\r\n`;
    message += `${options.body}\r\n`;

    for (const attachment of options.attachments!) {
      message += `--${boundary}\r\n`;
      message += `Content-Type: ${attachment.mimeType}; name="${attachment.filename}"\r\n`;
      message += `Content-Disposition: attachment; filename="${attachment.filename}"\r\n`;
      message += `Content-Transfer-Encoding: base64\r\n`;
      message += `\r\n`;
      message += `${attachment.data.toString('base64')}\r\n`;
    }

    message += `--${boundary}--\r\n`;
  } else {
    message += `Content-Type: text/plain; charset="UTF-8"\r\n`;
    message += `\r\n`;
    message += `${options.body}\r\n`;
  }

  return message;
}

export async function replyToThread(options: ReplyOptions): Promise<string | null> {
  const gmail = await getGmailClient();
  if (!gmail) return null;

  try {
    const rawMessage = createMimeMessage(options);
    const encodedMessage = Buffer.from(rawMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
        threadId: options.threadId,
      },
    });

    return response.data.id || null;
  } catch (error) {
    console.error('Failed to send reply:', error);
    return null;
  }
}

export async function getMessageThreadId(messageId: string): Promise<string | null> {
  const message = await getMessage(messageId);
  return message?.threadId || null;
}
```

**Step 4: Run tests**

Run: `npm test -- src/modules/gmail/client.reply.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/modules/gmail/client.ts src/modules/gmail/client.reply.test.ts
git commit -m "feat: add Gmail reply-to-thread function"
```

---

## Task 9: Create Status Inquiry Handler

**Files:**
- Create: `src/modules/email/handlers/status-inquiry.ts`
- Create: `src/modules/email/handlers/status-inquiry.test.ts`
- Create: `src/modules/email/index.ts`

**Step 1: Write the failing test**

```typescript
// src/modules/email/handlers/status-inquiry.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db/index.js', () => ({
  findContactByEmail: vi.fn(),
  getUserLanguage: vi.fn(),
}));

vi.mock('../../jobs/index.js', () => ({
  findMatchingJob: vi.fn(),
}));

vi.mock('../../ai/index.js', () => ({
  draftStatusResponse: vi.fn(),
}));

vi.mock('../../telegram/index.js', () => ({
  sendStatusInquiryNotification: vi.fn(),
}));

import { handleStatusInquiry } from './status-inquiry.js';
import { findMatchingJob } from '../../jobs/index.js';
import { draftStatusResponse } from '../../ai/index.js';
import { getUserLanguage } from '../../../db/index.js';

describe('handleStatusInquiry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('finds matching job and drafts response', async () => {
    const mockJob = {
      job: {
        id: 'job-123',
        description: 'Channel Letters',
        stage: 'in_production',
        eta: '2026-01-24',
        contact_id: 'contact-1',
      },
      confidence: 0.9,
      matchedKeywords: ['channel letters'],
    };

    vi.mocked(findMatchingJob).mockResolvedValue(mockJob as any);
    vi.mocked(draftStatusResponse).mockResolvedValue('안녕하세요...');
    vi.mocked(getUserLanguage).mockResolvedValue('ko');

    const result = await handleStatusInquiry({
      contact: { id: 'contact-1', name: 'Minseok', email: 'test@test.com', company: 'Samsung', is_active: true, created_at: '' },
      keywords: ['channel letters'],
      emailLanguage: 'ko',
      gmailMessageId: 'msg-123',
      subject: 'Status check',
    });

    expect(result.success).toBe(true);
    expect(result.matchedJob).toBeDefined();
    expect(draftStatusResponse).toHaveBeenCalledWith(expect.objectContaining({
      language: 'ko',
    }));
  });

  it('returns no match when job not found', async () => {
    vi.mocked(findMatchingJob).mockResolvedValue(null);

    const result = await handleStatusInquiry({
      contact: { id: 'contact-1', name: 'Minseok', email: 'test@test.com', company: 'Samsung', is_active: true, created_at: '' },
      keywords: ['unknown sign'],
      emailLanguage: 'en',
      gmailMessageId: 'msg-123',
      subject: 'Status check',
    });

    expect(result.success).toBe(true);
    expect(result.matchedJob).toBeUndefined();
    expect(result.noMatch).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/modules/email/handlers/status-inquiry.test.ts`
Expected: FAIL

**Step 3: Write the implementation**

```typescript
// src/modules/email/handlers/status-inquiry.ts
import { findMatchingJob, findAllMatchingJobs, type JobMatch } from '../../jobs/index.js';
import { draftStatusResponse } from '../../ai/index.js';
import type { Contact } from '../../../db/index.js';

export interface StatusInquiryInput {
  contact: Contact;
  keywords: string[];
  emailLanguage: 'ko' | 'en';
  gmailMessageId: string;
  subject: string;
}

export interface StatusInquiryResult {
  success: boolean;
  matchedJob?: JobMatch;
  multipleMatches?: JobMatch[];
  noMatch?: boolean;
  draftResponse?: string;
  error?: string;
}

export async function handleStatusInquiry(input: StatusInquiryInput): Promise<StatusInquiryResult> {
  try {
    // Find matching job
    const match = await findMatchingJob({
      contactId: input.contact.id,
      keywords: input.keywords,
    });

    if (!match) {
      // Check if there are any partial matches
      const allMatches = await findAllMatchingJobs({
        contactId: input.contact.id,
        keywords: input.keywords,
        maxResults: 3,
      });

      if (allMatches.length > 1) {
        return {
          success: true,
          multipleMatches: allMatches,
        };
      }

      return {
        success: true,
        noMatch: true,
      };
    }

    // Draft response in email language
    const draftResponse = await draftStatusResponse({
      language: input.emailLanguage,
      recipientName: input.contact.name.split(' ')[0], // First name
      jobDescription: match.job.description,
      currentStage: match.job.stage,
      eta: match.job.eta,
    });

    return {
      success: true,
      matchedJob: match,
      draftResponse,
    };
  } catch (error) {
    console.error('Status inquiry handling failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
```

**Step 4: Create index file**

```typescript
// src/modules/email/index.ts
export { handleStatusInquiry, type StatusInquiryInput, type StatusInquiryResult } from './handlers/status-inquiry.js';
```

**Step 5: Run tests**

Run: `npm test -- src/modules/email/handlers/status-inquiry.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/modules/email/
git commit -m "feat: add status inquiry handler"
```

---

## Task 10: Add Status Inquiry Telegram Callbacks

**Files:**
- Modify: `src/modules/telegram/bot.ts`
- Modify: `src/modules/telegram/callbacks.ts`

**Step 1: Add sendStatusInquiryNotification to bot.ts**

```typescript
// Add to src/modules/telegram/bot.ts
import { t, formatStatusInquiry, formatNoMatch, formatMultipleMatches } from './i18n.js';
import { getUserLanguage } from '../../db/index.js';
import type { JobMatch } from '../jobs/index.js';

export interface StatusInquiryNotificationData {
  telegramUserId?: string;
  contact: { name: string; company: string | null };
  subject: string;
  gmailMessageId: string;
  matchedJob?: JobMatch;
  multipleMatches?: JobMatch[];
  noMatch?: boolean;
  searchTerms?: string;
  draftResponse?: string;
}

export async function sendStatusInquiryNotification(data: StatusInquiryNotificationData): Promise<void> {
  const lang = data.telegramUserId
    ? await getUserLanguage(data.telegramUserId)
    : 'ko';

  if (data.noMatch) {
    const message = formatNoMatch(lang, data.searchTerms || '');
    await bot.telegram.sendMessage(
      env.TELEGRAM_ADMIN_CHAT_ID,
      message,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(t(lang, 'newEstimate'), `status_new_estimate:${data.gmailMessageId}`),
          Markup.button.callback(t(lang, 'ignore'), `status_ignore:${data.gmailMessageId}`),
        ],
      ])
    );
    return;
  }

  if (data.multipleMatches && data.multipleMatches.length > 1) {
    const message = formatMultipleMatches(lang, {
      company: data.contact.company || '',
      matches: data.multipleMatches.map(m => ({
        jobId: m.job.id,
        description: m.job.description,
        date: new Date(m.job.created_at).toLocaleDateString(),
      })),
    });

    const buttons = data.multipleMatches.map((m, i) =>
      [Markup.button.callback(`${i + 1} ${t(lang, 'select')}`, `status_select:${m.job.id}:${data.gmailMessageId}`)]
    );

    await bot.telegram.sendMessage(
      env.TELEGRAM_ADMIN_CHAT_ID,
      message,
      Markup.inlineKeyboard(buttons)
    );
    return;
  }

  if (data.matchedJob && data.draftResponse) {
    const message = formatStatusInquiry(lang, {
      company: data.contact.company || '',
      from: data.contact.name,
      subject: data.subject,
      jobId: data.matchedJob.job.id,
      stage: data.matchedJob.job.stage,
      eta: data.matchedJob.job.eta,
      draftResponse: data.draftResponse,
    });

    // Store draft response for later use
    const callbackData = `${data.matchedJob.job.id}:${data.gmailMessageId}`;

    await bot.telegram.sendMessage(
      env.TELEGRAM_ADMIN_CHAT_ID,
      message,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(t(lang, 'send'), `status_send:${callbackData}`),
          Markup.button.callback(t(lang, 'edit'), `status_edit:${callbackData}`),
          Markup.button.callback(t(lang, 'ignore'), `status_ignore:${data.gmailMessageId}`),
        ],
      ])
    );
  }
}
```

**Step 2: Add callback handlers to callbacks.ts**

Add to `setupCallbackHandlers()` in `src/modules/telegram/callbacks.ts`:

```typescript
// Store draft responses temporarily (in production, use Redis or database)
const draftResponses = new Map<string, string>();

export function storeDraftResponse(gmailMessageId: string, draft: string): void {
  draftResponses.set(gmailMessageId, draft);
}

export function getDraftResponse(gmailMessageId: string): string | undefined {
  return draftResponses.get(gmailMessageId);
}

// Status inquiry callbacks
bot.action(/^status_send:(.+):(.+)$/, async (ctx) => {
  const jobId = ctx.match[1];
  const gmailMessageId = ctx.match[2];
  await ctx.answerCbQuery('Sending...');

  const draft = getDraftResponse(gmailMessageId);
  if (!draft) {
    await ctx.reply('❌ Draft response not found. Please try again.');
    return;
  }

  // TODO: Implement actual email sending in Task 11
  await ctx.editMessageText(`✅ Response sent for job #${jobId.slice(0, 8)}`);
  draftResponses.delete(gmailMessageId);
});

bot.action(/^status_edit:(.+):(.+)$/, async (ctx) => {
  const jobId = ctx.match[1];
  const gmailMessageId = ctx.match[2];
  await ctx.answerCbQuery();

  const draft = getDraftResponse(gmailMessageId);
  const userId = ctx.from?.id.toString() || '';

  // Store edit session
  editSessions.set(userId, {
    type: 'status_response',
    jobId,
    gmailMessageId,
    originalDraft: draft || '',
  } as any);

  await ctx.reply(
    `Current draft:\n\n${draft}\n\nReply with your edited message:`,
    { reply_markup: { force_reply: true } }
  );
});

bot.action(/^status_ignore:(.+)$/, async (ctx) => {
  const gmailMessageId = ctx.match[1];
  await ctx.answerCbQuery('Ignored');
  await ctx.editMessageText('📥 Status inquiry archived.');
  draftResponses.delete(gmailMessageId);
});

bot.action(/^status_select:(.+):(.+)$/, async (ctx) => {
  const jobId = ctx.match[1];
  const gmailMessageId = ctx.match[2];
  await ctx.answerCbQuery('Selected');

  // TODO: Re-process with selected job
  await ctx.editMessageText(`Selected job #${jobId.slice(0, 8)}. Processing...`);
});

bot.action(/^status_new_estimate:(.+)$/, async (ctx) => {
  const gmailMessageId = ctx.match[1];
  await ctx.answerCbQuery();
  await ctx.editMessageText(`Treating as new estimate request...`);
  // TODO: Redirect to new estimate flow
});
```

**Step 3: Export new function from telegram/index.ts**

Add to `src/modules/telegram/index.ts`:

```typescript
export { sendStatusInquiryNotification, storeDraftResponse } from './bot.js';
```

**Step 4: Commit**

```bash
git add src/modules/telegram/bot.ts src/modules/telegram/callbacks.ts src/modules/telegram/index.ts
git commit -m "feat: add status inquiry Telegram notifications and callbacks"
```

---

## Task 11: Update Email Processor to Route by Intent

**Files:**
- Modify: `src/modules/gmail/webhook.ts`

**Step 1: Update processEmailMessage to route by intent**

Replace the intent handling section in `src/modules/gmail/webhook.ts`:

```typescript
import { handleStatusInquiry } from '../email/index.js';
import { sendStatusInquiryNotification, storeDraftResponse } from '../telegram/index.js';

// In processEmailMessage, after parsing:

// Route by intent
switch (parsed.intent) {
  case 'new_request':
    // Existing new request handling...
    if (parsed.items.length > 0) {
      // ... existing priced estimate flow
    } else {
      // ... existing simple notification flow
    }
    break;

  case 'status_inquiry':
    const statusResult = await handleStatusInquiry({
      contact,
      keywords: parsed.keywords || [parsed.referencedJobDescription].filter(Boolean) as string[],
      emailLanguage: parsed.language || 'en',
      gmailMessageId: messageId,
      subject,
    });

    if (statusResult.draftResponse) {
      storeDraftResponse(messageId, statusResult.draftResponse);
    }

    await sendStatusInquiryNotification({
      contact: { name: contact.name, company: contact.company },
      subject,
      gmailMessageId: messageId,
      matchedJob: statusResult.matchedJob,
      multipleMatches: statusResult.multipleMatches,
      noMatch: statusResult.noMatch,
      searchTerms: parsed.keywords?.join(', ') || parsed.referencedJobDescription || '',
      draftResponse: statusResult.draftResponse,
    });
    break;

  case 'reorder':
    // TODO: Implement reorder flow in next task
    await sendSimpleMessage(
      `🔄 Reorder request from ${contact.name}\n\nSubject: ${subject}\n\n(Reorder handling coming soon)`
    );
    break;

  case 'approval':
    await sendSimpleMessage(
      `✅ Approval received from ${contact.name}\n\nSubject: ${subject}`
    );
    // TODO: Auto-update job status
    break;

  case 'general':
  default:
    // Don't notify for general messages
    console.log('General message, no action taken');
    break;
}

return true;
```

**Step 2: Test with sample emails**

Test the full flow:
1. Send a status inquiry email
2. Verify Telegram notification appears
3. Test Send/Edit/Ignore buttons

**Step 3: Commit**

```bash
git add src/modules/gmail/webhook.ts
git commit -m "feat: route emails by intent in webhook processor"
```

---

## Task 12: Implement Email Send on Approval

**Files:**
- Modify: `src/modules/telegram/callbacks.ts`
- Modify: `src/modules/gmail/client.ts`

**Step 1: Update status_send callback to actually send email**

```typescript
// In callbacks.ts, update the status_send handler:

bot.action(/^status_send:(.+):(.+)$/, async (ctx) => {
  const jobId = ctx.match[1];
  const gmailMessageId = ctx.match[2];
  await ctx.answerCbQuery('Sending...');

  const draft = getDraftResponse(gmailMessageId);
  if (!draft) {
    await ctx.reply('❌ Draft response not found. Please try again.');
    return;
  }

  try {
    // Get original message to find thread and recipient
    const originalMessage = await getMessage(gmailMessageId);
    if (!originalMessage) {
      await ctx.reply('❌ Could not find original email.');
      return;
    }

    const { from, subject } = extractEmailContent(originalMessage);
    const threadId = originalMessage.threadId;

    if (!threadId) {
      await ctx.reply('❌ Could not find email thread.');
      return;
    }

    // Extract email address from "Name <email>" format
    const emailMatch = from.match(/<(.+)>/) || [null, from];
    const toEmail = emailMatch[1] || from;

    // Send reply
    const sentId = await replyToThread({
      threadId,
      messageId: gmailMessageId,
      to: toEmail,
      subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
      body: draft,
    });

    if (sentId) {
      await ctx.editMessageText(`✅ Response sent for job #${jobId.slice(0, 8)}\n\nEmail sent successfully.`);
    } else {
      await ctx.editMessageText(`❌ Failed to send email. Please try again or send manually.`);
    }
  } catch (error) {
    console.error('Failed to send status response:', error);
    await ctx.reply(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  draftResponses.delete(gmailMessageId);
});
```

**Step 2: Add necessary imports**

```typescript
import { getMessage, extractEmailContent, replyToThread } from '../gmail/index.js';
```

**Step 3: Export replyToThread from gmail/index.ts**

```typescript
// src/modules/gmail/index.ts
export { getMessage, extractEmailContent, replyToThread, getMessageThreadId } from './client.js';
```

**Step 4: Commit**

```bash
git add src/modules/telegram/callbacks.ts src/modules/gmail/index.ts
git commit -m "feat: implement email sending on status inquiry approval"
```

---

## Task 13: Add Reorder Handler

**Files:**
- Create: `src/modules/email/handlers/reorder.ts`
- Modify: `src/modules/email/index.ts`
- Modify: `src/modules/telegram/bot.ts`
- Modify: `src/modules/gmail/webhook.ts`

**Step 1: Create reorder handler**

```typescript
// src/modules/email/handlers/reorder.ts
import { getRecentEstimates, type Estimate } from '../../../db/index.js';
import type { Contact } from '../../../db/index.js';

export interface ReorderInput {
  contact: Contact;
  keywords: string[];
  emailLanguage: 'ko' | 'en';
  gmailMessageId: string;
  originalMessage: string;
}

export interface ReorderResult {
  success: boolean;
  previousEstimate?: Estimate;
  noMatch?: boolean;
  error?: string;
}

export async function handleReorder(input: ReorderInput): Promise<ReorderResult> {
  try {
    // Find previous estimates from this contact
    const estimates = await getRecentEstimates(50);
    const contactEstimates = estimates.filter(e =>
      e.contact_id === input.contact.id && e.status === 'won'
    );

    if (!contactEstimates.length) {
      return { success: true, noMatch: true };
    }

    // Find best match by keywords
    let bestMatch: Estimate | undefined;
    let bestScore = 0;

    for (const estimate of contactEstimates) {
      const itemDescriptions = estimate.items.map(i => i.description.toLowerCase()).join(' ');

      for (const keyword of input.keywords) {
        if (itemDescriptions.includes(keyword.toLowerCase())) {
          const score = keyword.length;
          if (score > bestScore) {
            bestScore = score;
            bestMatch = estimate;
          }
        }
      }
    }

    // If no keyword match, return most recent
    if (!bestMatch && contactEstimates.length > 0) {
      bestMatch = contactEstimates[0];
    }

    return {
      success: true,
      previousEstimate: bestMatch,
    };
  } catch (error) {
    console.error('Reorder handling failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
```

**Step 2: Add sendReorderNotification to bot.ts**

```typescript
// Add to src/modules/telegram/bot.ts

export interface ReorderNotificationData {
  telegramUserId?: string;
  contact: { name: string; company: string | null };
  gmailMessageId: string;
  originalMessage: string;
  previousEstimate?: Estimate;
  noMatch?: boolean;
}

export async function sendReorderNotification(data: ReorderNotificationData): Promise<void> {
  const lang = data.telegramUserId
    ? await getUserLanguage(data.telegramUserId)
    : 'ko';

  if (data.noMatch || !data.previousEstimate) {
    await bot.telegram.sendMessage(
      env.TELEGRAM_ADMIN_CHAT_ID,
      `🔄 ${t(lang, 'reorderRequest')} - ${data.contact.company}\n\n${t(lang, 'from')}: ${data.contact.name}\n"${data.originalMessage}"\n\n${t(lang, 'noMatchFound')}`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(t(lang, 'newEstimate'), `reorder_new:${data.gmailMessageId}`),
          Markup.button.callback(t(lang, 'ignore'), `reorder_ignore:${data.gmailMessageId}`),
        ],
      ])
    );
    return;
  }

  const estimate = data.previousEstimate;
  const message = formatReorderRequest(lang, {
    company: data.contact.company || '',
    from: data.contact.name,
    originalMessage: data.originalMessage,
    previousOrderDate: new Date(estimate.created_at).toLocaleDateString(),
    items: estimate.items.map(i => ({
      description: i.description,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      total: i.quantity * i.unitPrice,
    })),
    total: estimate.total_amount || 0,
  });

  await bot.telegram.sendMessage(
    env.TELEGRAM_ADMIN_CHAT_ID,
    message,
    Markup.inlineKeyboard([
      [
        Markup.button.callback(t(lang, 'createEstimateSamePrice'), `reorder_same:${estimate.id}:${data.gmailMessageId}`),
      ],
      [
        Markup.button.callback(t(lang, 'editPrices'), `reorder_edit:${estimate.id}:${data.gmailMessageId}`),
        Markup.button.callback(t(lang, 'ignore'), `reorder_ignore:${data.gmailMessageId}`),
      ],
    ])
  );
}
```

**Step 3: Add reorder callbacks to callbacks.ts**

```typescript
// Add to callbacks.ts

bot.action(/^reorder_same:(.+):(.+)$/, async (ctx) => {
  const estimateId = ctx.match[1];
  const gmailMessageId = ctx.match[2];
  await ctx.answerCbQuery('Creating estimate...');

  // TODO: Create new estimate from previous
  await ctx.editMessageText(`✅ Creating estimate from previous order #${estimateId.slice(0, 8)}...`);
});

bot.action(/^reorder_edit:(.+):(.+)$/, async (ctx) => {
  const estimateId = ctx.match[1];
  const gmailMessageId = ctx.match[2];
  await ctx.answerCbQuery();

  // TODO: Show edit interface
  await ctx.editMessageText(`✏️ Edit mode for estimate #${estimateId.slice(0, 8)}`);
});

bot.action(/^reorder_new:(.+)$/, async (ctx) => {
  const gmailMessageId = ctx.match[1];
  await ctx.answerCbQuery();
  await ctx.editMessageText(`📋 Treating as new estimate request...`);
});

bot.action(/^reorder_ignore:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery('Ignored');
  await ctx.editMessageText('📥 Reorder request archived.');
});
```

**Step 4: Update webhook.ts reorder case**

```typescript
case 'reorder':
  const reorderResult = await handleReorder({
    contact,
    keywords: parsed.keywords || [parsed.referencedJobDescription].filter(Boolean) as string[],
    emailLanguage: parsed.language || 'en',
    gmailMessageId: messageId,
    originalMessage: body.slice(0, 200),
  });

  await sendReorderNotification({
    contact: { name: contact.name, company: contact.company },
    gmailMessageId: messageId,
    originalMessage: body.slice(0, 200),
    previousEstimate: reorderResult.previousEstimate,
    noMatch: reorderResult.noMatch,
  });
  break;
```

**Step 5: Update exports**

```typescript
// src/modules/email/index.ts
export { handleReorder, type ReorderInput, type ReorderResult } from './handlers/reorder.js';

// src/modules/telegram/index.ts
export { sendReorderNotification } from './bot.js';
```

**Step 6: Commit**

```bash
git add src/modules/email/handlers/reorder.ts src/modules/email/index.ts src/modules/telegram/bot.ts src/modules/telegram/callbacks.ts src/modules/gmail/webhook.ts src/modules/telegram/index.ts
git commit -m "feat: add reorder request handler and notifications"
```

---

## Task 14: Final Integration Test

**Step 1: Run all tests**

```bash
npm test
```

Expected: All tests pass

**Step 2: Run type check**

```bash
npm run typecheck
```

Expected: No errors

**Step 3: Run lint**

```bash
npm run lint
```

Expected: No errors (or fix any found)

**Step 4: Manual E2E test**

1. Start the server: `npm run dev`
2. Send a status inquiry email from a monitored contact
3. Verify:
   - Telegram notification appears with correct language
   - Draft response is generated
   - Send button sends the email
   - Edit button allows modification
   - Ignore button archives

4. Send a reorder request email
5. Verify:
   - Previous order is found
   - Pricing is displayed
   - Create/Edit buttons work

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete Phase 4 - status inquiries and reorder requests"
```

---

## Summary

Phase 4 implementation adds:

1. **Database**: `telegram_users` table for language preferences
2. **AI Module**: Language detection, keyword extraction, response drafting
3. **Job Matching**: Fuzzy search by contact + keywords with confidence scoring
4. **Telegram**: `/lang` command, localized messages (Korean/English), status inquiry and reorder callbacks
5. **Gmail**: Reply-to-thread function for sending responses
6. **Email Routing**: Intent-based routing in webhook processor

All components follow TDD with tests written before implementation.
