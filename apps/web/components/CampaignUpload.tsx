'use client';

import { useState, useCallback, useRef } from 'react';
import {
  Upload, CheckCircle2, AlertTriangle, X, Send,
  ChevronDown, ChevronUp, Sparkles, Clock,
  ChevronLeft, ChevronRight, Users, Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { AttachmentPicker } from '@/components/AttachmentPicker';
import { useUploadContacts, useScheduleCampaign } from '@/hooks/useEmails';
import { cn } from '@/lib/utils';
import type { ContactRow, ContactsUploadResult, AttachmentInfo } from '@/lib/api';

// ─── constants ────────────────────────────────────────────────────────────────

const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Toronto', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Tokyo', 'Asia/Singapore',
  'Australia/Sydney', 'UTC',
];

const VARIABLE_HINTS = [
  { var: '{{first_name}}', desc: 'First name',  example: 'Claudia' },
  { var: '{{last_name}}',  desc: 'Last name',   example: 'Bustamante' },
  { var: '{{full_name}}',  desc: 'Full name',   example: 'Claudia Bustamante' },
  { var: '{{company}}',    desc: 'Company',     example: 'McKinsey' },
  { var: '{{title}}',      desc: 'Job title',   example: 'Recruiter' },
];

// ─── template engine ──────────────────────────────────────────────────────────

function applyTemplate(template: string, contact: ContactRow): string {
  return template
    .replace(/\{\{first_name\}\}/gi, contact.firstName  || contact.fullName || 'there')
    .replace(/\{\{last_name\}\}/gi,  contact.lastName   || '')
    .replace(/\{\{full_name\}\}/gi,  contact.fullName   || contact.firstName || 'there')
    .replace(/\{\{company\}\}/gi,    contact.company    || '')
    .replace(/\{\{title\}\}/gi,      contact.title      || '');
}

function firstLine(text: string): string {
  return text.split('\n').find((l) => l.trim()) ?? '';
}

// Uses local timezone, not UTC — avoids off-by-one-day bug for US users late at night
function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function localTomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return localDateString(d);
}

// Compute UTC instant from local date + time + IANA timezone string
// Returns null if date-fns-tz can't parse it
function computeUtc(date: string, time: string, tz: string): Date | null {
  if (!date || !time) return null;
  try {
    // Inline the conversion without importing fromZonedTime on client
    // We parse the local datetime as if it's in `tz` using Intl
    const localStr = `${date}T${time}:00`;
    const fakeUtc   = new Date(localStr + 'Z'); // treat as UTC first
    const tzOffset  = getTimezoneOffsetMs(fakeUtc, tz);
    return new Date(fakeUtc.getTime() + tzOffset);
  } catch {
    return null;
  }
}

// Gets the UTC offset in ms for a given instant in a given IANA timezone
function getTimezoneOffsetMs(date: Date, tz: string): number {
  try {
    const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
    const tzStr  = date.toLocaleString('en-US', { timeZone: tz });
    return new Date(utcStr).getTime() - new Date(tzStr).getTime();
  } catch {
    return 0;
  }
}

function formatLocal(d: Date): string {
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

// ─── PersonalisationPreview ───────────────────────────────────────────────────

interface PreviewProps {
  contacts: ContactRow[];
  subject: string;
  body: string;
}

function PersonalisationPreview({ contacts, subject, body }: PreviewProps) {
  const [expanded, setExpanded]     = useState(false);
  const [activeIdx, setActiveIdx]   = useState(0);

  const noName = contacts.filter((c) => !c.firstName && !c.fullName);

  const active  = contacts[activeIdx];
  const prev    = () => setActiveIdx((i) => Math.max(0, i - 1));
  const next    = () => setActiveIdx((i) => Math.min(contacts.length - 1, i + 1));

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      {/* Header row — always visible */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-surface-2/60 hover:bg-surface-2 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <Eye className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-medium text-slate-300">
            Preview personalisation
          </span>
          <span className="text-xs text-muted font-mono">
            · {contacts.length} emails
          </span>
          {noName.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 px-2 py-0.5 rounded-full">
              <AlertTriangle className="w-3 h-3" />
              {noName.length} will say "Hi there" (no name)
            </span>
          )}
        </div>
        {expanded
          ? <ChevronUp className="w-3.5 h-3.5 text-muted" />
          : <ChevronDown className="w-3.5 h-3.5 text-muted" />}
      </button>

      {expanded && (
        <div className="animate-in">
          {/* Contact navigator */}
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-surface/50">
            <button
              type="button"
              onClick={prev}
              disabled={activeIdx === 0}
              className="p-1 rounded text-muted hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted">Showing</span>
              <span className="font-mono text-slate-300">
                {active.firstName
                  ? <><span className="text-emerald-400 font-medium">{active.firstName}</span> {active.lastName}</>
                  : <span className="text-amber-400">No name · falls back to "there"</span>}
              </span>
              <span className="text-subtle">·</span>
              <span className="font-mono text-subtle">{active.email}</span>
              <span className="text-subtle ml-2">{activeIdx + 1}/{contacts.length}</span>
            </div>

            <button
              type="button"
              onClick={next}
              disabled={activeIdx === contacts.length - 1}
              className="p-1 rounded text-muted hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Rendered email */}
          <div className="px-4 py-3 border-t border-border space-y-2 bg-surface/30">
            <div className="text-xs">
              <span className="text-muted font-mono">Subject: </span>
              <span className="text-slate-200 font-medium">{applyTemplate(subject, active)}</span>
            </div>
            <div className="text-xs text-muted font-mono border-t border-border/50 pt-2">Body</div>
            <pre className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed font-sans">
              {applyTemplate(body, active)}
            </pre>
          </div>

          {/* All contacts summary strip */}
          <div className="border-t border-border overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-surface-2/40">
                  <th className="px-3 py-2 text-left text-muted font-medium">#</th>
                  <th className="px-3 py-2 text-left text-muted font-medium">Contact</th>
                  <th className="px-3 py-2 text-left text-muted font-medium">Personalised subject</th>
                  <th className="px-3 py-2 text-left text-muted font-medium">Greeting</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c, i) => {
                  const renderedSubject = applyTemplate(subject, c);
                  const renderedGreeting = firstLine(applyTemplate(body, c));
                  const missingName = !c.firstName && !c.fullName;
                  return (
                    <tr
                      key={i}
                      onClick={() => setActiveIdx(i)}
                      className={cn(
                        'border-t border-border/30 cursor-pointer transition-colors',
                        activeIdx === i
                          ? 'bg-primary/10'
                          : 'hover:bg-surface-2/60',
                        missingName && 'bg-amber-500/5'
                      )}
                    >
                      <td className="px-3 py-2 text-subtle font-mono">{i + 1}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          {missingName && (
                            <AlertTriangle className="w-3 h-3 text-amber-400 flex-shrink-0" title="No name found — will use 'there'" />
                          )}
                          <span className={cn('font-medium', missingName ? 'text-amber-300' : 'text-slate-300')}>
                            {c.fullName || c.email}
                          </span>
                        </div>
                        <div className="text-subtle font-mono truncate max-w-[180px]">{c.email}</div>
                      </td>
                      <td className="px-3 py-2 text-slate-400 max-w-[220px] truncate">{renderedSubject}</td>
                      <td className="px-3 py-2 text-slate-500 max-w-[200px] truncate">{renderedGreeting}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CampaignUpload() {
  const [isDragging,     setIsDragging]     = useState(false);
  const [uploadResult,   setUploadResult]   = useState<ContactsUploadResult | null>(null);
  const [showAllContacts,setShowAll]        = useState(false);
  const [scheduleResult, setScheduleResult] = useState<{ scheduled: number; duplicates: number; errors: number } | null>(null);
  const [toast,          setToast]          = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const [attachments,    setAttachments]    = useState<AttachmentInfo[]>([]);
  const [subject,        setSubject]        = useState('Hi {{first_name}}, quick question');
  const [body,           setBody]           = useState(
`Hi {{first_name}},

I came across {{company}} and was impressed by your work as {{title}}.

I'd love to connect and explore if there's a way we can collaborate.

Would you be open to a quick 15-minute call this week?

Best regards`
  );
  const [startDate,      setStartDate]      = useState(localTomorrow); // tomorrow in local tz
  const [startTime,      setStartTime]      = useState('09:00');
  const [timezone,       setTimezone]       = useState('America/Chicago');
  const [staggerMinutes, setStaggerMinutes] = useState(5);

  const fileInputRef   = useRef<HTMLInputElement>(null);
  const subjectRef     = useRef<HTMLInputElement>(null);
  const bodyRef        = useRef<HTMLTextAreaElement>(null);

  const uploadMutation   = useUploadContacts();
  const campaignMutation = useScheduleCampaign();

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 6000);
  };

  const handleFile = useCallback(async (file: File) => {
    setUploadResult(null);
    setScheduleResult(null);
    try {
      const res = await uploadMutation.mutateAsync(file);
      setUploadResult(res.data);
    } catch (err: any) {
      showToast('error', err.message ?? 'Upload failed');
    }
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  };

  // Insert variable at cursor position in whichever field is focused
  const insertVar = (v: string) => {
    const active = document.activeElement;
    if (active === subjectRef.current) {
      const el    = subjectRef.current!;
      const start = el.selectionStart ?? el.value.length;
      const end   = el.selectionEnd   ?? el.value.length;
      setSubject(el.value.slice(0, start) + v + el.value.slice(end));
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + v.length, start + v.length);
      });
    } else {
      const el    = bodyRef.current!;
      const start = el?.selectionStart ?? el?.value.length ?? body.length;
      const end   = el?.selectionEnd   ?? el?.value.length ?? body.length;
      setBody(body.slice(0, start) + v + body.slice(end));
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(start + v.length, start + v.length);
      });
    }
  };

  const handleSchedule = async () => {
    if (!uploadResult) return;
    try {
      const res = await campaignMutation.mutateAsync({
        contacts:      uploadResult.contacts,
        subject,
        body,
        startDate,
        startTime,
        timezone,
        staggerMinutes,
        sourceFileId:  uploadResult.fileId,
        attachmentIds: attachments.map((a) => a.id),
      });
      setScheduleResult(res.data);
      showToast(
        res.data.errors > 0 ? 'error' : 'success',
        `Scheduled ${res.data.scheduled} emails` +
        (res.data.duplicates > 0 ? `, ${res.data.duplicates} skipped` : '') +
        (res.data.errors > 0 ? `, ${res.data.errors} failed` : '')
      );
    } catch (err: any) {
      showToast('error', err.message ?? 'Scheduling failed');
    }
  };

  const visibleContacts = showAllContacts
    ? uploadResult?.contacts
    : uploadResult?.contacts.slice(0, 5);

  return (
    <div className="space-y-5">

      {/* Toast */}
      {toast && (
        <div className={cn(
          'animate-in fixed top-4 right-4 z-50 px-4 py-3 rounded-lg text-sm font-medium flex items-center gap-2 shadow-xl max-w-sm',
          toast.type === 'success'
            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
            : 'bg-red-500/15 text-red-400 border border-red-500/30'
        )}>
          {toast.type === 'success'
            ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
          <span className="flex-1">{toast.msg}</span>
          <button onClick={() => setToast(null)}><X className="w-3.5 h-3.5 opacity-60 hover:opacity-100" /></button>
        </div>
      )}

      {/* ── Step 1: Upload ── */}
      <div className="gradient-border p-5 space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center text-white text-xs font-bold flex-shrink-0">1</div>
          <h3 className="font-semibold text-slate-200 text-sm">Upload your contacts</h3>
          <span className="text-xs text-muted ml-auto">Apollo, LinkedIn, or any CSV with an Email column</span>
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
            {uploadMutation.isPending
              ? <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              : <Upload className="w-8 h-8 text-primary/60" />}
            <p className="text-slate-300 text-sm font-medium">
              {uploadMutation.isPending ? 'Detecting columns…' : 'Drop your contacts CSV here'}
            </p>
            <p className="text-xs text-muted">Works with Apollo exports, LinkedIn exports, or any file with an Email column</p>
          </div>
        </div>

        {uploadResult && (
          <div className="animate-in space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2 p-3 bg-emerald-500/8 border border-emerald-500/20 rounded-lg">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="text-sm text-emerald-300 font-medium">{uploadResult.originalName}</span>
                <span className="text-xs text-muted font-mono">· {uploadResult.detectedFormat} format</span>
              </div>
              <div className="flex gap-3 text-xs font-mono">
                <span className="text-emerald-400">{uploadResult.totalContacts} contacts</span>
                {uploadResult.skippedRows > 0 && <span className="text-amber-400">{uploadResult.skippedRows} skipped</span>}
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-surface-2/60 border-b border-border">
                    <th className="p-2.5 text-left text-muted font-medium">Email</th>
                    <th className="p-2.5 text-left text-muted font-medium">Name</th>
                    <th className="p-2.5 text-left text-muted font-medium">Company</th>
                    <th className="p-2.5 text-left text-muted font-medium">Title</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleContacts?.map((c, i) => (
                    <tr key={i} className="border-b border-border/40 table-row-hover">
                      <td className="p-2.5 text-slate-300 font-mono truncate max-w-[160px]">{c.email}</td>
                      <td className={cn('p-2.5 font-medium', !c.fullName && !c.firstName ? 'text-amber-400' : 'text-slate-300')}>
                        {c.fullName || (c.firstName ? `${c.firstName} ${c.lastName}`.trim() : '—')}
                      </td>
                      <td className="p-2.5 text-slate-500 truncate max-w-[140px]">{c.company || '—'}</td>
                      <td className="p-2.5 text-slate-500 truncate max-w-[120px]">{c.title || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(uploadResult.contacts.length > 5) && (
                <button
                  onClick={() => setShowAll(!showAllContacts)}
                  className="w-full p-2.5 text-xs text-muted hover:text-slate-300 flex items-center justify-center gap-1 border-t border-border bg-surface-2/30 transition-colors"
                >
                  {showAllContacts
                    ? <><ChevronUp className="w-3.5 h-3.5" /> Show less</>
                    : <><ChevronDown className="w-3.5 h-3.5" /> Show all {uploadResult.contacts.length} contacts</>}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Step 2: Write email ── */}
      <div className={cn('gradient-border p-5 space-y-4 transition-opacity', !uploadResult && 'opacity-40 pointer-events-none')}>
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center text-white text-xs font-bold flex-shrink-0">2</div>
          <h3 className="font-semibold text-slate-200 text-sm">Write your email</h3>
          <span className="text-xs text-muted ml-auto">Click a chip to insert at cursor</span>
        </div>

        {/* Variable chips */}
        <div className="flex flex-wrap gap-1.5">
          {VARIABLE_HINTS.map((v) => (
            <button
              key={v.var}
              type="button"
              onClick={() => insertVar(v.var)}
              title={`Insert ${v.var} · e.g. "${v.example}"`}
              className="flex items-center gap-1 text-xs bg-primary/10 text-blue-400 border border-primary/20 px-2 py-0.5 rounded-full hover:bg-primary/20 active:scale-95 transition-all font-mono"
            >
              <Sparkles className="w-2.5 h-2.5" />
              {v.var}
              <span className="text-primary/60 font-sans">→ {v.example}</span>
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {/* Subject */}
          <div className="space-y-1">
            <label className="text-xs text-muted font-mono">Subject line</label>
            <input
              id="campaign-subject"
              ref={subjectRef}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full bg-surface-3 border border-border text-slate-200 text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-primary"
              placeholder="Hi {{first_name}}, quick question about {{company}}"
            />
          </div>

          {/* Body */}
          <div className="space-y-1">
            <label className="text-xs text-muted font-mono">Email body</label>
            <textarea
              id="campaign-body"
              ref={bodyRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={9}
              className="w-full bg-surface-3 border border-border text-slate-300 text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-primary resize-y leading-relaxed"
              placeholder="Write your email here…"
            />
          </div>

          {/* ── Personalisation preview ── */}
          {uploadResult && uploadResult.contacts.length > 0 && (
            <PersonalisationPreview
              contacts={uploadResult.contacts}
              subject={subject}
              body={body}
            />
          )}

          {/* Attachments */}
          <AttachmentPicker attachments={attachments} onChange={setAttachments} />
        </div>
      </div>

      {/* ── Step 3: Schedule ── */}
      <div className={cn('gradient-border p-5 space-y-4 transition-opacity', !uploadResult && 'opacity-40 pointer-events-none')}>
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center text-white text-xs font-bold flex-shrink-0">3</div>
          <h3 className="font-semibold text-slate-200 text-sm">Set schedule</h3>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted font-mono">Start date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full bg-surface-3 border border-border text-slate-300 text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-primary"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted font-mono">Start time</label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full bg-surface-3 border border-border text-slate-300 text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-primary"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted font-mono">Timezone</label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full bg-surface-3 border border-border text-slate-300 text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-primary"
            >
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted font-mono">Stagger (mins)</label>
            <input
              type="number"
              min={0}
              max={120}
              value={staggerMinutes}
              onChange={(e) => setStaggerMinutes(Number(e.target.value))}
              className="w-full bg-surface-3 border border-border text-slate-300 text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-primary"
            />
            <p className="text-xs text-subtle">0 = all at once</p>
          </div>
        </div>

        {/* Schedule summary + warnings */}
        {(() => {
          const firstUtc = computeUtc(startDate, startTime, timezone);
          if (!firstUtc) return null;

          const now         = Date.now();
          const isPast      = firstUtc.getTime() <= now;
          const minsUntil   = Math.round((firstUtc.getTime() - now) / 60_000);
          const n           = uploadResult?.totalContacts ?? 1;
          const lastUtc     = staggerMinutes > 0
            ? new Date(firstUtc.getTime() + (n - 1) * staggerMinutes * 60_000)
            : firstUtc;

          return (
            <div className="space-y-2">
              {/* Past-time warning */}
              {isPast && (
                <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>
                    <strong>This time has already passed.</strong> Emails will send immediately when you click Schedule.
                    Change the date or time to a future slot.
                  </span>
                </div>
              )}

              {/* Normal send-time summary */}
              <div className={`flex items-start gap-2 p-3 rounded-lg text-xs border ${
                isPast
                  ? 'bg-amber-500/8 border-amber-500/20 text-amber-400'
                  : 'bg-blue-500/8 border-blue-500/20 text-blue-400'
              }`}>
                <Clock className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div>
                    <span className="font-medium">First email: </span>
                    {formatLocal(firstUtc)}
                    {!isPast && <span className="text-slate-500 ml-1">({minsUntil < 60 ? `${minsUntil} min` : `${Math.round(minsUntil / 60)}h`} from now)</span>}
                  </div>
                  {staggerMinutes > 0 && n > 1 && (
                    <div>
                      <span className="font-medium">Last email: </span>
                      {formatLocal(lastUtc)}
                      <span className="text-slate-500 ml-1">· {staggerMinutes} min apart · {n} total</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        <div className="flex items-center justify-between pt-1">
          <div className="text-xs text-muted">
            {uploadResult
              ? <><span className="text-slate-300 font-medium">{uploadResult.totalContacts}</span> emails will be scheduled</>
              : 'Upload contacts first'}
          </div>
          <Button
            onClick={handleSchedule}
            loading={campaignMutation.isPending}
            disabled={!uploadResult || !subject.trim() || !body.trim()}
          >
            <Send className="w-3.5 h-3.5" />
            Schedule Campaign
          </Button>
        </div>
      </div>

      {/* Result */}
      {scheduleResult && (
        <div className="animate-in gradient-border p-4 flex items-center gap-4 flex-wrap">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
          <span className="text-sm text-slate-300">Campaign scheduled:</span>
          <span className="text-sm text-emerald-400 font-mono">{scheduleResult.scheduled} queued</span>
          {scheduleResult.duplicates > 0 && <span className="text-sm text-amber-400 font-mono">{scheduleResult.duplicates} skipped (duplicates)</span>}
          {scheduleResult.errors > 0 && <span className="text-sm text-red-400 font-mono">{scheduleResult.errors} failed</span>}
          <span className="text-xs text-muted ml-auto">Check the Email Jobs tab to monitor progress</span>
        </div>
      )}

    </div>
  );
}
