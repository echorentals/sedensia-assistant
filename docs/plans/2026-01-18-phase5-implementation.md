# Phase 5: Invoicing & Job Completion - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automate job completion workflow - convert estimates to invoices, send completion emails with PDF attachments, track payments.

**Architecture:** When `/stage <id> completed` is called, trigger invoicing flow: create QB invoice from estimate, download PDF, draft completion email via AI, send for Telegram approval, reply to original Gmail thread with PDF attached. Payment tracked via `/paid` command.

**Tech Stack:** TypeScript, Supabase, QuickBooks API, Gmail API, Telegraf, Anthropic Claude

---

### Task 1: Database Migration - Invoices Table

**Files:**
- Create: `supabase/migrations/007_invoices.sql`

**Step 1: Create migration file**

```sql
-- Add invoiced and paid stages to jobs
ALTER TABLE jobs
DROP CONSTRAINT IF EXISTS jobs_stage_check;

ALTER TABLE jobs
ADD CONSTRAINT jobs_stage_check
CHECK (stage IN ('pending', 'in_production', 'ready', 'installed', 'completed', 'invoiced', 'paid'));

-- Create invoices table
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id),
  estimate_id UUID REFERENCES estimates(id),
  quickbooks_invoice_id TEXT,
  quickbooks_doc_number TEXT,
  total DECIMAL(10, 2) NOT NULL,
  sent_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for job lookup
CREATE INDEX idx_invoices_job_id ON invoices(job_id);

-- RLS policies
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to invoices"
  ON invoices
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
```

**Step 2: Apply migration**

Run: `npx supabase db push`
Expected: Migration applied successfully

**Step 3: Commit**

```bash
git add supabase/migrations/007_invoices.sql
git commit -m "feat: add invoices table and extended job stages"
```

---

### Task 2: Database Module - Invoices

**Files:**
- Create: `src/db/invoices.ts`
- Modify: `src/db/index.ts`
- Modify: `src/db/jobs.ts`

**Step 1: Create invoices.ts**

```typescript
import { supabase } from './client.js';

export interface Invoice {
  id: string;
  job_id: string;
  estimate_id: string | null;
  quickbooks_invoice_id: string | null;
  quickbooks_doc_number: string | null;
  total: number;
  sent_at: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface CreateInvoiceInput {
  jobId: string;
  estimateId?: string;
  quickbooksInvoiceId?: string;
  quickbooksDocNumber?: string;
  total: number;
}

export async function createInvoice(input: CreateInvoiceInput): Promise<Invoice | null> {
  const { data, error } = await supabase
    .from('invoices')
    .insert({
      job_id: input.jobId,
      estimate_id: input.estimateId || null,
      quickbooks_invoice_id: input.quickbooksInvoiceId || null,
      quickbooks_doc_number: input.quickbooksDocNumber || null,
      total: input.total,
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to create invoice:', error);
    return null;
  }

  return data as Invoice;
}

export async function getInvoiceByJobId(jobId: string): Promise<Invoice | null> {
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('job_id', jobId)
    .single();

  if (error || !data) return null;
  return data as Invoice;
}

export async function updateInvoiceSent(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('invoices')
    .update({ sent_at: new Date().toISOString() })
    .eq('id', id);

  return !error;
}

export async function updateInvoicePaid(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('invoices')
    .update({ paid_at: new Date().toISOString() })
    .eq('id', id);

  return !error;
}
```

**Step 2: Update jobs.ts - extend Job type**

In `src/db/jobs.ts`, update line 8:

```typescript
  stage: 'pending' | 'in_production' | 'ready' | 'installed' | 'completed' | 'invoiced' | 'paid';
```

**Step 3: Update index.ts - export invoices**

Add to `src/db/index.ts`:

```typescript
export {
  createInvoice,
  getInvoiceByJobId,
  updateInvoiceSent,
  updateInvoicePaid,
  type Invoice,
  type CreateInvoiceInput,
} from './invoices.js';
```

**Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/db/invoices.ts src/db/jobs.ts src/db/index.ts
git commit -m "feat: add invoices database module"
```

---

### Task 3: QuickBooks - Invoice Functions

**Files:**
- Modify: `src/modules/quickbooks/client.ts`
- Create: `src/modules/quickbooks/client.invoice.test.ts`

**Step 1: Write test file**

```typescript
// src/modules/quickbooks/client.invoice.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./auth.js', () => ({
  refreshTokenIfNeeded: vi.fn(),
}));

import { refreshTokenIfNeeded } from './auth.js';

describe('QuickBooks Invoice Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('createInvoiceFromEstimate creates invoice with estimate data', async () => {
    vi.mocked(refreshTokenIfNeeded).mockResolvedValue({
      accessToken: 'test-token',
      refreshToken: 'test-refresh',
      expiresAt: new Date(Date.now() + 3600000),
      realmId: 'test-realm',
    });

    const mockEstimate = {
      Estimate: {
        Id: 'est-123',
        CustomerRef: { value: 'cust-1', name: 'Samsung' },
        Line: [
          {
            DetailType: 'SalesItemLineDetail',
            Amount: 1000,
            Description: 'Channel Letters',
            SalesItemLineDetail: { Qty: 2, UnitPrice: 500 },
          },
        ],
        TotalAmt: 1000,
      },
    };

    const mockInvoice = {
      Invoice: {
        Id: 'inv-456',
        DocNumber: 'INV-1001',
        TotalAmt: 1000,
      },
    };

    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockEstimate,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockInvoice,
      } as Response);

    const { createInvoiceFromEstimate } = await import('./client.js');
    const result = await createInvoiceFromEstimate('est-123');

    expect(result).toBeDefined();
    expect(result?.Id).toBe('inv-456');
  });

  it('getInvoicePdf returns PDF buffer', async () => {
    vi.mocked(refreshTokenIfNeeded).mockResolvedValue({
      accessToken: 'test-token',
      refreshToken: 'test-refresh',
      expiresAt: new Date(Date.now() + 3600000),
      realmId: 'test-realm',
    });

    const pdfData = Buffer.from('%PDF-1.4 test');

    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => pdfData.buffer,
    } as Response);

    const { getInvoicePdf } = await import('./client.js');
    const result = await getInvoicePdf('inv-456');

    expect(result).toBeInstanceOf(Buffer);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/modules/quickbooks/client.invoice.test.ts`
Expected: FAIL (functions not exported)

**Step 3: Add invoice types and functions to client.ts**

Add to `src/modules/quickbooks/client.ts` after existing code:

```typescript
// Invoice types
export interface QBInvoice {
  Id?: string;
  DocNumber?: string;
  CustomerRef: { value: string; name?: string };
  Line: QBLineItem[];
  TotalAmt?: number;
  TxnDate?: string;
  EmailStatus?: string;
  LinkedTxn?: Array<{ TxnId: string; TxnType: string }>;
}

export async function createInvoiceFromEstimate(estimateId: string): Promise<QBInvoice | null> {
  const client = await getQuickBooksClient();
  if (!client) return null;

  try {
    // Fetch the estimate
    const estimate = await getEstimate(estimateId);
    if (!estimate) {
      console.error('Estimate not found:', estimateId);
      return null;
    }

    // Create invoice with same data
    const invoice: QBInvoice = {
      CustomerRef: estimate.CustomerRef,
      Line: estimate.Line,
      LinkedTxn: [{ TxnId: estimateId, TxnType: 'Estimate' }],
    };

    const result = await qbRequest<{ Invoice: QBInvoice }>(
      client,
      '/invoice',
      {
        method: 'POST',
        body: JSON.stringify(invoice),
      }
    );

    return result.Invoice;
  } catch (error) {
    console.error('Failed to create invoice from estimate:', error);
    return null;
  }
}

export async function getInvoice(invoiceId: string): Promise<QBInvoice | null> {
  const client = await getQuickBooksClient();
  if (!client) return null;

  try {
    const result = await qbRequest<{ Invoice: QBInvoice }>(
      client,
      `/invoice/${invoiceId}`
    );
    return result.Invoice;
  } catch {
    return null;
  }
}

export async function getInvoicePdf(invoiceId: string): Promise<Buffer | null> {
  const client = await getQuickBooksClient();
  if (!client) return null;

  try {
    const response = await fetch(
      `${client.baseUrl}/invoice/${invoiceId}/pdf`,
      {
        headers: {
          'Accept': 'application/pdf',
          'Authorization': `Bearer ${client.tokens.accessToken}`,
        },
      }
    );

    if (!response.ok) {
      console.error('Failed to get invoice PDF:', response.status);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error('Failed to get invoice PDF:', error);
    return null;
  }
}
```

**Step 4: Run tests**

Run: `npm test -- src/modules/quickbooks/client.invoice.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/modules/quickbooks/client.ts src/modules/quickbooks/client.invoice.test.ts
git commit -m "feat: add QuickBooks invoice functions"
```

---

### Task 4: AI - Completion Email Drafter

**Files:**
- Modify: `src/modules/ai/drafter.ts`
- Create: `src/modules/ai/drafter.completion.test.ts`

**Step 1: Write test file**

```typescript
// src/modules/ai/drafter.completion.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Thank you for your business...' }],
      }),
    },
  })),
}));

import { draftCompletionEmail } from './drafter.js';

describe('draftCompletionEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('drafts English completion email', async () => {
    const result = await draftCompletionEmail({
      contactName: 'Minseok',
      companyName: 'Samsung',
      jobDescription: 'Channel Letters for Taylor Facility',
      invoiceNumber: 'INV-1042',
      invoiceTotal: 4936.20,
      language: 'en',
    });

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('drafts Korean completion email', async () => {
    const result = await draftCompletionEmail({
      contactName: '민석',
      companyName: 'Samsung',
      jobDescription: 'Channel Letters',
      invoiceNumber: 'INV-1042',
      invoiceTotal: 4936.20,
      language: 'ko',
    });

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/modules/ai/drafter.completion.test.ts`
Expected: FAIL (draftCompletionEmail not exported)

**Step 3: Add draftCompletionEmail to drafter.ts**

Add to `src/modules/ai/drafter.ts`:

```typescript
export interface CompletionEmailInput {
  contactName: string;
  companyName: string;
  jobDescription: string;
  invoiceNumber: string;
  invoiceTotal: number;
  language: 'ko' | 'en';
}

export async function draftCompletionEmail(input: CompletionEmailInput): Promise<string> {
  const languageInstructions = input.language === 'ko'
    ? '한국어로 작성해주세요. 정중하고 비즈니스적인 톤을 유지하세요.'
    : 'Write in English. Maintain a professional and courteous tone.';

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    messages: [
      {
        role: 'user',
        content: `You are drafting a job completion email for a sign fabrication company.

${languageInstructions}

Details:
- Customer name: ${input.contactName}
- Company: ${input.companyName}
- Project: ${input.jobDescription}
- Invoice number: ${input.invoiceNumber}
- Total amount: $${input.invoiceTotal.toLocaleString()}

Write a brief, professional email that:
1. Confirms the job has been completed and delivered
2. References the attached invoice
3. Thanks them for their business
4. Mentions payment terms (Net 30)

Keep it concise (3-4 short paragraphs). Do not include subject line or signature - just the body text.`,
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  return textBlock?.text || '';
}
```

**Step 4: Run tests**

Run: `npm test -- src/modules/ai/drafter.completion.test.ts`
Expected: PASS

**Step 5: Update index.ts exports**

In `src/modules/ai/index.ts`, add:

```typescript
export { draftCompletionEmail, type CompletionEmailInput } from './drafter.js';
```

**Step 6: Commit**

```bash
git add src/modules/ai/drafter.ts src/modules/ai/drafter.completion.test.ts src/modules/ai/index.ts
git commit -m "feat: add AI completion email drafter"
```

---

### Task 5: Telegram - Completion Notification

**Files:**
- Modify: `src/modules/telegram/bot.ts`
- Modify: `src/modules/telegram/i18n.ts`

**Step 1: Add i18n translations**

Add to `src/modules/telegram/i18n.ts` translations object:

```typescript
// Add to 'ko' translations
jobComplete: '작업 완료',
invoiceAttached: '청구서 첨부됨',
sendEmail: '이메일 발송',
skipInvoice: '청구서 건너뛰기',

// Add to 'en' translations
jobComplete: 'Job Complete',
invoiceAttached: 'Invoice Attached',
sendEmail: 'Send Email',
skipInvoice: 'Skip Invoice',
```

**Step 2: Add sendCompletionNotification to bot.ts**

Add to `src/modules/telegram/bot.ts`:

```typescript
export interface CompletionNotificationData {
  telegramUserId?: string;
  job: { id: string; description: string };
  invoiceNumber: string;
  invoiceTotal: number;
  draftEmail: string;
  contactName: string;
  companyName: string;
}

export async function sendCompletionNotification(data: CompletionNotificationData): Promise<void> {
  try {
    const lang = data.telegramUserId
      ? await getUserLanguage(data.telegramUserId)
      : 'ko';

    const message = `✅ ${t(lang, 'jobComplete')} - ${data.companyName}

Job: #${data.job.id.slice(0, 8)} - ${data.job.description}
Total: $${data.invoiceTotal.toLocaleString()}

━━━━━━━━━━━━━━━━━━
📝 ${t(lang, 'draftResponse')}:
"${data.draftEmail.slice(0, 200)}${data.draftEmail.length > 200 ? '...' : ''}"

📎 ${t(lang, 'invoiceAttached')}: ${data.invoiceNumber}.pdf`;

    await bot.telegram.sendMessage(
      env.TELEGRAM_ADMIN_CHAT_ID,
      message,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(t(lang, 'sendEmail'), `complete_send:${data.job.id}`),
          Markup.button.callback(t(lang, 'edit'), `complete_edit:${data.job.id}`),
        ],
        [
          Markup.button.callback(t(lang, 'skipInvoice'), `complete_skip:${data.job.id}`),
        ],
      ])
    );
  } catch (error) {
    console.error('Failed to send completion notification:', error);
    throw error;
  }
}
```

**Step 3: Export from index.ts**

Add to `src/modules/telegram/index.ts`:

```typescript
export { sendCompletionNotification, type CompletionNotificationData } from './bot.js';
```

**Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/modules/telegram/bot.ts src/modules/telegram/i18n.ts src/modules/telegram/index.ts
git commit -m "feat: add completion notification to Telegram"
```

---

### Task 6: Invoicing Flow Handler

**Files:**
- Create: `src/modules/invoicing/handler.ts`
- Create: `src/modules/invoicing/index.ts`
- Create: `src/modules/invoicing/handler.test.ts`

**Step 1: Write test file**

```typescript
// src/modules/invoicing/handler.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  getJobById: vi.fn(),
  getEstimateById: vi.fn(),
  createInvoice: vi.fn(),
  getContactById: vi.fn(),
}));

vi.mock('../quickbooks/client.js', () => ({
  createInvoiceFromEstimate: vi.fn(),
  getInvoicePdf: vi.fn(),
}));

vi.mock('../ai/index.js', () => ({
  draftCompletionEmail: vi.fn(),
}));

import { handleJobCompletion } from './handler.js';
import { getJobById, getEstimateById, createInvoice, getContactById } from '../../db/index.js';
import { createInvoiceFromEstimate, getInvoicePdf } from '../quickbooks/client.js';
import { draftCompletionEmail } from '../ai/index.js';

describe('handleJobCompletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates invoice and returns completion data', async () => {
    vi.mocked(getJobById).mockResolvedValue({
      id: 'job-123',
      estimate_id: 'est-456',
      contact_id: 'contact-789',
      description: 'Channel Letters',
      stage: 'completed',
      total_amount: 4936.20,
    } as any);

    vi.mocked(getEstimateById).mockResolvedValue({
      id: 'est-456',
      quickbooks_estimate_id: 'qb-est-123',
      gmail_message_id: 'msg-abc',
      total_amount: 4936.20,
    } as any);

    vi.mocked(getContactById).mockResolvedValue({
      id: 'contact-789',
      name: 'Minseok Kim',
      email: 'minseok@samsung.com',
      company: 'Samsung',
    } as any);

    vi.mocked(createInvoiceFromEstimate).mockResolvedValue({
      Id: 'qb-inv-456',
      DocNumber: 'INV-1042',
      TotalAmt: 4936.20,
    } as any);

    vi.mocked(getInvoicePdf).mockResolvedValue(Buffer.from('%PDF'));

    vi.mocked(createInvoice).mockResolvedValue({
      id: 'inv-local-123',
    } as any);

    vi.mocked(draftCompletionEmail).mockResolvedValue('Thank you for your business...');

    const result = await handleJobCompletion('job-123');

    expect(result.success).toBe(true);
    expect(result.invoice).toBeDefined();
    expect(result.draftEmail).toBeDefined();
    expect(result.pdfBuffer).toBeDefined();
  });

  it('returns error if job not found', async () => {
    vi.mocked(getJobById).mockResolvedValue(null);

    const result = await handleJobCompletion('nonexistent');

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('returns error if no estimate linked', async () => {
    vi.mocked(getJobById).mockResolvedValue({
      id: 'job-123',
      estimate_id: null,
    } as any);

    const result = await handleJobCompletion('job-123');

    expect(result.success).toBe(false);
    expect(result.error).toContain('estimate');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/modules/invoicing/handler.test.ts`
Expected: FAIL (module not found)

**Step 3: Create handler.ts**

```typescript
// src/modules/invoicing/handler.ts
import { getJobById, getEstimateById, createInvoice, getContactById, updateJobStage } from '../../db/index.js';
import type { Invoice, Job } from '../../db/index.js';
import { createInvoiceFromEstimate, getInvoicePdf } from '../quickbooks/client.js';
import { draftCompletionEmail } from '../ai/index.js';

export interface CompletionResult {
  success: boolean;
  error?: string;
  job?: Job;
  invoice?: Invoice;
  invoiceNumber?: string;
  draftEmail?: string;
  pdfBuffer?: Buffer;
  contactEmail?: string;
  gmailMessageId?: string;
}

export async function handleJobCompletion(jobId: string): Promise<CompletionResult> {
  try {
    // Get job
    const job = await getJobById(jobId);
    if (!job) {
      return { success: false, error: 'Job not found' };
    }

    // Get estimate
    if (!job.estimate_id) {
      return { success: false, error: 'Job has no linked estimate' };
    }

    const estimate = await getEstimateById(job.estimate_id);
    if (!estimate) {
      return { success: false, error: 'Estimate not found' };
    }

    if (!estimate.quickbooks_estimate_id) {
      return { success: false, error: 'Estimate not in QuickBooks' };
    }

    // Get contact
    const contact = job.contact_id ? await getContactById(job.contact_id) : null;
    if (!contact) {
      return { success: false, error: 'Contact not found' };
    }

    // Create QuickBooks invoice
    const qbInvoice = await createInvoiceFromEstimate(estimate.quickbooks_estimate_id);
    if (!qbInvoice || !qbInvoice.Id) {
      return { success: false, error: 'Failed to create QuickBooks invoice' };
    }

    // Download PDF
    const pdfBuffer = await getInvoicePdf(qbInvoice.Id);
    if (!pdfBuffer) {
      return { success: false, error: 'Failed to download invoice PDF' };
    }

    // Create local invoice record
    const invoice = await createInvoice({
      jobId: job.id,
      estimateId: estimate.id,
      quickbooksInvoiceId: qbInvoice.Id,
      quickbooksDocNumber: qbInvoice.DocNumber,
      total: qbInvoice.TotalAmt || estimate.total_amount || 0,
    });

    if (!invoice) {
      return { success: false, error: 'Failed to create invoice record' };
    }

    // Detect language from estimate (default to 'ko')
    const language = 'ko'; // TODO: Store language on estimate/job

    // Draft completion email
    const draftEmail = await draftCompletionEmail({
      contactName: contact.name,
      companyName: contact.company || '',
      jobDescription: job.description,
      invoiceNumber: qbInvoice.DocNumber || `INV-${qbInvoice.Id}`,
      invoiceTotal: qbInvoice.TotalAmt || 0,
      language,
    });

    return {
      success: true,
      job,
      invoice,
      invoiceNumber: qbInvoice.DocNumber || `INV-${qbInvoice.Id}`,
      draftEmail,
      pdfBuffer,
      contactEmail: contact.email,
      gmailMessageId: estimate.gmail_message_id || undefined,
    };
  } catch (error) {
    console.error('Job completion failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
```

**Step 4: Create index.ts**

```typescript
// src/modules/invoicing/index.ts
export { handleJobCompletion, type CompletionResult } from './handler.js';
```

**Step 5: Run tests**

Run: `npm test -- src/modules/invoicing/handler.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/modules/invoicing/
git commit -m "feat: add invoicing flow handler"
```

---

### Task 7: Telegram Callbacks - Completion Actions

**Files:**
- Modify: `src/modules/telegram/callbacks.ts`

**Step 1: Add imports**

At top of `src/modules/telegram/callbacks.ts`, add:

```typescript
import { handleJobCompletion } from '../invoicing/index.js';
import { updateInvoiceSent, getInvoiceByJobId } from '../../db/index.js';
import { replyToThread, getMessageThreadId } from '../gmail/index.js';
```

**Step 2: Update /stage command to trigger completion flow**

Find the `/stage` command (around line 528) and modify the success handler:

```typescript
    const success = await updateJobStage(job.id, stage as Job['stage']);
    if (success) {
      await ctx.reply(`✅ Job ${job.id.slice(0, 8)} updated to: ${stage}`);

      // Trigger invoicing flow when completed
      if (stage === 'completed') {
        await ctx.reply('Processing invoice...');
        const result = await handleJobCompletion(job.id);

        if (result.success && result.job && result.invoiceNumber && result.draftEmail) {
          // Store completion data for callbacks
          storeCompletionData(job.id, {
            draftEmail: result.draftEmail,
            pdfBuffer: result.pdfBuffer!,
            contactEmail: result.contactEmail!,
            gmailMessageId: result.gmailMessageId,
            invoiceNumber: result.invoiceNumber,
          });

          await sendCompletionNotification({
            telegramUserId: ctx.from?.id.toString(),
            job: { id: job.id, description: job.description },
            invoiceNumber: result.invoiceNumber,
            invoiceTotal: result.invoice?.total || 0,
            draftEmail: result.draftEmail,
            contactName: result.contactEmail?.split('@')[0] || 'Customer',
            companyName: 'Samsung', // TODO: Get from contact
          });
        } else {
          await ctx.reply(`⚠️ Invoice creation failed: ${result.error}`);
        }
      }
    } else {
      await ctx.reply(`❌ Failed to update job stage.`);
    }
```

**Step 3: Add completion data storage**

Add near the top of the file (after draftResponses):

```typescript
interface CompletionData {
  draftEmail: string;
  pdfBuffer: Buffer;
  contactEmail: string;
  gmailMessageId?: string;
  invoiceNumber: string;
}

const completionDataStore = new Map<string, CompletionData>();

function storeCompletionData(jobId: string, data: CompletionData): void {
  completionDataStore.set(jobId, data);
}

function getCompletionData(jobId: string): CompletionData | undefined {
  return completionDataStore.get(jobId);
}

function clearCompletionData(jobId: string): void {
  completionDataStore.delete(jobId);
}
```

**Step 4: Add completion callbacks**

Add before the `/lang` command:

```typescript
  // Complete and send email with invoice
  bot.action(/^complete_send:(.+)$/, async (ctx) => {
    const jobId = ctx.match[1];
    const data = getCompletionData(jobId);

    if (!data) {
      await ctx.answerCbQuery('Completion data expired. Please run /stage again.');
      return;
    }

    try {
      // Get thread info
      let threadId: string | null = null;
      if (data.gmailMessageId) {
        threadId = await getMessageThreadId(data.gmailMessageId);
      }

      if (threadId && data.gmailMessageId) {
        // Send email with PDF attachment
        const sentId = await replyToThread({
          threadId,
          messageId: data.gmailMessageId,
          to: data.contactEmail,
          subject: `Re: Job Complete - Invoice ${data.invoiceNumber}`,
          body: data.draftEmail,
          attachments: [{
            filename: `${data.invoiceNumber}.pdf`,
            mimeType: 'application/pdf',
            data: data.pdfBuffer,
          }],
        });

        if (sentId) {
          // Update invoice as sent
          const invoice = await getInvoiceByJobId(jobId);
          if (invoice) {
            await updateInvoiceSent(invoice.id);
          }

          // Update job to invoiced
          await updateJobStage(jobId, 'invoiced');

          await ctx.editMessageText(`✅ Completion email sent with invoice ${data.invoiceNumber}`);
        } else {
          await ctx.answerCbQuery('Failed to send email');
        }
      } else {
        await ctx.answerCbQuery('No email thread found for reply');
      }
    } catch (error) {
      console.error('Complete send failed:', error);
      await ctx.answerCbQuery('Failed to send email');
    } finally {
      clearCompletionData(jobId);
    }
  });

  // Edit completion email
  bot.action(/^complete_edit:(.+)$/, async (ctx) => {
    const jobId = ctx.match[1];
    const data = getCompletionData(jobId);

    if (!data) {
      await ctx.answerCbQuery('Completion data expired');
      return;
    }

    await ctx.editMessageText(
      `📝 Current draft:\n\n${data.draftEmail}\n\n➡️ Reply with your edited version:`
    );

    // Store that we're expecting an edit for this job
    editingCompletionEmail.set(ctx.from?.id.toString() || '', jobId);
    await ctx.answerCbQuery();
  });

  // Skip sending email, just mark as invoiced
  bot.action(/^complete_skip:(.+)$/, async (ctx) => {
    const jobId = ctx.match[1];

    await updateJobStage(jobId, 'invoiced');
    clearCompletionData(jobId);

    await ctx.editMessageText(`✅ Job marked as invoiced (email skipped)`);
  });
```

**Step 5: Add editing state**

Add near other state maps:

```typescript
const editingCompletionEmail = new Map<string, string>(); // telegramUserId -> jobId
```

**Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 7: Commit**

```bash
git add src/modules/telegram/callbacks.ts
git commit -m "feat: add completion callbacks and /stage integration"
```

---

### Task 8: /paid Command

**Files:**
- Modify: `src/modules/telegram/callbacks.ts`

**Step 1: Add /paid command**

Add after the `/lang` command:

```typescript
  // Mark job as paid
  bot.command('paid', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      await ctx.reply('Usage: /paid <job_id>');
      return;
    }

    const job = await findJobByPrefix(args[1]);
    if (!job) {
      await ctx.reply(`❌ No job found starting with "${args[1]}"`);
      return;
    }

    // Check if job is invoiced
    if (job.stage !== 'invoiced') {
      if (job.stage === 'paid') {
        const invoice = await getInvoiceByJobId(job.id);
        const paidDate = invoice?.paid_at
          ? new Date(invoice.paid_at).toLocaleDateString()
          : 'unknown date';
        await ctx.reply(`ℹ️ Job already marked as paid on ${paidDate}`);
        return;
      }
      await ctx.reply(`❌ Job must be invoiced before marking paid. Current stage: ${job.stage}`);
      return;
    }

    // Get invoice and mark as paid
    const invoice = await getInvoiceByJobId(job.id);
    if (invoice) {
      await updateInvoicePaid(invoice.id);
    }

    // Update job stage
    const success = await updateJobStage(job.id, 'paid');
    if (success) {
      await ctx.reply(`✅ Job #${job.id.slice(0, 8)} marked as paid

Invoice: ${invoice?.quickbooks_doc_number || 'N/A'}
Amount: $${invoice?.total?.toLocaleString() || job.total_amount?.toLocaleString() || 'N/A'}`);
    } else {
      await ctx.reply(`❌ Failed to update job stage`);
    }
  });
```

**Step 2: Add updateInvoicePaid import**

Make sure it's in the imports at top of file:

```typescript
import { updateInvoiceSent, updateInvoicePaid, getInvoiceByJobId } from '../../db/index.js';
```

**Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add src/modules/telegram/callbacks.ts
git commit -m "feat: add /paid command for payment tracking"
```

---

### Task 9: Update Valid Stages

**Files:**
- Modify: `src/modules/telegram/callbacks.ts`

**Step 1: Update validStages array**

Find line with `validStages` in the `/stage` command and update:

```typescript
    const validStages = ['pending', 'in_production', 'ready', 'installed', 'completed', 'invoiced', 'paid'];
```

**Step 2: Update the type cast**

Update the type cast for stage:

```typescript
    const success = await updateJobStage(job.id, stage as Job['stage']);
```

**Step 3: Import Job type**

Ensure Job is imported from db:

```typescript
import type { Job } from '../../db/index.js';
```

**Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/modules/telegram/callbacks.ts
git commit -m "feat: extend valid job stages to include invoiced and paid"
```

---

### Task 10: Update getActiveJobs to Include Invoiced

**Files:**
- Modify: `src/db/jobs.ts`

**Step 1: Update getActiveJobs query**

Update the function to exclude both `paid` jobs (completed workflow):

```typescript
export async function getActiveJobs(): Promise<Job[]> {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .not('stage', 'eq', 'paid')
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return data as Job[];
}
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/db/jobs.ts
git commit -m "fix: update getActiveJobs to show invoiced jobs"
```

---

### Task 11: Export getContactById

**Files:**
- Modify: `src/db/index.ts`
- Check: `src/db/contacts.ts`

**Step 1: Check if getContactById exists**

If not in `src/db/contacts.ts`, add it:

```typescript
export async function getContactById(id: string): Promise<Contact | null> {
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) return null;
  return data as Contact;
}
```

**Step 2: Export from index.ts**

Add to `src/db/index.ts`:

```typescript
export { getContactById } from './contacts.js';
```

**Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add src/db/contacts.ts src/db/index.ts
git commit -m "feat: export getContactById from database module"
```

---

### Task 12: Final Integration Test

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests PASS

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 3: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit any fixes**

If needed:
```bash
git add -A
git commit -m "fix: resolve integration issues"
```

---

### Task 13: Update Design Document

**Files:**
- Modify: `docs/plans/2026-01-18-sedensia-assistant-design.md`

**Step 1: Mark Phase 5 tasks complete**

Update Phase 5 implementation tasks to checked:

```markdown
### Implementation Tasks
- [x] Estimate → Invoice conversion in QuickBooks
- [x] PDF download and storage
- [x] Completion email composer (AI)
- [x] Gmail thread reply with attachment
- [x] Payment tracking (`/paid <job_id>`)
```

**Step 2: Mark Phase 5 success criteria complete**

```markdown
### Phase 5 Complete When: ✓
- [Mark Delivered] converts estimate to invoice ✓
- Completion email replies to original thread with PDF attached ✓
- [Mark Paid] updates job status ✓
```

**Step 3: Commit**

```bash
git add docs/plans/2026-01-18-sedensia-assistant-design.md
git commit -m "docs: mark Phase 5 complete"
```
