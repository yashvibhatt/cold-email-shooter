'use client';

import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  RefreshCw, AlertTriangle, CheckCircle2, Circle, Trash2, Loader2,
  Clock, PlaneTakeoff, Download, Reply, X, Send, Users, Sparkles, MessageCircleReply, CalendarClock,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { followUpApi } from '@/lib/api';
import type { FollowUpRow, BulkFollowUpSendResponse } from '@/lib/api';
import { cn } from '@/lib/utils';

const SCAN_WINDOW_DAYS = 14;

function daysAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// "America/Chicago" -> "Chicago (America)" — the timezone the campaign was
// scheduled in, which is the closest proxy we have to the recipient's location.
function formatTimezone(tz: string | null): string {
  if (!tz) return '—';
  const parts = tz.split('/');
  const city = (parts[parts.length - 1] ?? tz).replace(/_/g, ' ');
  const region = parts.length > 1 ? parts[0] : null;
  return region ? `${city} (${region})` : city;
}

// The date follow-up "silence" should be measured from — the last time we
// followed up if we've already sent one, otherwise the original send.
function lastContactDate(row: FollowUpRow): string {
  return row.lastFollowUpSentAt ?? row.originalSentAt;
}

function defaultFollowUpMessage(row: FollowUpRow): string {
  const nth = row.followUpCount + 1;
  if (row.status === 'RESPONDED') {
    return `Hi {{first_name}},\n\nThanks for getting back to me! \n\nBest`;
  }
  if (row.status === 'OUT_OF_OFFICE') {
    return `Hi {{first_name}},\n\nHope you're settling back in! Circling back on my note below in case it got buried while you were out.\n\nWould love to hear your thoughts when you get a chance.\n\nBest`;
  }
  if (nth === 1) {
    return `Hi {{first_name}},\n\nJust wanted to bump this back up in case it got lost in the shuffle. Would love to hear your thoughts.\n\nBest`;
  }
  return `Hi {{first_name}},\n\nStill haven't heard back — this will be my ${ordinal(nth)} time reaching out, so I'll keep it short. Any interest in connecting?\n\nBest`;
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
  row: FollowUpRow;
  onClose: () => void;
  onSent: (updated: FollowUpRow) => void;
}

function SendFollowUpModal({ row, onClose, onSent }: SendModalProps) {
  const [message, setMessage] = useState(defaultFollowUpMessage(row));
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
      return followUpApi.send(row.id, message, scheduledAt);
    },
    onSuccess: (res) => {
      if (res.data.scheduled) {
        setScheduledConfirmation(new Date(res.data.scheduledAt).toLocaleString());
      } else {
        onSent(res.data as any);
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
            <h3 className="font-semibold text-slate-200">Send {ordinal(row.followUpCount + 1)} follow-up</h3>
            <p className="text-xs text-muted mt-0.5">
              Sent as a threaded reply to &quot;{row.originalSubject}&quot; · {row.recipientEmail}
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
              {row.status === 'OUT_OF_OFFICE' && row.oooReturnDate && (
                <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                  <PlaneTakeoff className="w-3.5 h-3.5 flex-shrink-0" />
                  They were expected back {new Date(row.oooReturnDate).toLocaleDateString()}
                </div>
              )}

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
                  {when === 'later' ? 'Schedule follow-up' : `Send ${ordinal(row.followUpCount + 1)} follow-up`}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const BULK_DEFAULT_MESSAGE = `Hi {{first_name}},\n\nJust wanted to bump this back up in case it got lost in the shuffle. Would love to hear your thoughts.\n\nBest`;

interface BulkSendModalProps {
  rows: FollowUpRow[];
  onClose: () => void;
  onDone: (result: BulkFollowUpSendResponse) => void;
}

function BulkSendModal({ rows, onClose, onDone }: BulkSendModalProps) {
  const [message, setMessage] = useState(BULK_DEFAULT_MESSAGE);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkFollowUpSendResponse | null>(null);
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
      return followUpApi.bulkSend(rows.map((r) => r.id), message, scheduledAt);
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
              Sent individually as threaded replies to {rows.length} recipient{rows.length !== 1 ? 's' : ''}
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
              <div className="flex items-center gap-4">
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
              </div>
              {result.failed > 0 && (
                <div className="rounded-lg border border-border divide-y divide-border max-h-48 overflow-y-auto">
                  {result.results.filter((r) => !r.success).map((r) => (
                    <div key={r.id} className="px-3 py-2 text-xs">
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
                {rows.map((r) => (
                  <div key={r.id} className="px-3 py-1.5 text-xs text-slate-400 font-mono flex items-center justify-between gap-2">
                    <span className="truncate">{r.recipientEmail}</span>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="text-subtle">{ordinal(r.followUpCount + 1)}</span>
                      {r.status === 'OUT_OF_OFFICE' && <PlaneTakeoff className="w-3 h-3 text-amber-400" />}
                    </div>
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
                  {when === 'later' ? `Schedule ${rows.length}` : `Send to ${rows.length}`}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function toCsv(rows: FollowUpRow[]): string {
  const headers = ['senderEmail', 'recipientEmail', 'company', 'timezone', 'status', 'followUpCount', 'lastFollowUpSentAt', 'originalSubject', 'originalSentAt', 'oooNote', 'oooReturnDate'];
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

type FilterKey = 'not_followed_up' | 'awaiting' | 'responded' | 'all';

const FILTER_OPTIONS: { key: FilterKey; label: string }[] = [
  { key: 'not_followed_up', label: 'Not followed up' },
  { key: 'awaiting', label: 'Followed up — awaiting response' },
  { key: 'responded', label: 'Responded' },
  { key: 'all', label: 'All' },
];

export function FollowUp() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterKey>('not_followed_up');
  const [hideDismissed, setHideDismissed] = useState(true);
  const [companySearch, setCompanySearch] = useState('');
  const [sendModalRow, setSendModalRow] = useState<FollowUpRow | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [selectDateInput, setSelectDateInput] = useState(localDateString(new Date()));
  const [sortBy, setSortBy] = useState<'daysSilent' | 'followUpCount'>('daysSilent');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const { data, isLoading, error } = useQuery({
    queryKey: ['followup', 'list'],
    queryFn: async () => (await followUpApi.list()).data.list,
  });

  const scanMutation = useMutation({
    mutationFn: () => followUpApi.scan(SCAN_WINDOW_DAYS),
    onSuccess: (res) => {
      queryClient.setQueryData(['followup', 'list'], res.data.list);
    },
  });

  const syncManualMutation = useMutation({
    mutationFn: () => followUpApi.syncManual(),
    onSuccess: (res) => {
      queryClient.setQueryData(['followup', 'list'], res.data.list);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, followedUp }: { id: string; followedUp: boolean }) => followUpApi.setFollowedUp(id, followedUp),
    onSuccess: (res) => {
      queryClient.setQueryData<FollowUpRow[]>(['followup', 'list'], (old) =>
        old?.map((r) => (r.id === res.data.id ? res.data : r))
      );
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => followUpApi.remove(id),
    onSuccess: (_res, id) => {
      queryClient.setQueryData<FollowUpRow[]>(['followup', 'list'], (old) => old?.filter((r) => r.id !== id));
    },
  });

  const rows = data ?? [];
  const activeRows = hideDismissed ? rows.filter((r) => !r.followedUp) : rows;

  const filteredRows = activeRows.filter((r) => {
    if (filter === 'not_followed_up' && !(r.followUpCount === 0 && r.status !== 'RESPONDED')) return false;
    if (filter === 'awaiting' && !(r.followUpCount >= 1 && r.status !== 'RESPONDED')) return false;
    if (filter === 'responded' && r.status !== 'RESPONDED') return false;

    if (companySearch.trim()) {
      const needle = companySearch.trim().toLowerCase();
      if (!(r.company ?? '').toLowerCase().includes(needle)) return false;
    }

    return true;
  });
  const visibleRows = [...filteredRows].sort((a, b) => {
    const diff =
      sortBy === 'followUpCount'
        ? a.followUpCount - b.followUpCount
        : daysAgo(lastContactDate(a)) - daysAgo(lastContactDate(b));
    return sortDir === 'asc' ? diff : -diff;
  });

  const toggleSort = (col: 'daysSilent' | 'followUpCount') => {
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('desc');
    }
  };

  const notFollowedUpCount = activeRows.filter((r) => r.followUpCount === 0 && r.status !== 'RESPONDED').length;
  const awaitingCount = activeRows.filter((r) => r.followUpCount >= 1 && r.status !== 'RESPONDED').length;
  const respondedCount = activeRows.filter((r) => r.status === 'RESPONDED').length;

  const selectedRows = visibleRows.filter((r) => selectedIds.has(r.id));
  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((r) => selectedIds.has(r.id));

  const toggleRowSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        visibleRows.forEach((r) => next.delete(r.id));
        return next;
      }
      const next = new Set(prev);
      visibleRows.forEach((r) => next.add(r.id));
      return next;
    });
  };

  // Compares by local calendar date, not UTC — a row sent at 9am NYC should
  // match the date the user actually picked, not shift a day depending on UTC offset.
  const selectByDate = (dateStr: string) => {
    const matching = visibleRows.filter((r) => localDateString(new Date(r.originalSentAt)) === dateStr);
    setSelectedIds(new Set(matching.map((r) => r.id)));
  };

  return (
    <div className="space-y-5">
      <div className="gradient-border p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-slate-200 text-sm">Follow-up list</h3>
          <span className="text-xs text-muted ml-auto">
            Scans your Inbox for replies and out-of-office notices from the last {SCAN_WINDOW_DAYS} days
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="secondary" size="sm" onClick={() => scanMutation.mutate()} loading={scanMutation.isPending}>
            <RefreshCw className="w-3.5 h-3.5" />
            Scan for replies
          </Button>
          {scanMutation.data && (
            <span className="text-xs text-muted">
              {scanMutation.data.data.flagged} flagged · {scanMutation.data.data.resolved} resolved
            </span>
          )}

          <Button
            variant="secondary"
            size="sm"
            onClick={() => syncManualMutation.mutate()}
            loading={syncManualMutation.isPending}
            title="Checks Sent Items for follow-ups you sent by replying directly in Outlook. Can take a minute or more with a large list."
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Sync manual Outlook follow-ups
          </Button>
          {syncManualMutation.data && (
            <span className="text-xs text-muted">
              {syncManualMutation.data.data.manualSynced} synced (checked {syncManualMutation.data.data.checked})
            </span>
          )}
        </div>

        {(error || scanMutation.error || syncManualMutation.error) && (
          <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            {((error ?? scanMutation.error ?? syncManualMutation.error) as Error).message}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 text-muted text-sm py-16">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading follow-up list…
        </div>
      ) : (
        <div className="gradient-border p-5 space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-surface-3 border border-border rounded-lg p-3">
              <div className="text-xs text-muted">Not followed up</div>
              <div className="text-xl font-bold text-slate-200">{notFollowedUpCount}</div>
            </div>
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
              <div className="text-xs text-amber-400">Followed up — awaiting response</div>
              <div className="text-xl font-bold text-amber-400">{awaitingCount}</div>
            </div>
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
              <div className="text-xs text-emerald-400 flex items-center gap-1"><MessageCircleReply className="w-3 h-3" /> Responded</div>
              <div className="text-xl font-bold text-emerald-400">{respondedCount}</div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1 bg-surface rounded-lg p-1 border border-border">
              {FILTER_OPTIONS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    'px-3 py-1 rounded-md text-xs font-medium transition-all whitespace-nowrap',
                    filter === f.key ? 'bg-surface-3 text-slate-200 border border-border-2' : 'text-muted hover:text-slate-300'
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={hideDismissed}
                onChange={(e) => setHideDismissed(e.target.checked)}
                className="accent-primary"
              />
              Hide items I&apos;ve marked done
            </label>
            <input
              type="text"
              value={companySearch}
              onChange={(e) => setCompanySearch(e.target.value)}
              placeholder="Filter by company"
              className="w-64 bg-surface border border-border text-slate-200 text-xs px-2.5 py-1.5 rounded-md focus:outline-none focus:border-primary placeholder:text-subtle"
            />
            <div className="ml-auto flex items-center gap-2">
              {selectedIds.size > 0 && (
                <Button size="sm" onClick={() => setShowBulkModal(true)}>
                  <Users className="w-3.5 h-3.5" />
                  Send to {selectedIds.size} selected
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => downloadCsv('follow-up-list.csv', toCsv(visibleRows))}
                disabled={visibleRows.length === 0}
              >
                <Download className="w-3.5 h-3.5" />
                Download ({visibleRows.length})
              </Button>
            </div>
          </div>

          {/* Select by exact date */}
          <div className="flex items-center gap-2 bg-surface-3 border border-border rounded-lg px-3 py-2">
            <span className="text-xs text-muted whitespace-nowrap">Select rows sent on</span>
            <input
              type="date"
              value={selectDateInput}
              onChange={(e) => setSelectDateInput(e.target.value)}
              className="bg-surface border border-border text-slate-200 text-xs px-2 py-1 rounded-md focus:outline-none focus:border-primary"
            />
            <Button variant="secondary" size="sm" onClick={() => selectByDate(selectDateInput)} disabled={visibleRows.length === 0}>
              Select
            </Button>
            {selectedIds.size > 0 && (
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-xs text-muted hover:text-red-400 ml-auto"
              >
                Clear selection ({selectedIds.size})
              </button>
            )}
          </div>

          {visibleRows.length === 0 ? (
            <p className="text-sm text-muted text-center py-10">
              {rows.length === 0
                ? 'No follow-ups yet — click "Scan for replies" to check your Inbox.'
                : 'Nothing in this group right now.'}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface-3 text-xs text-muted uppercase tracking-wide">
                  <tr>
                    <th className="p-3 text-left font-medium w-10">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAllVisible}
                        className="accent-primary"
                      />
                    </th>
                    <th className="p-3 text-left font-medium w-10" />
                    <th className="p-3 text-left font-medium">Sender</th>
                    <th className="p-3 text-left font-medium">Recipient</th>
                    <th className="p-3 text-left font-medium">Status</th>
                    <th className="p-3 text-left font-medium">Note</th>
                    <th
                      className="p-3 text-left font-medium cursor-pointer select-none hover:text-slate-200"
                      onClick={() => toggleSort('followUpCount')}
                    >
                      Follow-ups {sortBy === 'followUpCount' && (sortDir === 'asc' ? '↑' : '↓')}
                    </th>
                    <th
                      className="p-3 text-left font-medium cursor-pointer select-none hover:text-slate-200"
                      onClick={() => toggleSort('daysSilent')}
                    >
                      Days silent {sortBy === 'daysSilent' && (sortDir === 'asc' ? '↑' : '↓')}
                    </th>
                    <th className="p-3 text-left font-medium">Company</th>
                    <th className="p-3 text-left font-medium">Timezone</th>
                    <th className="p-3 text-left font-medium">Original subject</th>
                    <th className="p-3 text-left font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visibleRows.map((r) => (
                    <tr key={r.id} className="hover:bg-surface-2/50">
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(r.id)}
                          onChange={() => toggleRowSelected(r.id)}
                          className="accent-primary"
                        />
                      </td>
                      <td className="p-3">
                        <button
                          onClick={() => toggleMutation.mutate({ id: r.id, followedUp: !r.followedUp })}
                          title={r.followedUp ? 'Marked done — click to reopen' : "Mark done (I'm no longer pursuing this)"}
                        >
                          {r.followedUp
                            ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                            : <Circle className="w-4 h-4 text-muted" />}
                        </button>
                      </td>
                      <td className="p-3 text-slate-400 font-mono text-xs max-w-[180px] truncate">
                        <span
                          className={cn(
                            'inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle',
                            r.provider === 'GMAIL' ? 'bg-red-400' : 'bg-blue-400'
                          )}
                          title={r.provider === 'GMAIL' ? 'Sent via Gmail' : 'Sent via Outlook'}
                        />
                        {r.senderEmail ?? '—'}
                      </td>
                      <td className="p-3 text-slate-300 font-mono text-xs max-w-[180px] truncate">{r.recipientEmail}</td>
                      <td className="p-3">
                        {r.status === 'RESPONDED' ? (
                          <span className="flex items-center gap-1 text-emerald-400 text-xs">
                            <MessageCircleReply className="w-3.5 h-3.5" /> Responded
                          </span>
                        ) : r.status === 'OUT_OF_OFFICE' ? (
                          <span className="flex items-center gap-1 text-amber-400 text-xs">
                            <PlaneTakeoff className="w-3.5 h-3.5" /> Out of office
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-slate-400 text-xs">
                            <Circle className="w-3.5 h-3.5" /> No response
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-slate-400 text-xs max-w-[240px]">
                        {r.status === 'RESPONDED' ? (
                          <div className="truncate text-emerald-300/80">{r.oooNote ?? 'They replied'}</div>
                        ) : r.status === 'OUT_OF_OFFICE' ? (
                          <>
                            <div className="truncate">{r.oooNote ?? '—'}</div>
                            {r.oooReturnDate && (
                              <div className="text-amber-400 mt-0.5">
                                Back: {new Date(r.oooReturnDate).toLocaleDateString()}
                              </div>
                            )}
                          </>
                        ) : (
                          <span>—</span>
                        )}
                      </td>
                      <td className="p-3 text-slate-300 text-xs whitespace-nowrap">
                        {r.followUpCount === 0 ? (
                          <span className="text-muted">Not yet</span>
                        ) : (
                          <span className="font-medium">{r.followUpCount}× sent</span>
                        )}
                        {r.lastFollowUpSentAt && (
                          <div className="text-subtle text-[11px]">
                            last {new Date(r.lastFollowUpSentAt).toLocaleDateString()}
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-slate-400 text-xs whitespace-nowrap">
                        {daysAgo(lastContactDate(r))}d
                      </td>
                      <td className="p-3 text-slate-400 text-xs whitespace-nowrap truncate max-w-[140px]">{r.company || '—'}</td>
                      <td className="p-3 text-slate-400 text-xs whitespace-nowrap" title={r.timezone ?? undefined}>
                        {formatTimezone(r.timezone)}
                      </td>
                      <td className="p-3 text-slate-400 text-xs truncate max-w-[200px]">{r.originalSubject}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setSendModalRow(r)}
                            className="text-muted hover:text-primary transition-colors"
                            title={`Send ${ordinal(r.followUpCount + 1)} follow-up (threaded reply)`}
                          >
                            <Reply className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => removeMutation.mutate(r.id)}
                            className="text-muted hover:text-red-400 transition-colors"
                            title="Remove from list"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {sendModalRow && (
        <SendFollowUpModal
          row={sendModalRow}
          onClose={() => setSendModalRow(null)}
          onSent={(updated) => {
            queryClient.setQueryData<FollowUpRow[]>(['followup', 'list'], (old) =>
              old?.map((r) => (r.id === updated.id ? updated : r))
            );
          }}
        />
      )}

      {showBulkModal && selectedRows.length > 0 && (
        <BulkSendModal
          rows={selectedRows}
          onClose={() => setShowBulkModal(false)}
          onDone={(result) => {
            const succeededIds = new Set(result.results.filter((r) => r.success).map((r) => r.id));
            const now = new Date().toISOString();
            // Scheduled sends haven't actually gone out yet — the worker
            // increments followUpCount when it fires, not now.
            if (!result.scheduled) {
              queryClient.setQueryData<FollowUpRow[]>(['followup', 'list'], (old) =>
                old?.map((r) =>
                  succeededIds.has(r.id)
                    ? { ...r, followUpCount: r.followUpCount + 1, lastFollowUpSentAt: now }
                    : r
                )
              );
            }
            setSelectedIds((prev) => {
              const next = new Set(prev);
              succeededIds.forEach((id) => next.delete(id));
              return next;
            });
          }}
        />
      )}
    </div>
  );
}
