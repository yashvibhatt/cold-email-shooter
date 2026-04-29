'use client';

import { useState } from 'react';
import { Mail, LogOut, Shield, Upload, List, FlaskConical, Users, AlertTriangle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth, useLogin, useLogout } from '@/hooks/useAuth';
import { StatsCards } from './StatsCards';
import { FileUpload } from './FileUpload';
import { EmailTable } from './EmailTable';
import { TestEmailModal } from './TestEmailModal';
import { CampaignUpload } from './CampaignUpload';
import { Button } from './ui/Button';

type Tab = 'campaign' | 'upload' | 'emails';

function useTokenStatus() {
  return useQuery({
    queryKey: ['auth', 'token-status'],
    queryFn: async () => {
      const res = await fetch('/api/auth/token-status', { credentials: 'include' });
      if (!res.ok) return null;
      const data = await res.json();
      return data.data as { valid: boolean; expiresInMinutes: number; hasMsalCache: boolean; needsRelogin: boolean };
    },
    refetchInterval: 5 * 60 * 1000, // check every 5 minutes
    retry: false,
  });
}

export default function Dashboard() {
  const { data: user } = useAuth();
  const { data: tokenStatus } = useTokenStatus();
  const logout = useLogout();
  const login = useLogin();
  const [tab, setTab] = useState<Tab>('campaign');
  const [showTest, setShowTest] = useState(false);

  const isSafeMode = process.env.NEXT_PUBLIC_SAFE_MODE !== 'false';
  const needsRelogin = tokenStatus?.needsRelogin || (tokenStatus?.valid === false);

  return (
    <div className="min-h-screen bg-canvas dot-grid">
      {/* Nav */}
      <header className="border-b border-border bg-canvas/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
              <Mail className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-slate-200 tracking-tight">Cold Email Shooter</span>
          </div>

          <div className="flex items-center gap-3">
            {isSafeMode && (
              <div className="hidden sm:flex items-center gap-1.5 text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2.5 py-1 rounded-full">
                <Shield className="w-3.5 h-3.5" />
                SAFE_MODE
              </div>
            )}

            <Button variant="secondary" size="sm" onClick={() => setShowTest(true)}>
              <FlaskConical className="w-3.5 h-3.5" />
              Test Email
            </Button>

            <div className="hidden sm:flex items-center gap-2 text-xs text-muted border-l border-border pl-3">
              <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold">
                {user?.displayName?.[0]?.toUpperCase() ?? '?'}
              </div>
              <span className="text-slate-400">{user?.displayName ?? user?.email}</span>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => logout.mutate()}
              loading={logout.isPending}
            >
              <LogOut className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </header>

      {/* Re-login banner */}
      {needsRelogin && (
        <div className="bg-amber-500/10 border-b border-amber-500/30">
          <div className="max-w-7xl mx-auto px-6 py-2.5 flex items-center gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span className="text-xs text-amber-300 flex-1">
              Your Outlook session has expired. Emails will fail until you re-authenticate.
              {tokenStatus?.hasMsalCache === false && ' (Session data not found — this happens if you logged in before the latest update.)'}
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => login.mutate()}
              loading={login.isPending}
              className="border-amber-500/40 text-amber-300 hover:bg-amber-500/10 flex-shrink-0"
            >
              Re-connect Outlook
            </Button>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Stats */}
        <section>
          <h2 className="text-xs text-muted font-mono uppercase tracking-widest mb-4">
            Overview
          </h2>
          <StatsCards />
        </section>

        {/* Tabs */}
        <section>
          <div className="flex gap-1 mb-6 bg-surface rounded-xl p-1 w-fit border border-border">
            <button
              onClick={() => setTab('campaign')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === 'campaign'
                  ? 'bg-surface-3 text-slate-200 border border-border-2 shadow-sm'
                  : 'text-muted hover:text-slate-300'
              }`}
            >
              <Users className="w-4 h-4" />
              Campaign
              <span className="text-xs bg-primary/20 text-blue-400 px-1.5 py-0.5 rounded-full font-mono">Apollo</span>
            </button>
            <button
              onClick={() => setTab('upload')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === 'upload'
                  ? 'bg-surface-3 text-slate-200 border border-border-2 shadow-sm'
                  : 'text-muted hover:text-slate-300'
              }`}
            >
              <Upload className="w-4 h-4" />
              Pre-formatted CSV
            </button>
            <button
              onClick={() => setTab('emails')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === 'emails'
                  ? 'bg-surface-3 text-slate-200 border border-border-2 shadow-sm'
                  : 'text-muted hover:text-slate-300'
              }`}
            >
              <List className="w-4 h-4" />
              Email Jobs
            </button>
          </div>

          {tab === 'campaign' && <CampaignUpload />}
          {tab === 'upload' && <FileUpload />}
          {tab === 'emails' && <EmailTable />}
        </section>
      </main>

      {showTest && <TestEmailModal onClose={() => setShowTest(false)} />}
    </div>
  );
}
