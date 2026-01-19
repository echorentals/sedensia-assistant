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
  turnaround_days: number;
  created_at: string;
  updated_at: string;
}

export interface CreateEstimateInput {
  contactId?: string;
  gmailMessageId?: string;
  items: EstimateItem[];
  notes?: string;
  turnaroundDays?: number;
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
      turnaround_days: input.turnaroundDays || 14,
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

export async function updateEstimateTurnaround(id: string, turnaroundDays: number): Promise<boolean> {
  const { error } = await supabase
    .from('estimates')
    .update({
      turnaround_days: turnaroundDays,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    console.error('Failed to update estimate turnaround:', error);
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

export async function findEstimateByGmailMessageId(gmailMessageId: string): Promise<Estimate | null> {
  const { data, error } = await supabase
    .from('estimates')
    .select('*')
    .eq('gmail_message_id', gmailMessageId)
    .single();

  if (error || !data) {
    return null;
  }

  return data as Estimate;
}

export async function findSentEstimateByContactId(contactId: string): Promise<Estimate | null> {
  // Find the most recent sent estimate for a contact
  const { data, error } = await supabase
    .from('estimates')
    .select('*')
    .eq('contact_id', contactId)
    .eq('status', 'sent')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return null;
  }

  return data as Estimate;
}
