import { supabase } from './client.js';

export interface Job {
  id: string;
  estimate_id: string | null;
  contact_id: string | null;
  description: string;
  stage: 'pending' | 'in_production' | 'ready' | 'installed' | 'completed';
  eta: string | null;
  total_amount: number | null;
  quickbooks_invoice_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateJobInput {
  estimateId: string;
  contactId: string | null;
  description: string;
  totalAmount: number | null;
}

export async function createJob(input: CreateJobInput): Promise<Job | null> {
  const { data, error } = await supabase
    .from('jobs')
    .insert({
      estimate_id: input.estimateId,
      contact_id: input.contactId,
      description: input.description,
      total_amount: input.totalAmount,
      stage: 'pending',
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to create job:', error);
    return null;
  }

  return data as Job;
}

export async function getJobById(id: string): Promise<Job | null> {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) return null;
  return data as Job;
}

export async function getActiveJobs(): Promise<Job[]> {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .neq('stage', 'completed')
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return data as Job[];
}

export async function updateJobStage(id: string, stage: Job['stage']): Promise<boolean> {
  const { error } = await supabase
    .from('jobs')
    .update({ stage, updated_at: new Date().toISOString() })
    .eq('id', id);

  return !error;
}

export async function updateJobEta(id: string, eta: string): Promise<boolean> {
  const { error } = await supabase
    .from('jobs')
    .update({ eta, updated_at: new Date().toISOString() })
    .eq('id', id);

  return !error;
}

export async function findJobByPrefix(prefix: string): Promise<Job | null> {
  const jobs = await getActiveJobs();
  return jobs.find(j => j.id.startsWith(prefix)) || null;
}
