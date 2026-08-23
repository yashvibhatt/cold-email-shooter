'use client';

import { useCallback, useRef, useState } from 'react';
import {
  Upload, CheckCircle2, XCircle, AlertTriangle, Download,
  Loader2, Search, X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { outreachApi } from '@/lib/api';
import type { OutreachCheckResponse, OutreachResultRow } from '@/lib/api';
import { cn } from '@/lib/utils';

function toCsv(rows: OutreachResultRow[]): string {
  const headers = ['email', 'firstName', 'lastName', 'company', 'title'];
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

export function OutreachCheck() {
  const [isDragging, setIsDragging] = useState(false);
  const [result, setResult] = useState<OutreachCheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [filter, setFilter] = useState<'all' | 'contacted' | 'new'>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setResult(null);
    setIsChecking(true);
    try {
      const res = await outreachApi.check(file);
      setResult(res.data);
    } catch (err: any) {
      setError(err.message ?? 'Outreach check failed');
    } finally {
      setIsChecking(false);
    }
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  };

  const visibleRows = result?.results.filter((r) => {
    if (filter === 'contacted') return r.alreadyContacted;
    if (filter === 'new') return !r.alreadyContacted;
    return true;
  });

  return (
    <div className="space-y-5">
      <div className="gradient-border p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-slate-200 text-sm">Check outreach history</h3>
          <span className="text-xs text-muted ml-auto">
            Searches your Outlook Sent Items for each recipient
          </span>
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            'border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer transition-all duration-200',
            'hover:border-primary/50 hover:bg-primary/5',
            isDragging && 'drop-active'
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
          <div className="flex flex-col items-center gap-2">
            {isChecking
              ? <Loader2 className="w-8 h-8 text-primary animate-spin" />
              : <Upload className="w-8 h-8 text-muted" />}
            <p className="text-sm text-slate-300">
              {isChecking ? 'Checking recipients against Outlook…' : 'Drop a CSV, or click to browse'}
            </p>
            <p className="text-xs text-muted">Needs an Email column · Apollo, LinkedIn, or generic CSV</p>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            {error}
          </div>
        )}
      </div>

      {result && (
        <div className="gradient-border p-5 space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-surface-3 border border-border rounded-lg p-3">
              <div className="text-xs text-muted">Total checked</div>
              <div className="text-xl font-bold text-slate-200">{result.total}</div>
            </div>
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
              <div className="text-xs text-red-400">Already contacted</div>
              <div className="text-xl font-bold text-red-400">{result.contacted}</div>
            </div>
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
              <div className="text-xs text-emerald-400">New / safe to outreach</div>
              <div className="text-xl font-bold text-emerald-400">{result.new}</div>
            </div>
          </div>

          {/* Filter + export */}
          <div className="flex items-center gap-2">
            <div className="flex gap-1 bg-surface rounded-lg p-1 border border-border">
              {(['all', 'new', 'contacted'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    'px-3 py-1 rounded-md text-xs font-medium capitalize transition-all',
                    filter === f ? 'bg-surface-3 text-slate-200 border border-border-2' : 'text-muted hover:text-slate-300'
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="ml-auto"
              onClick={() => downloadCsv('new-recipients.csv', toCsv(result.results.filter((r) => !r.alreadyContacted)))}
              disabled={result.new === 0}
            >
              <Download className="w-3.5 h-3.5" />
              Download clean list ({result.new})
            </Button>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-3 text-xs text-muted uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Email</th>
                  <th className="px-3 py-2 text-left font-medium">Name</th>
                  <th className="px-3 py-2 text-left font-medium">Company</th>
                  <th className="px-3 py-2 text-left font-medium">Last contact</th>
                  <th className="px-3 py-2 text-left font-medium">Subject</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleRows?.map((r) => (
                  <tr key={r.email} className="hover:bg-surface-2/50">
                    <td className="px-3 py-2">
                      {r.checkError ? (
                        <span className="flex items-center gap-1 text-amber-400 text-xs" title={r.checkError}>
                          <AlertTriangle className="w-3.5 h-3.5" /> Error
                        </span>
                      ) : r.alreadyContacted ? (
                        <span className="flex items-center gap-1 text-red-400 text-xs">
                          <XCircle className="w-3.5 h-3.5" /> Contacted
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-emerald-400 text-xs">
                          <CheckCircle2 className="w-3.5 h-3.5" /> New
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-300 font-mono text-xs">{r.email}</td>
                    <td className="px-3 py-2 text-slate-300">{r.fullName || '—'}</td>
                    <td className="px-3 py-2 text-slate-400">{r.company || '—'}</td>
                    <td className="px-3 py-2 text-slate-400 text-xs">
                      {r.lastContactDate ? new Date(r.lastContactDate).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-400 text-xs truncate max-w-[200px]">{r.lastSubject || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
