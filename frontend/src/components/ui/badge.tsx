import React from 'react';
import { cn } from '../../lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive' | 'purple' | 'cyan';
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  const variantStyles = {
    default: 'bg-slate-800 text-slate-200 border-slate-700',
    secondary: 'bg-slate-900 text-slate-400 border-slate-800',
    outline: 'bg-transparent text-slate-300 border-slate-700',
    success: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    warning: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    destructive: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    purple: 'bg-purple-500/15 text-purple-300 border-purple-500/30 shadow-[0_0_10px_rgba(168,85,247,0.15)]',
    cyan: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  }[variant];

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-medium border transition-colors',
        variantStyles,
        className
      )}
      {...props}
    />
  );
}
