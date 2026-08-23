'use client';

import { useState } from 'react';
import {
  Ban, RotateCcw, Trash2, ChevronDown, ChevronUp, AlertTriangle, Info,
  Filter, Search, RefreshCw
} from 'lucide-react';
import { useEmails, useCancelEmail, useRetryEmail, useDeleteEmail } from '@/hooks/useEmails';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { cn, formatDatetime, formatRelative, truncate } from '@/lib/utils';
import type { EmailJob, EmailStatus, EmailFilters } from '@/lib/api';

const STATUS_OPTIONS: Array<{ value: EmailStatus | ''; label: string }> = [
  { value: '', label: 'All Status' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'SCHEDULED', label: 'Scheduled' },
  { value: 'SENT', label: 'Sent' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

interface RowActionsProps {
  job: EmailJob;
  onCancel: () => void;
  onRetry: () => void;
  onDelete: () => void;
  loading: boolean;
}

function RowActions({ job, onCancel, onRetry, onDelete, loading }: RowActionsProps) {
  return (
    <div className="flex items-center gap-1">
      {['PENDING', 'SCHEDULED'].includes(job.status) && (
        <Button variant="ghost" size="sm" onClick={onCancel} loading={loading} title="Cancel">
          <Ban className="w-3.5 h-3.5 text-amber-400" />
        </Button>
      )}
      {job.status === 'FAILED' && (
        <Button variant="ghost" size="sm" onClick={onRetry} loading={loading} title="Retry">
          <RotateCcw className="w-3.5 h-3.5 text-blue-400" />
        </Button>
      )}
      {['SENT', 'FAILED', 'CANCELLED'].includes(job.status) && (
        <Button variant="ghost" size="sm" onClick={onDelete} loading={loading} title="Delete">
          <Trash2 className="w-3.5 h-3.5 text-red-400" />
        </Button>
      )}
    </div>
  );
}

interface ExpandedRowProps {
  job: EmailJob;
}

function ExpandedRow({ job }: ExpandedRowProps) {
  return (
    <div className="px-6 pb-5 pt-2 grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="space-y-2">
        <div className="text-xs text-muted font-mono uppercase tracking-wider">Email Body</div>
        <div className="bg-surface-3 border border-border rounded-lg p-3 text-xs text-slate-400 font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
          {job.body}
        </div>
      </div>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <div className="text-xs text-muted font-mono uppercase tracking-wider">Details</div>
          <dl className="space-y-1 text-xs">
            <div className="flex gap-2">
              <dt className="text-subtle w-24 flex-shrink-0">Job ID:</dt>
              <dd className="text-slate-400 font-mono truncate">{job.id}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-subtle w-24 flex-shrink-0">Scheduled:</dt>
              <dd className="text-slate-400 font-mono">
                {formatDatetime(job.scheduledDatetime, job.timezone)}
              </dd>
            </div>
            {job.sentAt && (
              <div className="flex gap-2">
                <dt className="text-subtle w-24 flex-shrink-0">Sent at:</dt>
                <dd className="text-emerald-400 font-mono">{formatDatetime(job.sentAt)}</dd>
              </div>
            )}
            {job.failedReason && (
              <div className="flex gap-2">
                <dt className="text-subtle w-24 flex-shrink-0">Failure:</dt>
                <dd className="text-red-400">{job.failedReason}</dd>
              </div>
            )}
            {job.sourceFile && (
              <div className="flex gap-2">
                <dt className="text-subtle w-24 flex-shrink-0">Source file:</dt>
                <dd className="text-slate-400">{job.sourceFile.originalName}</dd>
              </div>
            )}
          </dl>
        </div>

        {job.sendLogs && job.sendLogs.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs text-muted font-mono uppercase tracking-wider">Recent Logs</div>
            <div className="space-y-1">
              {job.sendLogs.map((log) => (
                <div key={log.id} className="flex items-start gap-2 text-xs">
                  <span
                    className={cn(
                      'w-2 h-2 rounded-full flex-shrink-0 mt-0.5',
                      log.status === 'SUCCESS' ? 'bg-emerald-400' : 'bg-red-400'
                    )}
                  />
                  <span className="text-slate-400 flex-1 truncate">{log.message}</span>
                  <span className="text-subtle flex-shrink-0">{formatRelative(log.createdAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function EmailTable() {
  const [filters, setFilters] = useState<EmailFilters>({ page: '1', limit: '25' });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching } = useEmails(filters);
  const cancelMutation = useCancelEmail();
  const retryMutation = useRetryEmail();
  const deleteMutation = useDeleteEmail();

  const handleAction = async (id: string, action: () => Promise<unknown>) => {
    setActionLoading(id);
    try {
      await action();
    } finally {
      setActionLoading(null);
    }
  };

  const setFilter = (key: keyof EmailFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value || undefined, page: '1' }));
  };

  const emails = data?.emails ?? [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-xs text-muted">
          <Filter className="w-3.5 h-3.5" />
          <span>Filter</span>
        </div>

        <select
          value={filters.status ?? ''}
          onChange={(e) => setFilter('status', e.target.value)}
          className="bg-surface-2 border border-border text-slate-300 text-xs px-3 py-1.5 rounded-lg focus:outline-none focus:border-primary"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <input
          type="date"
          value={filters.dateFrom ?? ''}
          onChange={(e) => setFilter('dateFrom', e.target.value)}
          className="bg-surface-2 border border-border text-slate-300 text-xs px-3 py-1.5 rounded-lg focus:outline-none focus:border-primary"
          placeholder="From"
        />
        <input
          type="date"
          value={filters.dateTo ?? ''}
          onChange={(e) => setFilter('dateTo', e.target.value)}
          className="bg-surface-2 border border-border text-slate-300 text-xs px-3 py-1.5 rounded-lg focus:outline-none focus:border-primary"
          placeholder="To"
        />

        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          loading={isFetching}
          className="ml-auto"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </Button>
      </div>

      {/* Table */}
      <div className="gradient-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-surface-2/50">
                <th className="p-3 text-left text-muted font-medium w-10" />
                <th className="p-3 text-left text-muted font-medium">Recipient</th>
                <th className="p-3 text-left text-muted font-medium">Subject</th>
                <th className="p-3 text-left text-muted font-medium">Scheduled</th>
                <th className="p-3 text-left text-muted font-medium">Status</th>
                <th className="p-3 text-left text-muted font-medium">Retries</th>
                <th className="p-3 text-left text-muted font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading &&
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/50">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="p-3">
                        <div className="h-3 bg-surface-3 rounded animate-pulse" style={{ width: `${40 + Math.random() * 40}%` }} />
                      </td>
                    ))}
                  </tr>
                ))}

              {!isLoading && emails.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-10 text-center text-muted">
                    <div className="flex flex-col items-center gap-2">
                      <Info className="w-8 h-8 opacity-30" />
                      <span>No emails match the current filters</span>
                    </div>
                  </td>
                </tr>
              )}

              {emails.map((job) => (
                <>
                  <tr
                    key={job.id}
                    className={cn(
                      'border-b border-border/50 table-row-hover cursor-pointer',
                      expandedId === job.id && 'bg-surface-2/40'
                    )}
                    onClick={() => setExpandedId(expandedId === job.id ? null : job.id)}
                  >
                    <td className="p-3 text-subtle">
                      {expandedId === job.id
                        ? <ChevronUp className="w-3.5 h-3.5" />
                        : <ChevronDown className="w-3.5 h-3.5" />}
                    </td>
                    <td className="p-3 text-slate-300 font-mono max-w-[160px] truncate">
                      <span
                        className={cn(
                          'inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle',
                          job.provider === 'GMAIL' ? 'bg-red-400' : 'bg-blue-400'
                        )}
                        title={job.provider === 'GMAIL' ? 'Sent via Gmail' : 'Sent via Outlook'}
                      />
                      {job.recipientEmail}
                    </td>
                    <td className="p-3 text-slate-400 max-w-[220px] truncate">
                      {truncate(job.subject, 50)}
                    </td>
                    <td className="p-3 text-slate-400 font-mono whitespace-nowrap">
                      {formatDatetime(job.scheduledDatetime, job.timezone)}
                    </td>
                    <td className="p-3">
                      <StatusBadge status={job.status} />
                    </td>
                    <td className="p-3 text-slate-500 font-mono">
                      {job.retryCount > 0 ? (
                        <span className="text-amber-400">{job.retryCount}×</span>
                      ) : '—'}
                    </td>
                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
                      <RowActions
                        job={job}
                        loading={actionLoading === job.id}
                        onCancel={() => handleAction(job.id, () => cancelMutation.mutateAsync(job.id))}
                        onRetry={() => handleAction(job.id, () => retryMutation.mutateAsync(job.id))}
                        onDelete={() => handleAction(job.id, () => deleteMutation.mutateAsync(job.id))}
                      />
                    </td>
                  </tr>
                  {expandedId === job.id && (
                    <tr key={`${job.id}-exp`} className="bg-surface/50 border-b border-border/50">
                      <td colSpan={7}>
                        <ExpandedRow job={job} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="p-3 border-t border-border flex items-center justify-between text-xs text-muted">
            <span>
              {((pagination.page - 1) * pagination.limit) + 1}–
              {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
              {pagination.total} emails
            </span>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={pagination.page <= 1}
                onClick={() => setFilter('page', String(pagination.page - 1))}
              >
                Previous
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => setFilter('page', String(pagination.page + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
