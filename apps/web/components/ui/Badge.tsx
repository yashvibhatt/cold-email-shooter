import { cn, STATUS_CONFIG } from '@/lib/utils';
import type { EmailStatus } from '@/lib/api';

interface BadgeProps {
  status: EmailStatus;
  className?: string;
}

export function StatusBadge({ status, className }: BadgeProps) {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border font-mono',
        config.bg,
        config.color,
        config.border,
        className
      )}
    >
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full flex-shrink-0',
          config.dot,
          'pulse' in config && config.pulse ? 'status-pulse' : ''
        )}
      />
      {config.label}
    </span>
  );
}
