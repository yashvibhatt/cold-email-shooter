'use client';

import { useRef, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  CalendarSearch, AlertTriangle, Download, Loader2, ShieldCheck, Send,
  X, Sparkles, Reply, Users, EyeOff, Eye, CalendarClock,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { sentLogApi } from '@/lib/api';
import type { SentLogEntry, SentLogBulkSendResponse } from '@/lib/api';
import { cn } from '@/lib/utils';

function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayBoundsIso(dateStr: string): { since: string; until: string } {
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  return { since: start.toISOString(), until: end.toISOString() };
}

function toCsv(rows: SentLogEntry[]): string {
  const headers = ['recipientEmail', 'subject', 'sentDateTime'];
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

function entryKey(e: SentLogEntry): string {
  return `${e.recipientEmail}::${e.sentDateTime}`;
}

function VariableChips({ onInsert }: { onInsert: (variable: string) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      {['{{first_name}}', '{{company}}'].map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onInsert(v)}
          title={`Insert ${v} — personalized per recipient at send time`}
          className="flex items-center gap-1 text-xs bg-primary/10 text-blue-400 border border-primary/20 px-2 py-0.5 rounded-full hover:bg-primary/20 active:scale-95 transition-all font-mono w-fit"
        >
          <Sparkles className="w-2.5 h-2.5" />
          {v}
        </button>
      ))}
    </div>
  );
}

const DEFAULT_MESSAGE = `Hi {{first_name}},\n\nJust wanted to bump this back up in case it got lost in the shuffle. Would love to hear your thoughts.\n\nBest`;

function defaultScheduleValue(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
  d.setMinutes(0, 0, 0);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${h}:${min}`;
}

function SendTimingPicker({
  when, setWhen, scheduleValue, setScheduleValue,
}: {
  when: 'now' | 'later';
  setWhen: (w: 'now' | 'later') => void;
  scheduleValue: string;
  setScheduleValue: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex gap-1 bg-surface rounded-lg p-1 border border-border w-fit">
        <button
          type="button"
          onClick={() => setWhen('now')}
          className={cn(
            'px-3 py-1 rounded-md text-xs font-medium transition-all',
            when === 'now' ? 'bg-surface-3 text-slate-200 border border-border-2' : 'text-muted hover:text-slate-300'
          )}
        >
          Send now
        </button>
        <button
          type="button"
          onClick={() => setWhen('later')}
          className={cn(
            'flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium transition-all',
            when === 'later' ? 'bg-surface-3 text-slate-200 border border-border-2' : 'text-muted hover:text-slate-300'
          )}
        >
          <CalendarClock className="w-3 h-3" />
          Schedule for later
        </button>
      </div>
      {when === 'later' && (
        <input
          type="datetime-local"
          value={scheduleValue}
          onChange={(e) => setScheduleValue(e.target.value)}
          className="bg-surface-3 border border-border text-slate-200 text-sm px-3 py-1.5 rounded-lg focus:outline-none focus:border-primary"
        />
      )}
    </div>
  );
}

interface SendModalProps {
  entry: SentLogEntry;
  onClose: () => void;
  onSent: () => void;
}

function SendFollowUpModal({ entry, onClose, onSent }: SendModalProps) {
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [error, setError] = useState<string | null>(null);
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [scheduleValue, setScheduleValue] = useState(defaultScheduleValue());
  const [scheduledConfirmation, setScheduledConfirmation] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertVar = (variable: string) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? message.length;
    const end = el?.selectionEnd ?? message.length;
    const next = message.slice(0, start) + variable + message.slice(end);
    setMessage(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + variable.length, start + variable.length);
    });
  };

  const sendMutation = useMutation({
    mutationFn: () => {
      const scheduledAt = when === 'later' ? new Date(scheduleValue).toISOString() : undefined;
      return sentLogApi.send(entry, message, scheduledAt);
    },
    onSuccess: (res) => {
      if (res.data.scheduled && res.data.scheduledAt) {
        setScheduledConfirmation(new Date(res.data.scheduledAt).toLocaleString());
      } else {
        onSent();
        onClose();
      }
    },
    onError: (err: any) => setError(err.message ?? 'Failed to send follow-up'),
  });

  const isPastSchedule = when === 'later' && new Date(scheduleValue).getTime() <= Date.now();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in">
      <div className="gradient-border w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h3 className="font-semibold text-slate-200">Send follow-up</h3>
            <p className="text-xs text-muted mt-0.5">
              Sent as a threaded reply to &quot;{entry.subject}&quot; · {entry.recipientEmail}
            </p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-slate-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              {error}
            </div>
          )}

          {scheduledConfirmation ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                <CalendarClock className="w-4 h-4 flex-shrink-0" />
                Follow-up scheduled for {scheduledConfirmation}
              </div>
              <Button onClick={onClose} className="w-full">Done</Button>
            </div>
          ) : (
            <>
              <SendTimingPicker when={when} setWhen={setWhen} scheduleValue={scheduleValue} setScheduleValue={setScheduleValue} />

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted font-mono">Message</label>
                  <VariableChips onInsert={insertVar} />
                </div>
                <textarea
                  ref={textareaRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={7}
                  className="w-full bg-surface-3 border border-border text-slate-300 text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-primary resize-y leading-relaxed"
                />
              </div>

              <div className="flex gap-3 justify-end pt-1">
                <Button variant="secondary" onClick={onClose}>Cancel</Button>
                <Button
                  onClick={() => sendMutation.mutate()}
                  loading={sendMutation.isPending}
                  disabled={!message.trim() || isPastSchedule}
                >
                  {when === 'later' ? <CalendarClock className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
                  {when === 'later' ? 'Schedule follow-up' : 'Send follow-up'}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface BulkSendModalProps {
  entries: SentLogEntry[];
  onClose: () => void;
  onDone: (result: SentLogBulkSendResponse) => void;
}

function BulkSendModal({ entries, onClose, onDone }: BulkSendModalProps) {
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SentLogBulkSendResponse | null>(null);
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [scheduleValue, setScheduleValue] = useState(defaultScheduleValue());
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertVar = (variable: string) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? message.length;
    const end = el?.selectionEnd ?? message.length;
    const next = message.slice(0, start) + variable + message.slice(end);
    setMessage(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + variable.length, start + variable.length);
    });
  };

  const sendMutation = useMutation({
    mutationFn: () => {
      const scheduledAt = when === 'later' ? new Date(scheduleValue).toISOString() : undefined;
      return sentLogApi.bulkSend(entries, message, scheduledAt);
    },
    onSuccess: (res) => {
      setResult(res.data);
      onDone(res.data);
    },
    onError: (err: any) => setError(err.message ?? 'Bulk send failed'),
  });

  const isPastSchedule = when === 'later' && new Date(scheduleValue).getTime() <= Date.now();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in">
      <div className="gradient-border w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h3 className="font-semibold text-slate-200">Send bulk follow-up</h3>
            <p className="text-xs text-muted mt-0.5">
              Sent individually as threaded replies to {entries.length} recipient{entries.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-slate-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {error && (
            <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              {error}
            </div>
          )}

          {result ? (
            <div className="space-y-3">
              <div className="text-sm">
                {result.scheduled ? (
                  <span className="text-emerald-400 font-semibold flex items-center gap-1.5">
                    <CalendarClock className="w-4 h-4" />
                    {result.results.filter((r) => r.success).length} scheduled
                  </span>
                ) : (
                  <span className="text-emerald-400 font-semibold">{result.sent} sent</span>
                )}
                {result.failed > 0 && <span className="text-red-400 font-semibold ml-3">{result.failed} failed</span>}
              </div>
              {result.failed > 0 && (
                <div className="rounded-lg border border-border divide-y divide-border max-h-48 overflow-y-auto">
                  {result.results.filter((r) => !r.success).map((r, i) => (
                    <div key={i} className="px-3 py-2 text-xs">
                      <div className="text-slate-300 font-mono">{r.recipientEmail}</div>
                      <div className="text-red-400 mt-0.5">{r.error}</div>
                    </div>
                  ))}
                </div>
              )}
              <Button onClick={onClose} className="w-full">Done</Button>
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-border max-h-32 overflow-y-auto divide-y divide-border">
                {entries.map((e, i) => (
                  <div key={i} className="px-3 py-1.5 text-xs text-slate-400 font-mono truncate">
                    {e.recipientEmail}
                  </div>
                ))}
              </div>

              <SendTimingPicker when={when} setWhen={setWhen} scheduleValue={scheduleValue} setScheduleValue={setScheduleValue} />

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted font-mono">Message (sent to everyone selected)</label>
                  <VariableChips onInsert={insertVar} />
                </div>
                <textarea
                  ref={textareaRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={7}
                  className="w-full bg-surface-3 border border-border text-slate-300 text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-primary resize-y leading-relaxed"
                />
              </div>

              <div className="flex gap-3 justify-end pt-1">
                <Button variant="secondary" onClick={onClose}>Cancel</Button>
                <Button
                  onClick={() => sendMutation.mutate()}
                  loading={sendMutation.isPending}
                  disabled={!message.trim() || isPastSchedule}
                >
                  {when === 'later' ? <CalendarClock className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
                  {when === 'later' ? `Schedule ${entries.length}` : `Send to ${entries.length}`}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function SentLog() {
  const [dateStr, setDateStr] = useState(localDateString(new Date()));
  const [excludeResponded, setExcludeResponded] = useState(true);
  const [hasScanned, setHasScanned] = useState(false);
  const [view, setView] = useState<'active' | 'removed'>('active');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [sendModalEntry, setSendModalEntry] = useState<SentLogEntry | null>(null);
  const [showBulkModal, setShowBulkModal] = useState(false);

  const { since, until } = dayBoundsIso(dateStr);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['sent-log', dateStr, excludeResponded],
    queryFn: async () => (await sentLogApi.scan(since, until, excludeResponded)).data,
    enabled: false,
  });

  const runScan = () => {
    setHasScanned(true);
    setSelectedKeys(new Set());
    setView('active');
    refetch();
  };

  const activeEntries = data?.entries ?? [];
  const removedEntries = data?.excludedEntries ?? [];
  const visibleEntries = view === 'active' ? activeEntries : removedEntries;

  const selectedEntries = activeEntries.filter((e) => selectedKeys.has(entryKey(e)));
  const allSelected = activeEntries.length > 0 && activeEntries.every((e) => selectedKeys.has(entryKey(e)));

  const toggleOne = (e: SentLogEntry) => {
    const key = entryKey(e);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedKeys((prev) => {
      if (allSelected) return new Set();
      return new Set(activeEntries.map(entryKey));
    });
  };

  return (
    <div className="space-y-5">
      <div className="gradient-border p-5 space-y-4">
        <div className="flex items-center gap-2">
          <CalendarSearch className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-slate-200 text-sm">Sent log by date</h3>
          <span className="text-xs text-muted ml-auto">
            Scans your real Outlook Sent Items — catches manual sends too, not just campaigns
          </span>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="space-y-1">
            <label className="text-xs text-muted font-mono">Date</label>
            <input
              type="date"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              className="bg-surface-3 border border-border text-slate-300 text-sm px-3 py-1.5 rounded-lg focus:outline-none focus:border-primary"
            />
          </div>

          <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer mt-4">
            <input
              type="checkbox"
              checked={excludeResponded}
              onChange={(e) => setExcludeResponded(e.target.checked)}
              className="accent-primary"
            />
            Remove people who already replied
          </label>

          <Button size="sm" className="mt-4" onClick={runScan} loading={isFetching}>
            <Send className="w-3.5 h-3.5" />
            Scan sent folder
          </Button>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            {(error as Error).message}
          </div>
        )}
      </div>

      {isLoading || isFetching ? (
        <div className="flex items-center justify-center gap-2 text-muted text-sm py-16">
          <Loader2 className="w-5 h-5 animate-spin" />
          Scanning Outlook Sent Items…
        </div>
      ) : hasScanned && data && (
        <div className="gradient-border p-5 space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-surface-3 border border-border rounded-lg p-3">
              <div className="text-xs text-muted">Total sent that day</div>
              <div className="text-xl font-bold text-slate-200">{data.totalSent}</div>
            </div>
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
              <div className="text-xs text-emerald-400 flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> Already replied (removed)</div>
              <div className="text-xl font-bold text-emerald-400">{data.excludedCount}</div>
            </div>
            <div className="bg-surface-3 border border-border rounded-lg p-3">
              <div className="text-xs text-muted">Unique recipients shown</div>
              <div className="text-xl font-bold text-slate-200">{data.uniqueRecipients}</div>
            </div>
          </div>

          {/* View toggle */}
          <div className="flex items-center gap-2">
            <div className="flex gap-1 bg-surface rounded-lg p-1 border border-border">
              <button
                onClick={() => setView('active')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all',
                  view === 'active' ? 'bg-surface-3 text-slate-200 border border-border-2' : 'text-muted hover:text-slate-300'
                )}
              >
                <Eye className="w-3.5 h-3.5" />
                Active ({activeEntries.length})
              </button>
              <button
                onClick={() => setView('removed')}
                disabled={removedEntries.length === 0}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all',
                  view === 'removed' ? 'bg-surface-3 text-slate-200 border border-border-2' : 'text-muted hover:text-slate-300',
                  removedEntries.length === 0 && 'opacity-40 cursor-not-allowed'
                )}
              >
                <EyeOff className="w-3.5 h-3.5" />
                Already replied ({removedEntries.length})
              </button>
            </div>

            <div className="ml-auto flex items-center gap-2">
              {view === 'active' && selectedKeys.size > 0 && (
                <Button size="sm" onClick={() => setShowBulkModal(true)}>
                  <Users className="w-3.5 h-3.5" />
                  Send to {selectedKeys.size} selected
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => downloadCsv(`sent-${dateStr}-${view}.csv`, toCsv(visibleEntries))}
                disabled={visibleEntries.length === 0}
              >
                <Download className="w-3.5 h-3.5" />
                Download ({visibleEntries.length})
              </Button>
            </div>
          </div>

          {view === 'removed' && (
            <p className="text-xs text-emerald-400/80 bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-3 py-2">
              These people already sent a genuine reply after this email — they were removed from the active list so you don&apos;t follow up with someone who&apos;s already responded.
            </p>
          )}

          {visibleEntries.length === 0 ? (
            <p className="text-sm text-muted text-center py-10">
              {view === 'active'
                ? 'Nothing sent on this date (or everyone already replied).'
                : 'No one from this date has replied yet.'}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface-3 text-xs text-muted uppercase tracking-wide">
                  <tr>
                    {view === 'active' && (
                      <th className="px-3 py-2 text-left font-medium w-10">
                        <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-primary" />
                      </th>
                    )}
                    <th className="px-3 py-2 text-left font-medium">Recipient</th>
                    <th className="px-3 py-2 text-left font-medium">Subject</th>
                    <th className="px-3 py-2 text-left font-medium">Sent at</th>
                    {view === 'active' && <th className="px-3 py-2 text-left font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visibleEntries.map((e, i) => (
                    <tr key={i} className="hover:bg-surface-2/50">
                      {view === 'active' && (
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selectedKeys.has(entryKey(e))}
                            onChange={() => toggleOne(e)}
                            className="accent-primary"
                          />
                        </td>
                      )}
                      <td className="px-3 py-2 text-slate-300 font-mono text-xs">{e.recipientEmail}</td>
                      <td className="px-3 py-2 text-slate-400 text-xs truncate max-w-[320px]">{e.subject}</td>
                      <td className="px-3 py-2 text-slate-500 text-xs whitespace-nowrap">
                        {new Date(e.sentDateTime).toLocaleTimeString()}
                      </td>
                      {view === 'active' && (
                        <td className="px-3 py-2">
                          <button
                            onClick={() => setSendModalEntry(e)}
                            className="text-muted hover:text-primary transition-colors"
                            title="Send follow-up (threaded reply)"
                          >
                            <Reply className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {sendModalEntry && (
        <SendFollowUpModal
          entry={sendModalEntry}
          onClose={() => setSendModalEntry(null)}
          onSent={() => {}}
        />
      )}

      {showBulkModal && selectedEntries.length > 0 && (
        <BulkSendModal
          entries={selectedEntries}
          onClose={() => setShowBulkModal(false)}
          onDone={(result) => {
            const succeededEmails = new Set(result.results.filter((r) => r.success).map((r) => r.recipientEmail));
            setSelectedKeys((prev) => {
              const next = new Set(prev);
              for (const e of selectedEntries) {
                if (succeededEmails.has(e.recipientEmail)) next.delete(entryKey(e));
              }
              return next;
            });
          }}
        />
      )}
    </div>
  );
}
