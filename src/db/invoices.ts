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
