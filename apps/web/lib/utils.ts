import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatDatetime(
  isoString: string,
  timezone = 'UTC'
): string {
  try {
    const utc = new Date(isoString);
    const zoned = toZonedTime(utc, timezone);
    return format(zoned, 'MMM d, yyyy HH:mm') + ` (${timezone})`;
  } catch {
    return isoString;
  }
}

export function formatRelative(isoString: string): string {
  try {
    return formatDistanceToNow(new Date(isoString), { addSuffix: true });
  } catch {
    return isoString;
  }
}

export function formatShortDate(isoString: string): string {
  try {
    return format(new Date(isoString), 'MMM d, HH:mm');
  } catch {
    return isoString;
  }
}

export const STATUS_CONFIG = {
  PENDING: {
    label: 'Pending',
    color: 'text-amber-400',
    bg: 'bg-amber-400/10',
    border: 'border-amber-400/30',
    dot: 'bg-amber-400',
  },
  SCHEDULED: {
    label: 'Scheduled',
    color: 'text-blue-400',
    bg: 'bg-blue-400/10',
    border: 'border-blue-400/30',
    dot: 'bg-blue-400',
    pulse: true,
  },
  SENT: {
    label: 'Sent',
    color: 'text-emerald-400',
    bg: 'bg-emerald-400/10',
    border: 'border-emerald-400/30',
    dot: 'bg-emerald-400',
  },
  FAILED: {
    label: 'Failed',
    color: 'text-red-400',
    bg: 'bg-red-400/10',
    border: 'border-red-400/30',
    dot: 'bg-red-400',
  },
  CANCELLED: {
    label: 'Cancelled',
    color: 'text-slate-500',
    bg: 'bg-slate-500/10',
    border: 'border-slate-500/30',
    dot: 'bg-slate-500',
  },
} as const;

export function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
}
