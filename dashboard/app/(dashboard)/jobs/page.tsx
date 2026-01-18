import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { JobsTable } from '@/components/jobs-table';
import type { JobWithContact } from '@/lib/database.types';

async function getJobs(): Promise<JobWithContact[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('jobs')
    .select(`
      *,
      contact:contacts(*),
      estimate:estimates(*)
    `)
    .neq('stage', 'completed')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to fetch jobs:', error);
    return [];
  }

  return data as JobWithContact[];
}

export default async function JobsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const jobs = await getJobs();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Jobs</h1>
        <p className="text-muted-foreground">Manage active jobs and track progress</p>
      </div>

      <JobsTable jobs={jobs} />
    </div>
  );
}
