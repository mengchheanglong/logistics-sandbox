import { Component, ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught UI error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen w-screen bg-slate-950 text-slate-100 p-6 text-center select-none">
          <div className="w-12 h-12 rounded-full bg-rose-950/80 border border-rose-500/50 flex items-center justify-center text-2xl mb-4">
            ⚠️
          </div>
          <h2 className="text-xl font-bold text-rose-400 mb-2">Control Room Visual Encountered an Issue</h2>
          <p className="text-sm text-slate-400 max-w-md mb-6 leading-relaxed">
            {this.state.error?.message || 'A visual layer or WebGL context error occurred.'}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold rounded-lg shadow-lg shadow-cyan-600/30 transition-all cursor-pointer"
          >
            🔄 Reload Control Room
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
