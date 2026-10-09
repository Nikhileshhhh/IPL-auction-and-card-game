'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}
interface State {
  failed: boolean;
}

/** Client error boundary for interactive islands; shows a safe retry, no stack traces. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Telemetry hook lands in phase 19; never log user content here.
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      this.props.fallback ?? (
        <div role="alert" className="rounded-xl border border-line bg-raised p-6">
          <p className="font-semibold">This panel stopped working.</p>
          <button
            type="button"
            className="mt-4 min-h-11 rounded-lg border border-line px-4"
            onClick={() => this.setState({ failed: false })}
          >
            Try again
          </button>
        </div>
      )
    );
  }
}
