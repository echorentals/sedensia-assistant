import { format } from 'date-fns';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type { EstimateWithContact } from '@/lib/database.types';

const statusColors: Record<string, string> = {
  draft: 'bg-slate-500',
  sent: 'bg-blue-500',
  won: 'bg-green-500',
  lost: 'bg-red-500',
  expired: 'bg-gray-400',
};

interface EstimatesTableProps {
  estimates: EstimateWithContact[];
}

export function EstimatesTable({ estimates }: EstimatesTableProps) {
  return (
    <div className="bg-white rounded-lg shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Items</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {estimates.map((estimate) => (
            <TableRow key={estimate.id}>
              <TableCell>
                <div className="font-medium">
                  {estimate.contact?.name || 'Unknown'}
                </div>
                <div className="text-sm text-muted-foreground">
                  {estimate.contact?.company || ''}
                </div>
              </TableCell>
              <TableCell>
                {format(new Date(estimate.created_at), 'MMM d, yyyy')}
              </TableCell>
              <TableCell>
                <Badge className={statusColors[estimate.status]}>
                  {estimate.status.charAt(0).toUpperCase() + estimate.status.slice(1)}
                </Badge>
              </TableCell>
              <TableCell>
                {estimate.items?.length || 0} items
              </TableCell>
              <TableCell className="text-right">
                {estimate.total_amount
                  ? `$${estimate.total_amount.toLocaleString()}`
                  : '-'}
              </TableCell>
            </TableRow>
          ))}
          {estimates.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                No estimates found
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
