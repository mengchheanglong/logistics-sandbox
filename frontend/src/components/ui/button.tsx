import React from 'react';
import { cn } from '../../lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'destructive' | 'outline' | 'ghost' | 'purple' | 'subtle';
  size?: 'sm' | 'md' | 'lg' | 'icon';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', ...props }, ref) => {
    const variantStyles = {
      default: 'bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 active:scale-[0.98]',
      primary: 'bg-cyan-600 hover:bg-cyan-500 text-white font-semibold shadow-[0_0_12px_rgba(6,182,212,0.25)] active:scale-[0.98]',
      destructive: 'bg-rose-600 hover:bg-rose-500 text-white font-semibold shadow-[0_0_12px_rgba(244,63,94,0.25)] active:scale-[0.98]',
      outline: 'bg-transparent hover:bg-slate-800 text-slate-300 border border-slate-700 active:scale-[0.98]',
      ghost: 'bg-transparent hover:bg-slate-800/60 text-slate-400 hover:text-slate-100',
      purple: 'bg-purple-600 hover:bg-purple-500 text-white font-semibold shadow-[0_0_15px_rgba(168,85,247,0.3)] active:scale-[0.98]',
      subtle: 'bg-slate-900/80 hover:bg-slate-800/80 text-slate-300 border border-slate-800',
    }[variant];

    const sizeStyles = {
      sm: 'px-2.5 py-1 text-xs rounded-lg',
      md: 'px-3.5 py-2 text-xs rounded-xl',
      lg: 'px-5 py-2.5 text-sm rounded-xl',
      icon: 'w-8 h-8 p-0 rounded-lg flex items-center justify-center',
    }[size];

    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center gap-2 font-medium transition-all cursor-pointer disabled:opacity-50 disabled:pointer-events-none focus:outline-hidden',
          variantStyles,
          sizeStyles,
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = 'Button';
