import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { EstimatesTable } from '@/components/estimates-table';
import type { EstimateWithContact } from '@/lib/database.types';

async function getEstimates(): Promise<EstimateWithContact[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('estimates')
    .select(`
      *,
      contact:contacts(*)
    `)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Failed to fetch estimates:', error);
    return [];
  }

  return data as EstimateWithContact[];
}

export default async function EstimatesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const estimates = await getEstimates();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Estimates</h1>
        <p className="text-muted-foreground">View and track all estimates</p>
      </div>

      <EstimatesTable estimates={estimates} />
    </div>
  );
}
