'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, Zap, Shield, Clock, ArrowRight, Loader2 } from 'lucide-react';
import { useAuth, useLogin } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';

const FEATURES = [
  {
    icon: <Mail className="w-5 h-5" />,
    title: 'Outlook Integration',
    desc: 'Connects directly to your Outlook via Microsoft Graph API using secure OAuth.',
  },
  {
    icon: <Clock className="w-5 h-5" />,
    title: 'Reliable Scheduling',
    desc: 'BullMQ + Redis queue survives restarts. Emails send on time, every time.',
  },
  {
    icon: <Zap className="w-5 h-5" />,
    title: 'Bulk CSV/Excel Import',
    desc: 'Upload a spreadsheet, preview, validate, edit, and schedule hundreds of emails.',
  },
  {
    icon: <Shield className="w-5 h-5" />,
    title: 'Safe Mode',
    desc: 'Test the full flow without sending real emails. Toggle with SAFE_MODE env var.',
  },
];

export default function HomePage() {
  const { data: user, isLoading } = useAuth();
  const router = useRouter();
  const login = useLogin();

  useEffect(() => {
    if (user) router.replace('/dashboard');
  }, [user, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas dot-grid flex flex-col">
      {/* Header */}
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
              <Mail className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-slate-200">Cold Email Shooter</span>
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center text-center px-6 py-20">
        <div className="max-w-2xl mx-auto space-y-8 stagger">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-blue-400 border border-primary/20 px-3 py-1 rounded-full text-xs font-mono">
            <span className="w-2 h-2 rounded-full bg-primary status-pulse" />
            Powered by Microsoft Graph API
          </div>

          <h1 className="text-5xl sm:text-6xl font-extrabold text-slate-100 leading-tight tracking-tight">
            Schedule Outlook emails{' '}
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              from a spreadsheet
            </span>
          </h1>

          <p className="text-lg text-muted leading-relaxed">
            Upload a CSV or Excel file, set the date and time for each email, and let the scheduler
            handle the rest — reliably, without duplicates, with full status tracking.
          </p>

          <Button
            size="lg"
            onClick={() => login.mutate()}
            loading={login.isPending}
            className="text-base px-7 py-3 h-auto"
          >
            Connect with Microsoft
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>

        {/* Features grid */}
        <div className="max-w-4xl mx-auto mt-20 grid sm:grid-cols-2 gap-4 w-full stagger">
          {FEATURES.map((f, i) => (
            <div
              key={i}
              className="gradient-border p-5 text-left space-y-2"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center border border-primary/20">
                {f.icon}
              </div>
              <h3 className="font-semibold text-slate-200 text-sm">{f.title}</h3>
              <p className="text-xs text-muted leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t border-border py-4 text-center text-xs text-subtle">
        Built with Next.js · Express · BullMQ · Microsoft Graph API
      </footer>
    </div>
  );
}
