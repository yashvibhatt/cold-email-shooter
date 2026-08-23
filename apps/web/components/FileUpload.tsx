'use client';

import { useState, useCallback, useRef } from 'react';
import { Upload, FileSpreadsheet, AlertTriangle, CheckCircle2, X, Send, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { useUploadFile, useScheduleEmails } from '@/hooks/useEmails';
import { useGoogleStatus } from '@/hooks/useAuth';
import { cn, STATUS_CONFIG } from '@/lib/utils';
import type { ParsedRow, UploadResult, EmailProviderType } from '@/lib/api';

interface EditableRow extends ParsedRow {
  selected: boolean;
}

export function FileUpload() {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [scheduleResult, setScheduleResult] = useState<{
    scheduled: number; duplicates: number; errors: number;
  } | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [provider, setProvider] = useState<EmailProviderType>('OUTLOOK');
  const { data: googleStatus } = useGoogleStatus();

  const uploadMutation = useUploadFile();
  const scheduleMutation = useScheduleEmails();

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 5000);
  };

  const handleFile = useCallback(async (file: File) => {
    setUploadResult(null);
    setRows([]);
    setScheduleResult(null);
    try {
      const res = await uploadMutation.mutateAsync(file);
      setUploadResult(res.data);
      setRows(
        res.data.rows.map((r) => ({ ...r, selected: r.isValid }))
      );
    } catch (err: any) {
      showToast('error', err.message ?? 'Upload failed');
    }
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const toggleSelect = (idx: number) => {
    setRows((prev) =>
      prev.map((r, i) =>
        i === idx && r.isValid ? { ...r, selected: !r.selected } : r
      )
    );
  };

  const toggleAll = () => {
    const allValid = rows.filter((r) => r.isValid);
    const allSelected = allValid.every((r) => r.selected);
    setRows((prev) =>
      prev.map((r) => (r.isValid ? { ...r, selected: !allSelected } : r))
    );
  };

  const updateRow = (idx: number, field: keyof ParsedRow, value: string) => {
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r))
    );
  };

  const handleSchedule = async () => {
    const selected = rows.filter((r) => r.isValid && r.selected);
    if (selected.length === 0) {
      showToast('error', 'Select at least one valid row to schedule');
      return;
    }
    try {
      const res = await scheduleMutation.mutateAsync({
        rows: selected,
        sourceFileId: uploadResult?.fileId,
        provider,
      });
      setScheduleResult(res.data);
      showToast(
        res.data.errors > 0 ? 'error' : 'success',
        `Scheduled ${res.data.scheduled}, duplicates ${res.data.duplicates}, errors ${res.data.errors}`
      );
    } catch (err: any) {
      showToast('error', err.message ?? 'Schedule failed');
    }
  };

  const selectedCount = rows.filter((r) => r.isValid && r.selected).length;

  return (
    <div className="space-y-4">
      {/* Toast */}
      {toast && (
        <div className={cn(
          'animate-in fixed top-4 right-4 z-50 px-4 py-3 rounded-lg text-sm font-medium flex items-center gap-2 shadow-xl',
          toast.type === 'success'
            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
            : 'bg-red-500/15 text-red-400 border border-red-500/30'
        )}>
          {toast.type === 'success'
            ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
          {toast.msg}
          <button onClick={() => setToast(null)} className="ml-2 opacity-60 hover:opacity-100">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          'border-2 border-dashed border-border rounded-xl p-10 text-center cursor-pointer transition-all duration-200',
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
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
            {uploadMutation.isPending
              ? <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              : <Upload className="w-5 h-5 text-primary" />
            }
          </div>
          <div>
            <p className="text-slate-300 font-medium">
              {uploadMutation.isPending ? 'Parsing file…' : 'Drop your CSV or Excel file here'}
            </p>
            <p className="text-xs text-muted mt-1">
              CSV (.csv), Excel (.xlsx, .xls) · max 10 MB
            </p>
          </div>
          <div className="flex gap-2 text-xs text-subtle font-mono">
            {['recipient_email', 'subject', 'body', 'send_date', 'send_time'].map((col) => (
              <span key={col} className="bg-surface-3 border border-border px-2 py-0.5 rounded">{col}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Upload summary */}
      {uploadResult && (
        <div className="animate-in gradient-border p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="w-5 h-5 text-accent" />
              <span className="font-medium text-slate-200">{uploadResult.originalName}</span>
              <span className="text-xs text-muted font-mono">{uploadResult.totalRows} rows</span>
            </div>
            <div className="flex gap-3 text-xs font-mono">
              <span className="text-emerald-400">{uploadResult.validRows} valid</span>
              {uploadResult.invalidRows > 0 && (
                <span className="text-red-400">{uploadResult.invalidRows} invalid</span>
              )}
            </div>
          </div>

          {uploadResult.missingColumns.length > 0 && (
            <div className="flex items-center gap-2 p-3 bg-red-500/8 border border-red-500/20 rounded-lg text-xs text-red-400">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              Missing columns: {uploadResult.missingColumns.join(', ')}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="text-xs text-muted">{selectedCount} selected</div>
              <div className="flex gap-1 bg-surface rounded-lg p-1 border border-border">
                <button
                  type="button"
                  onClick={() => setProvider('OUTLOOK')}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs font-medium transition-all',
                    provider === 'OUTLOOK' ? 'bg-surface-3 text-slate-200 border border-border-2' : 'text-muted hover:text-slate-300'
                  )}
                >
                  Outlook
                </button>
                <button
                  type="button"
                  onClick={() => googleStatus?.connected && setProvider('GMAIL')}
                  disabled={!googleStatus?.connected}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs font-medium transition-all',
                    provider === 'GMAIL' ? 'bg-surface-3 text-slate-200 border border-border-2' : 'text-muted hover:text-slate-300',
                    !googleStatus?.connected && 'opacity-40 cursor-not-allowed'
                  )}
                >
                  Gmail{!googleStatus?.connected && ' (not connected)'}
                </button>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={toggleAll}>
                {rows.filter((r) => r.isValid).every((r) => r.selected) ? 'Deselect All' : 'Select All'}
              </Button>
              <Button
                size="sm"
                onClick={handleSchedule}
                loading={scheduleMutation.isPending}
                disabled={selectedCount === 0}
              >
                <Send className="w-3.5 h-3.5" />
                Schedule {selectedCount > 0 ? `(${selectedCount})` : ''}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Preview table */}
      {rows.length > 0 && (
        <div className="animate-in overflow-hidden gradient-border">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-surface-2/50">
                  <th className="w-10 p-3 text-center">
                    <input
                      type="checkbox"
                      checked={rows.filter((r) => r.isValid).every((r) => r.selected)}
                      onChange={toggleAll}
                      className="accent-primary"
                    />
                  </th>
                  <th className="p-3 text-left text-muted font-medium">#</th>
                  <th className="p-3 text-left text-muted font-medium">Recipient</th>
                  <th className="p-3 text-left text-muted font-medium">Subject</th>
                  <th className="p-3 text-left text-muted font-medium">Date</th>
                  <th className="p-3 text-left text-muted font-medium">Time</th>
                  <th className="p-3 text-left text-muted font-medium">TZ</th>
                  <th className="p-3 text-left text-muted font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <>
                    <tr
                      key={idx}
                      className={cn(
                        'border-b border-border/50 table-row-hover cursor-pointer',
                        !row.isValid && 'opacity-60 bg-red-500/4'
                      )}
                      onClick={() => setExpandedRow(expandedRow === idx ? null : idx)}
                    >
                      <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={row.selected}
                          disabled={!row.isValid}
                          onChange={() => toggleSelect(idx)}
                          className="accent-primary"
                        />
                      </td>
                      <td className="p-3 text-subtle font-mono">{row.rowIndex}</td>
                      <td className="p-3 text-slate-300 font-mono max-w-[160px] truncate">{row.recipient_email}</td>
                      <td className="p-3 text-slate-400 max-w-[200px] truncate">{row.subject}</td>
                      <td className="p-3 text-slate-400 font-mono">{row.send_date}</td>
                      <td className="p-3 text-slate-400 font-mono">{row.send_time}</td>
                      <td className="p-3 text-slate-500 font-mono">{row.timezone || 'UTC'}</td>
                      <td className="p-3">
                        {row.isValid ? (
                          <span className="text-emerald-400 flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Valid
                          </span>
                        ) : (
                          <span className="text-red-400 flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5" /> Errors
                          </span>
                        )}
                      </td>
                    </tr>
                    {expandedRow === idx && (
                      <tr key={`${idx}-expanded`} className="bg-surface-2/40">
                        <td colSpan={8} className="px-10 py-4 space-y-3">
                          {row.errors.length > 0 && (
                            <div className="space-y-1">
                              {row.errors.map((e, ei) => (
                                <div key={ei} className="text-xs text-red-400 flex items-center gap-2">
                                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                                  {e}
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-3">
                            {(['recipient_email', 'subject', 'send_date', 'send_time', 'timezone'] as const).map((field) => (
                              <div key={field} className="space-y-1">
                                <label className="text-xs text-muted font-mono">{field}</label>
                                <input
                                  value={row[field] || ''}
                                  onChange={(e) => updateRow(idx, field, e.target.value)}
                                  className="w-full bg-surface-3 border border-border text-slate-300 text-xs px-2 py-1.5 rounded font-mono focus:outline-none focus:border-primary"
                                />
                              </div>
                            ))}
                            <div className="col-span-2 space-y-1">
                              <label className="text-xs text-muted font-mono">body</label>
                              <textarea
                                value={row.body || ''}
                                onChange={(e) => updateRow(idx, 'body', e.target.value)}
                                rows={3}
                                className="w-full bg-surface-3 border border-border text-slate-300 text-xs px-2 py-1.5 rounded font-mono focus:outline-none focus:border-primary resize-y"
                              />
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Schedule result */}
      {scheduleResult && (
        <div className="animate-in gradient-border p-4 flex items-center gap-4 flex-wrap">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
          <span className="text-sm text-slate-300">Batch complete:</span>
          <span className="text-sm text-emerald-400 font-mono">{scheduleResult.scheduled} scheduled</span>
          {scheduleResult.duplicates > 0 && (
            <span className="text-sm text-amber-400 font-mono">{scheduleResult.duplicates} duplicates skipped</span>
          )}
          {scheduleResult.errors > 0 && (
            <span className="text-sm text-red-400 font-mono">{scheduleResult.errors} errors</span>
          )}
        </div>
      )}
    </div>
  );
}
