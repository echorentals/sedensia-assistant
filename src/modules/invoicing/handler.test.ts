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
      eta: null,
      quickbooks_invoice_id: null,
      notes: null,
      created_at: '2026-01-18T00:00:00Z',
      updated_at: '2026-01-18T00:00:00Z',
    });

    vi.mocked(getEstimateById).mockResolvedValue({
      id: 'est-456',
      quickbooks_estimate_id: 'qb-est-123',
      gmail_message_id: 'msg-abc',
      total_amount: 4936.20,
      contact_id: 'contact-789',
      quickbooks_doc_number: 'EST-1042',
      quickbooks_customer_id: 'qb-cust-123',
      status: 'won',
      items: [],
      notes: null,
      created_at: '2026-01-18T00:00:00Z',
      updated_at: '2026-01-18T00:00:00Z',
    });

    vi.mocked(getContactById).mockResolvedValue({
      id: 'contact-789',
      name: 'Minseok Kim',
      email: 'minseok@samsung.com',
      company: 'Samsung',
      is_active: true,
      created_at: '2026-01-18T00:00:00Z',
    });

    vi.mocked(createInvoiceFromEstimate).mockResolvedValue({
      Id: 'qb-inv-456',
      DocNumber: 'INV-1042',
      TotalAmt: 4936.20,
      CustomerRef: { value: 'qb-cust-123' },
      Line: [],
    });

    vi.mocked(getInvoicePdf).mockResolvedValue(Buffer.from('%PDF'));

    vi.mocked(createInvoice).mockResolvedValue({
      id: 'inv-local-123',
      job_id: 'job-123',
      estimate_id: 'est-456',
      quickbooks_invoice_id: 'qb-inv-456',
      quickbooks_doc_number: 'INV-1042',
      total: 4936.20,
      sent_at: null,
      paid_at: null,
      created_at: '2026-01-18T00:00:00Z',
    });

    vi.mocked(draftCompletionEmail).mockResolvedValue('Thank you for your business...');

    const result = await handleJobCompletion('job-123');

    expect(result.success).toBe(true);
    expect(result.invoice).toBeDefined();
    expect(result.draftEmail).toBeDefined();
    expect(result.pdfBuffer).toBeDefined();
    expect(result.invoiceNumber).toBe('INV-1042');
    expect(result.contactEmail).toBe('minseok@samsung.com');
    expect(result.gmailMessageId).toBe('msg-abc');
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
      contact_id: 'contact-789',
      description: 'Channel Letters',
      stage: 'completed',
      total_amount: 4936.20,
      eta: null,
      quickbooks_invoice_id: null,
      notes: null,
      created_at: '2026-01-18T00:00:00Z',
      updated_at: '2026-01-18T00:00:00Z',
    });

    const result = await handleJobCompletion('job-123');

    expect(result.success).toBe(false);
    expect(result.error).toContain('estimate');
  });

  it('returns error if estimate not found in database', async () => {
    vi.mocked(getJobById).mockResolvedValue({
      id: 'job-123',
      estimate_id: 'est-456',
      contact_id: 'contact-789',
      description: 'Channel Letters',
      stage: 'completed',
      total_amount: 4936.20,
      eta: null,
      quickbooks_invoice_id: null,
      notes: null,
      created_at: '2026-01-18T00:00:00Z',
      updated_at: '2026-01-18T00:00:00Z',
    });

    vi.mocked(getEstimateById).mockResolvedValue(null);

    const result = await handleJobCompletion('job-123');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Estimate not found');
  });

  it('returns error if estimate not in QuickBooks', async () => {
    vi.mocked(getJobById).mockResolvedValue({
      id: 'job-123',
      estimate_id: 'est-456',
      contact_id: 'contact-789',
      description: 'Channel Letters',
      stage: 'completed',
      total_amount: 4936.20,
      eta: null,
      quickbooks_invoice_id: null,
      notes: null,
      created_at: '2026-01-18T00:00:00Z',
      updated_at: '2026-01-18T00:00:00Z',
    });

    vi.mocked(getEstimateById).mockResolvedValue({
      id: 'est-456',
      quickbooks_estimate_id: null, // Not in QuickBooks
      gmail_message_id: 'msg-abc',
      total_amount: 4936.20,
      contact_id: 'contact-789',
      quickbooks_doc_number: null,
      quickbooks_customer_id: null,
      status: 'draft',
      items: [],
      notes: null,
      created_at: '2026-01-18T00:00:00Z',
      updated_at: '2026-01-18T00:00:00Z',
    });

    const result = await handleJobCompletion('job-123');

    expect(result.success).toBe(false);
    expect(result.error).toContain('QuickBooks');
  });

  it('returns error if contact not found', async () => {
    vi.mocked(getJobById).mockResolvedValue({
      id: 'job-123',
      estimate_id: 'est-456',
      contact_id: 'contact-789',
      description: 'Channel Letters',
      stage: 'completed',
      total_amount: 4936.20,
      eta: null,
      quickbooks_invoice_id: null,
      notes: null,
      created_at: '2026-01-18T00:00:00Z',
      updated_at: '2026-01-18T00:00:00Z',
    });

    vi.mocked(getEstimateById).mockResolvedValue({
      id: 'est-456',
      quickbooks_estimate_id: 'qb-est-123',
      gmail_message_id: 'msg-abc',
      total_amount: 4936.20,
      contact_id: 'contact-789',
      quickbooks_doc_number: 'EST-1042',
      quickbooks_customer_id: 'qb-cust-123',
      status: 'won',
      items: [],
      notes: null,
      created_at: '2026-01-18T00:00:00Z',
      updated_at: '2026-01-18T00:00:00Z',
    });

    vi.mocked(getContactById).mockResolvedValue(null);

    const result = await handleJobCompletion('job-123');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Contact not found');
  });

  it('returns error if QuickBooks invoice creation fails', async () => {
    vi.mocked(getJobById).mockResolvedValue({
      id: 'job-123',
      estimate_id: 'est-456',
      contact_id: 'contact-789',
      description: 'Channel Letters',
      stage: 'completed',
      total_amount: 4936.20,
      eta: null,
      quickbooks_invoice_id: null,
      notes: null,
      created_at: '2026-01-18T00:00:00Z',
      updated_at: '2026-01-18T00:00:00Z',
    });

    vi.mocked(getEstimateById).mockResolvedValue({
      id: 'est-456',
      quickbooks_estimate_id: 'qb-est-123',
      gmail_message_id: 'msg-abc',
      total_amount: 4936.20,
      contact_id: 'contact-789',
      quickbooks_doc_number: 'EST-1042',
      quickbooks_customer_id: 'qb-cust-123',
      status: 'won',
      items: [],
      notes: null,
      created_at: '2026-01-18T00:00:00Z',
      updated_at: '2026-01-18T00:00:00Z',
    });

    vi.mocked(getContactById).mockResolvedValue({
      id: 'contact-789',
      name: 'Minseok Kim',
      email: 'minseok@samsung.com',
      company: 'Samsung',
      is_active: true,
      created_at: '2026-01-18T00:00:00Z',
    });

    vi.mocked(createInvoiceFromEstimate).mockResolvedValue(null);

    const result = await handleJobCompletion('job-123');

    expect(result.success).toBe(false);
    expect(result.error).toContain('QuickBooks invoice');
  });

  it('returns error if PDF download fails', async () => {
    vi.mocked(getJobById).mockResolvedValue({
      id: 'job-123',
      estimate_id: 'est-456',
      contact_id: 'contact-789',
      description: 'Channel Letters',
      stage: 'completed',
      total_amount: 4936.20,
      eta: null,
      quickbooks_invoice_id: null,
      notes: null,
      created_at: '2026-01-18T00:00:00Z',
      updated_at: '2026-01-18T00:00:00Z',
    });

    vi.mocked(getEstimateById).mockResolvedValue({
      id: 'est-456',
      quickbooks_estimate_id: 'qb-est-123',
      gmail_message_id: 'msg-abc',
      total_amount: 4936.20,
      contact_id: 'contact-789',
      quickbooks_doc_number: 'EST-1042',
      quickbooks_customer_id: 'qb-cust-123',
      status: 'won',
      items: [],
      notes: null,
      created_at: '2026-01-18T00:00:00Z',
      updated_at: '2026-01-18T00:00:00Z',
    });

    vi.mocked(getContactById).mockResolvedValue({
      id: 'contact-789',
      name: 'Minseok Kim',
      email: 'minseok@samsung.com',
      company: 'Samsung',
      is_active: true,
      created_at: '2026-01-18T00:00:00Z',
    });

    vi.mocked(createInvoiceFromEstimate).mockResolvedValue({
      Id: 'qb-inv-456',
      DocNumber: 'INV-1042',
      TotalAmt: 4936.20,
      CustomerRef: { value: 'qb-cust-123' },
      Line: [],
    });

    vi.mocked(getInvoicePdf).mockResolvedValue(null);

    const result = await handleJobCompletion('job-123');

    expect(result.success).toBe(false);
    expect(result.error).toContain('PDF');
  });

  it('returns error if local invoice record creation fails', async () => {
    vi.mocked(getJobById).mockResolvedValue({
      id: 'job-123',
      estimate_id: 'est-456',
      contact_id: 'contact-789',
      description: 'Channel Letters',
      stage: 'completed',
      total_amount: 4936.20,
      eta: null,
      quickbooks_invoice_id: null,
      notes: null,
      created_at: '2026-01-18T00:00:00Z',
      updated_at: '2026-01-18T00:00:00Z',
    });

    vi.mocked(getEstimateById).mockResolvedValue({
      id: 'est-456',
      quickbooks_estimate_id: 'qb-est-123',
      gmail_message_id: 'msg-abc',
      total_amount: 4936.20,
      contact_id: 'contact-789',
      quickbooks_doc_number: 'EST-1042',
      quickbooks_customer_id: 'qb-cust-123',
      status: 'won',
      items: [],
      notes: null,
      created_at: '2026-01-18T00:00:00Z',
      updated_at: '2026-01-18T00:00:00Z',
    });

    vi.mocked(getContactById).mockResolvedValue({
      id: 'contact-789',
      name: 'Minseok Kim',
      email: 'minseok@samsung.com',
      company: 'Samsung',
      is_active: true,
      created_at: '2026-01-18T00:00:00Z',
    });

    vi.mocked(createInvoiceFromEstimate).mockResolvedValue({
      Id: 'qb-inv-456',
      DocNumber: 'INV-1042',
      TotalAmt: 4936.20,
      CustomerRef: { value: 'qb-cust-123' },
      Line: [],
    });

    vi.mocked(getInvoicePdf).mockResolvedValue(Buffer.from('%PDF'));

    vi.mocked(createInvoice).mockResolvedValue(null);

    const result = await handleJobCompletion('job-123');

    expect(result.success).toBe(false);
    expect(result.error).toContain('invoice record');
  });

  it('handles exceptions gracefully', async () => {
    vi.mocked(getJobById).mockRejectedValue(new Error('Database connection failed'));

    const result = await handleJobCompletion('job-123');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Database connection failed');
  });
});
