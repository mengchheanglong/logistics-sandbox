import { useEffect } from 'react';

export interface NotificationItem {
  id: string;
  type: 'info' | 'warning' | 'error' | 'success';
  title: string;
  message: string;
  timestamp: number;
}

interface NotificationToastProps {
  notifications: NotificationItem[];
  onDismiss: (id: string) => void;
}

export function NotificationToast({ notifications, onDismiss }: NotificationToastProps) {
  useEffect(() => {
    if (notifications.length === 0) return;
    const latest = notifications[notifications.length - 1];
    const timer = setTimeout(() => {
      onDismiss(latest.id);
    }, 4500);
    return () => clearTimeout(timer);
  }, [notifications, onDismiss]);

  if (notifications.length === 0) return null;

  return (
    <div className="fixed top-16 right-5 z-50 flex flex-col gap-2 max-w-sm pointer-events-none select-none">
      {notifications.slice(-4).map((n) => {
        const borderClass =
          n.type === 'error'
            ? 'border-rose-500/60 bg-rose-950/80 text-rose-200 shadow-[0_0_15px_rgba(244,63,94,0.3)]'
            : n.type === 'warning'
            ? 'border-amber-500/60 bg-amber-950/80 text-amber-200 shadow-[0_0_15px_rgba(245,158,11,0.3)]'
            : n.type === 'success'
            ? 'border-emerald-500/60 bg-emerald-950/80 text-emerald-200 shadow-[0_0_15px_rgba(16,185,129,0.3)]'
            : 'border-cyan-500/60 bg-slate-900/90 text-cyan-200 shadow-[0_0_15px_rgba(6,182,212,0.3)]';

        const icon =
          n.type === 'error'
            ? '🚨'
            : n.type === 'warning'
            ? '⚠️'
            : n.type === 'success'
            ? '✓'
            : 'ℹ️';

        return (
          <div
            key={n.id}
            className={`pointer-events-auto flex items-start gap-2.5 p-3 rounded-lg border backdrop-blur-md text-xs transition-all duration-300 animate-in fade-in slide-in-from-top-2 ${borderClass}`}
          >
            <span className="text-sm shrink-0">{icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold tracking-wide uppercase text-[11px]">{n.title}</span>
                <span className="text-[10px] text-slate-400 font-mono">
                  {new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
              <p className="mt-0.5 text-slate-300 text-[11px] leading-relaxed break-words">{n.message}</p>
            </div>
            <button
              onClick={() => onDismiss(n.id)}
              className="text-slate-400 hover:text-white transition-colors p-0.5 -mr-1 -mt-1 cursor-pointer"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
