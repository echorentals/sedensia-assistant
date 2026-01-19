// src/modules/invoicing/handler.ts
import { getJobById, getEstimateById, createInvoice, getContactById } from '../../db/index.js';
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

    const language = 'ko';

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
