'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import Dashboard from '@/components/Dashboard';

export default function DashboardPage() {
  const { data: user, isLoading, error } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && (error || !user)) {
      router.replace('/');
    }
  }, [user, isLoading, error, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <span className="text-sm text-muted">Loading dashboard…</span>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return <Dashboard />;
}
