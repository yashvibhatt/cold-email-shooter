'use client';

import { useState } from 'react';
import { X, Send, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { AttachmentPicker } from '@/components/AttachmentPicker';
import { useSendTest } from '@/hooks/useEmails';
import { cn } from '@/lib/utils';
import type { AttachmentInfo } from '@/lib/api';

interface Props {
  onClose: () => void;
}

export function TestEmailModal({ onClose }: Props) {
  const [form, setForm]           = useState({ to: '', subject: 'Test email', body: 'Hello! This is a test email.' });
  const [attachments, setAtt]     = useState<AttachmentInfo[]>([]);
  const [result, setResult]       = useState<{ ok: boolean; msg: string } | null>(null);
  const mutation = useSendTest();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await mutation.mutateAsync({
        ...form,
        attachmentIds: attachments.map((a) => a.id),
      });
      setResult({ ok: true, msg: res.data.message });
    } catch (err: any) {
      setResult({ ok: false, msg: err.message });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in">
      <div className="gradient-border w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3 className="font-semibold text-slate-200">Send Test Email</h3>
          <button onClick={onClose} className="text-muted hover:text-slate-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {result && (
            <div className={cn(
              'p-3 rounded-lg text-xs flex items-start gap-2',
              result.ok
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-red-500/10 text-red-400 border border-red-500/20'
            )}>
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              {result.msg}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs text-muted font-mono">To</label>
            <input
              type="email"
              required
              value={form.to}
              onChange={(e) => setForm((p) => ({ ...p, to: e.target.value }))}
              placeholder="recipient@example.com"
              className="w-full bg-surface-3 border border-border text-slate-300 text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-primary font-mono"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted font-mono">Subject</label>
            <input
              required
              value={form.subject}
              onChange={(e) => setForm((p) => ({ ...p, subject: e.target.value }))}
              className="w-full bg-surface-3 border border-border text-slate-300 text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-primary"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted font-mono">Body</label>
            <textarea
              required
              value={form.body}
              onChange={(e) => setForm((p) => ({ ...p, body: e.target.value }))}
              rows={4}
              className="w-full bg-surface-3 border border-border text-slate-300 text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-primary resize-y"
            />
          </div>

          <AttachmentPicker attachments={attachments} onChange={setAtt} maxFiles={3} />

          <div className="flex gap-3 justify-end pt-1">
            <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={mutation.isPending}>
              <Send className="w-3.5 h-3.5" />
              Send Test
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
