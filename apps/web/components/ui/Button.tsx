import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { ButtonHTMLAttributes, forwardRef } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, disabled, children, className, ...props }, ref) => {
    const base =
      'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50 disabled:cursor-not-allowed select-none';

    const variants = {
      primary:
        'bg-primary text-white hover:bg-primary-hover active:scale-[0.98] glow-blue',
      secondary:
        'bg-surface-2 text-slate-200 border border-border hover:bg-surface-3 hover:border-border-2',
      ghost: 'text-muted hover:text-slate-200 hover:bg-surface-2',
      danger:
        'bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 hover:border-red-400/50',
      outline:
        'border border-border text-slate-300 hover:border-border-2 hover:bg-surface-2',
    };

    const sizes = {
      sm: 'text-xs px-2.5 py-1.5 h-7',
      md: 'text-sm px-3.5 py-2 h-9',
      lg: 'text-base px-5 py-2.5 h-11',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(base, variants[variant], sizes[size], className)}
        {...props}
      >
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
