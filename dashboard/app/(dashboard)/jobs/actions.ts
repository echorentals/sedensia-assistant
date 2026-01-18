'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export async function updateJobStage(jobId: string, stage: string) {
  const supabase = await createClient();

  await supabase
    .from('jobs')
    .update({ stage, updated_at: new Date().toISOString() })
    .eq('id', jobId);

  revalidatePath('/jobs');
}

export async function updateJobEta(jobId: string, eta: string) {
  const supabase = await createClient();

  await supabase
    .from('jobs')
    .update({ eta, updated_at: new Date().toISOString() })
    .eq('id', jobId);

  revalidatePath('/jobs');
}
