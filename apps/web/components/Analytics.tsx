'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, Download, RefreshCw, TrendingDown, Mail, Loader2, Server, Boxes,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { analyticsApi } from '@/lib/api';
import type { BounceRow } from '@/lib/api';

function startOfLocalDay(daysAgo: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d;
}

const RANGE_OPTIONS = [
  { label: 'Today', key: 'today', since: () => startOfLocalDay(0) },
  { label: 'Last 3 days', key: '3d', since: () => startOfLocalDay(2) },
  { label: 'Last 7 days', key: '7d', since: () => startOfLocalDay(6) },
];

function toCsv(rows: BounceRow[]): string {
  const headers = ['recipientEmail', 'reason', 'source', 'fromAddress', 'originalSubject', 'originalSentAt', 'bounceReceivedAt'];
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(headers.map((h) => `"${String((r as any)[h] ?? '').replace(/"/g, '""')}"`).join(','));
  }
  return lines.join('\n');
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function BounceGroup({
  title, icon, rows, filenamePrefix,
}: {
  title: string;
  icon: React.ReactNode;
  rows: BounceRow[];
  filenamePrefix: string;
}) {
  if (rows.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
          {icon}
          {title}
          <span className="text-xs bg-surface-3 text-muted px-2 py-0.5 rounded-full font-mono">{rows.length}</span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => downloadCsv(`${filenamePrefix}.csv`, toCsv(rows))}
        >
          <Download className="w-3.5 h-3.5" />
          Download ({rows.length})
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-3 text-xs text-muted uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Recipient</th>
              <th className="px-3 py-2 text-left font-medium">Reason</th>
              <th className="px-3 py-2 text-left font-medium">Bounced from</th>
              <th className="px-3 py-2 text-left font-medium">Original subject</th>
              <th className="px-3 py-2 text-left font-medium">Originally sent</th>
              <th className="px-3 py-2 text-left font-medium">Bounce received</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-surface-2/50">
                <td className="px-3 py-2 text-slate-300 font-mono text-xs">
                  {r.recipientEmail ?? <span className="text-amber-400">Could not parse</span>}
                </td>
                <td className="px-3 py-2 text-red-400 text-xs">{r.reason}</td>
                <td className="px-3 py-2 text-slate-500 font-mono text-xs truncate max-w-[180px]">{r.fromAddress}</td>
                <td className="px-3 py-2 text-slate-400 text-xs truncate max-w-[220px]">{r.originalSubject ?? '—'}</td>
                <td className="px-3 py-2 text-slate-400 text-xs">
                  {r.originalSentAt ? new Date(r.originalSentAt).toLocaleString() : '—'}
                </td>
                <td className="px-3 py-2 text-slate-400 text-xs">
                  {new Date(r.bounceReceivedAt).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Analytics() {
  const [rangeKey, setRangeKey] = useState('today');

  const since = (RANGE_OPTIONS.find((r) => r.key === rangeKey) ?? RANGE_OPTIONS[0]).since().toISOString();

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['analytics', 'bounces', rangeKey],
    queryFn: async () => (await analyticsApi.bounces(since)).data,
    staleTime: 60 * 1000,
  });

  const bounceRows = data?.bounces ?? [];
  const daemonRows = bounceRows.filter((r) => r.source === 'Mail Delivery Subsystem');
  const otherRows = bounceRows.filter((r) => r.source === 'Other');

  return (
    <div className="space-y-5">
      <div className="gradient-border p-5 space-y-4">
        <div className="flex items-center gap-2">
          <TrendingDown className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-slate-200 text-sm">Bounce analytics</h3>
          <span className="text-xs text-muted ml-auto">
            Scans your Outlook Inbox for undeliverable / NDR notifications
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-surface rounded-lg p-1 border border-border">
            {RANGE_OPTIONS.map((r) => (
              <button
                key={r.key}
                onClick={() => setRangeKey(r.key)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  rangeKey === r.key
                    ? 'bg-surface-3 text-slate-200 border border-border-2'
                    : 'text-muted hover:text-slate-300'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <Button variant="secondary" size="sm" onClick={() => refetch()} loading={isFetching}>
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </Button>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            {(error as Error).message}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 text-muted text-sm py-16">
          <Loader2 className="w-5 h-5 animate-spin" />
          Scanning inbox for bounce notifications…
        </div>
      ) : data && (
        <div className="gradient-border p-5 space-y-5">
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-surface-3 border border-border rounded-lg p-3">
              <div className="text-xs text-muted flex items-center gap-1"><Mail className="w-3 h-3" /> Sent in range</div>
              <div className="text-xl font-bold text-slate-200">{data.totalSentSince}</div>
            </div>
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
              <div className="text-xs text-red-400">Bounced</div>
              <div className="text-xl font-bold text-red-400">{data.totalBounced}</div>
            </div>
            <div className="bg-surface-3 border border-border rounded-lg p-3">
              <div className="text-xs text-muted flex items-center gap-1"><Server className="w-3 h-3" /> Mail Delivery Subsystem</div>
              <div className="text-xl font-bold text-slate-200">{daemonRows.length}</div>
            </div>
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
              <div className="text-xs text-amber-400">Bounce rate</div>
              <div className="text-xl font-bold text-amber-400">{(data.bounceRate * 100).toFixed(1)}%</div>
            </div>
          </div>

          {bounceRows.length === 0 ? (
            <p className="text-sm text-muted text-center py-10">No bounce notifications found in this range.</p>
          ) : (
            <>
              <BounceGroup
                title="Mail Delivery Subsystem"
                icon={<Server className="w-4 h-4 text-muted" />}
                rows={daemonRows}
                filenamePrefix="bounces-mail-delivery-subsystem"
              />
              <BounceGroup
                title="Other bounce reasons"
                icon={<Boxes className="w-4 h-4 text-muted" />}
                rows={otherRows}
                filenamePrefix="bounces-other"
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
