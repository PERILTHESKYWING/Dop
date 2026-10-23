import { Component, type ReactNode } from 'react';

/**
 * Shows `fallback` when a lazily loaded part fails to arrive (offline, or an old chunk gone
 * after a deploy), so one missing file never blanks the whole app.
 */
export class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** The fallback for a part that could not load: a short note and a way to fetch the page again. */
export function LoadFailed({ float = false }: { float?: boolean }) {
  return (
    <p className={`muted load-failed${float ? ' float' : ''}`}>
      This part could not load. <button type="button" onClick={() => location.reload()}>Reload</button>
    </p>
  );
}
