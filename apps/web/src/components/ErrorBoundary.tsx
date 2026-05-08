import { Component, type ErrorInfo, type ReactNode } from "react";

export interface FallbackProps {
  error: unknown;
  reset: () => void;
}

interface Props {
  children: ReactNode;
  fallback: (props: FallbackProps) => ReactNode;
  /** When any of these change, the boundary auto-resets. */
  resetKeys?: unknown[];
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: unknown;
}

/**
 * Minimal error boundary. We don't use the `react-error-boundary` package
 * because its type defs lean on a slightly older @types/react `Component`
 * shape that conflicts with this repo's React 19 types — the JSX element
 * type check fails. A 30-line class is simpler than fighting types.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface render errors in dev so they're not swallowed by the fallback.
    if (import.meta.env.DEV) {
      console.error("ErrorBoundary caught:", error, info);
    }
  }

  componentDidUpdate(prev: Props) {
    if (!this.state.hasError) return;
    const prevKeys = prev.resetKeys ?? [];
    const nextKeys = this.props.resetKeys ?? [];
    const changed =
      prevKeys.length !== nextKeys.length || prevKeys.some((k, i) => k !== nextKeys[i]);
    if (changed) this.reset();
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return this.props.fallback({ error: this.state.error, reset: this.reset });
    }
    return this.props.children;
  }
}
