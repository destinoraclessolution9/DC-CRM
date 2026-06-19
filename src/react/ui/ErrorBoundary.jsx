import { Component } from 'react';

/**
 * ErrorBoundary — minimal island-level guard (#24).
 *
 * One island render throw used to blank the whole view (an unmounted root
 * leaves an empty container). This catches the throw, logs it, and renders a
 * lightweight fallback so the rest of the page stays intact. It only catches
 * render/lifecycle errors of its subtree — async/event-handler throws still
 * surface normally.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // Keep a record in the console for triage; non-fatal to the rest of the app.
    console.error('[react-island] section render failed:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          style={{
            padding: 'var(--space-md, 16px)',
            color: 'var(--text-muted)',
            fontSize: '0.9rem',
          }}
        >
          This section failed to load. Try reloading.
        </div>
      );
    }
    return this.props.children;
  }
}
