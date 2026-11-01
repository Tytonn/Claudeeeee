import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode; fallback?: ReactNode };
type State = { error: Error | null };

/** Keeps a rendering failure from blanking the page. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("umbra crashed:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <div className="crash" role="alert">
        <h1 className="display">Something slipped.</h1>
        <p>Your notes are safe — they're saved in this browser. Reload to pick up right where you left off.</p>
        <button type="button" className="primary-btn" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
