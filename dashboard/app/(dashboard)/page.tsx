import { createClient } from '@/lib/supabase/server';
import { StatsCards } from '@/components/stats-cards';

async function getStats() {
  const supabase = await createClient();

  // Active jobs count
  const { count: activeJobs } = await supabase
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .neq('stage', 'completed');

  // Pending estimates count
  const { count: pendingEstimates } = await supabase
    .from('estimates')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'sent');

  // Win rate (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: recentEstimates } = await supabase
    .from('estimates')
    .select('status')
    .gte('created_at', thirtyDaysAgo.toISOString())
    .in('status', ['won', 'lost']);

  const won = recentEstimates?.filter(e => e.status === 'won').length || 0;
  const total = recentEstimates?.length || 0;
  const winRate = total > 0 ? Math.round((won / total) * 100) : 0;

  // Monthly revenue
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { data: wonEstimates } = await supabase
    .from('estimates')
    .select('total_amount')
    .eq('status', 'won')
    .gte('updated_at', startOfMonth.toISOString());

  const monthlyRevenue = wonEstimates?.reduce((sum, e) => sum + (e.total_amount || 0), 0) || 0;

  return {
    activeJobs: activeJobs || 0,
    pendingEstimates: pendingEstimates || 0,
    winRate,
    monthlyRevenue,
  };
}

export default async function DashboardPage() {
  const stats = await getStats();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your business</p>
      </div>

      <StatsCards {...stats} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white rounded-lg p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-4">Recent Activity</h2>
          <p className="text-muted-foreground">Coming soon...</p>
        </div>

        <div className="bg-white rounded-lg p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
          <p className="text-muted-foreground">Coming soon...</p>
        </div>
      </div>
    </div>
  );
}
