import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface PricingHistoryItem {
  id: string;
  description: string | null;
  width_inches: number | null;
  height_inches: number | null;
  unit_price: number;
  outcome: string | null;
  sign_type: { name: string } | null;
  material: { name: string } | null;
}

interface SignType {
  id: string;
  name: string;
}

async function getPricingData() {
  const supabase = await createClient();

  // Get pricing history
  const { data: history } = await supabase
    .from('pricing_history')
    .select(`
      *,
      sign_type:sign_types(name),
      material:materials(name)
    `)
    .order('created_at', { ascending: false })
    .limit(50);

  // Get win rate by sign type
  const { data: signTypes } = await supabase
    .from('sign_types')
    .select('id, name');

  const winRates: Record<string, { wins: number; total: number }> = {};

  if (signTypes) {
    for (const st of signTypes) {
      const { data } = await supabase
        .from('pricing_history')
        .select('outcome')
        .eq('sign_type_id', st.id)
        .in('outcome', ['won', 'lost']);

      if (data && data.length > 0) {
        const wins = data.filter(d => d.outcome === 'won').length;
        winRates[st.name] = { wins, total: data.length };
      }
    }
  }

  return { history: (history || []) as PricingHistoryItem[], winRates };
}

export default async function PricingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { history, winRates } = await getPricingData();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Pricing Analytics</h1>
        <p className="text-muted-foreground">Historical pricing and win rates</p>
      </div>

      {/* Win Rates by Sign Type */}
      {Object.keys(winRates).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Object.entries(winRates).map(([signType, { wins, total }]) => (
            <Card key={signType}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{signType}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {Math.round((wins / total) * 100)}%
                </div>
                <p className="text-xs text-muted-foreground">
                  {wins} won / {total} total
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Pricing History Table */}
      <div className="bg-white rounded-lg shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead>Sign Type</TableHead>
              <TableHead>Material</TableHead>
              <TableHead>Size</TableHead>
              <TableHead className="text-right">Unit Price</TableHead>
              <TableHead>Outcome</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="max-w-xs truncate">
                  {item.description || '-'}
                </TableCell>
                <TableCell>{item.sign_type?.name || '-'}</TableCell>
                <TableCell>{item.material?.name || '-'}</TableCell>
                <TableCell>
                  {item.width_inches && item.height_inches
                    ? `${item.width_inches}"×${item.height_inches}"`
                    : '-'}
                </TableCell>
                <TableCell className="text-right">
                  ${item.unit_price?.toLocaleString() || '-'}
                </TableCell>
                <TableCell>
                  <Badge
                    className={
                      item.outcome === 'won'
                        ? 'bg-green-500'
                        : item.outcome === 'lost'
                        ? 'bg-red-500'
                        : 'bg-slate-500'
                    }
                  >
                    {item.outcome || 'pending'}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
            {history.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No pricing history found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
