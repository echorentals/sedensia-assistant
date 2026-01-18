'use client';

import { useState } from 'react';
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
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import type { JobWithContact } from '@/lib/database.types';
import { updateJobStage, updateJobEta } from '@/app/(dashboard)/jobs/actions';

const stageColors: Record<string, string> = {
  pending: 'bg-slate-500',
  in_production: 'bg-blue-500',
  ready: 'bg-green-500',
  installed: 'bg-purple-500',
  completed: 'bg-gray-400',
};

const stageLabels: Record<string, string> = {
  pending: 'Pending',
  in_production: 'In Production',
  ready: 'Ready',
  installed: 'Installed',
  completed: 'Completed',
};

interface JobsTableProps {
  jobs: JobWithContact[];
}

export function JobsTable({ jobs }: JobsTableProps) {
  const [editingEta, setEditingEta] = useState<string | null>(null);
  const [etaValue, setEtaValue] = useState('');

  async function handleStageChange(jobId: string, stage: string) {
    await updateJobStage(jobId, stage);
  }

  async function handleEtaSave(jobId: string) {
    if (etaValue) {
      await updateJobEta(jobId, etaValue);
    }
    setEditingEta(null);
    setEtaValue('');
  }

  return (
    <div className="bg-white rounded-lg shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>ETA</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => (
            <TableRow key={job.id}>
              <TableCell>
                <div>
                  <div className="font-medium">{job.contact?.name || 'Unknown'}</div>
                  <div className="text-sm text-muted-foreground">
                    {job.contact?.company || ''}
                  </div>
                </div>
              </TableCell>
              <TableCell className="max-w-xs truncate">
                {job.description}
              </TableCell>
              <TableCell>
                <Select
                  value={job.stage}
                  onValueChange={(value) => handleStageChange(job.id, value)}
                >
                  <SelectTrigger className="w-36">
                    <Badge className={stageColors[job.stage]}>
                      {stageLabels[job.stage]}
                    </Badge>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(stageLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                {editingEta === job.id ? (
                  <div className="flex gap-2">
                    <Input
                      type="date"
                      value={etaValue}
                      onChange={(e) => setEtaValue(e.target.value)}
                      className="w-36"
                    />
                    <Button size="sm" onClick={() => handleEtaSave(job.id)}>
                      Save
                    </Button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setEditingEta(job.id);
                      setEtaValue(job.eta || '');
                    }}
                    className="text-left hover:underline"
                  >
                    {job.eta ? format(new Date(job.eta), 'MMM d, yyyy') : 'Set ETA'}
                  </button>
                )}
              </TableCell>
              <TableCell className="text-right">
                {job.total_amount
                  ? `$${job.total_amount.toLocaleString()}`
                  : '-'}
              </TableCell>
            </TableRow>
          ))}
          {jobs.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                No jobs found
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
