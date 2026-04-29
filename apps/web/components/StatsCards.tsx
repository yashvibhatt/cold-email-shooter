'use client';

import { useStats } from '@/hooks/useEmails';
import { formatRelative, formatShortDate } from '@/lib/utils';
import { Mail, Clock, CheckCircle2, XCircle, Ban, CalendarClock } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  color: string;
  delay?: number;
}

function StatCard({ label, value, icon, color, delay = 0 }: StatCardProps) {
  return (
    <div
      className="animate-in gradient-border p-5 flex items-center gap-4"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-bold text-slate-100 font-mono tabular-nums leading-none">
          {value}
        </div>
        <div className="text-xs text-muted mt-1 truncate">{label}</div>
      </div>
    </div>
  );
}

export function StatsCards() {
  const { data, isLoading } = useStats();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="gradient-border p-5 h-20 animate-pulse bg-surface-2" />
        ))}
      </div>
    );
  }

  const stats = data?.stats ?? {
    total: 0, pending: 0, scheduled: 0, sent: 0, failed: 0, cancelled: 0,
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 stagger">
        <StatCard
          label="Total Imported"
          value={stats.total}
          icon={<Mail className="w-5 h-5" />}
          color="bg-blue-500/15 text-blue-400"
          delay={0}
        />
        <StatCard
          label="Pending"
          value={stats.pending}
          icon={<Clock className="w-5 h-5" />}
          color="bg-amber-500/15 text-amber-400"
          delay={60}
        />
        <StatCard
          label="Scheduled"
          value={stats.scheduled}
          icon={<CalendarClock className="w-5 h-5" />}
          color="bg-primary/15 text-blue-400"
          delay={120}
        />
        <StatCard
          label="Sent"
          value={stats.sent}
          icon={<CheckCircle2 className="w-5 h-5" />}
          color="bg-emerald-500/15 text-emerald-400"
          delay={180}
        />
        <StatCard
          label="Failed"
          value={stats.failed}
          icon={<XCircle className="w-5 h-5" />}
          color="bg-red-500/15 text-red-400"
          delay={240}
        />
        <StatCard
          label="Cancelled"
          value={stats.cancelled}
          icon={<Ban className="w-5 h-5" />}
          color="bg-slate-500/15 text-slate-400"
          delay={300}
        />
      </div>

      {data?.nextEmail && (
        <div className="animate-in gradient-border p-4 flex items-center gap-3 border-l-2 border-l-blue-500">
          <CalendarClock className="w-4 h-4 text-blue-400 flex-shrink-0" />
          <span className="text-xs text-muted">Next email:</span>
          <span className="text-xs text-slate-300 font-mono truncate">
            {data.nextEmail.recipientEmail}
          </span>
          <span className="text-xs text-slate-500 truncate">{data.nextEmail.subject}</span>
          <span className="text-xs text-blue-400 ml-auto flex-shrink-0 font-mono">
            {formatShortDate(data.nextEmail.scheduledDatetime)}
          </span>
        </div>
      )}
    </div>
  );
}
