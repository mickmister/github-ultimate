'use client';
import { Component, type ErrorInfo, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode; scope: string; retry?: boolean }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(`Alohak ${this.props.scope} render failed`, error, info.componentStack); }
  render() {
    const error = this.state.error;
    if (!error) return this.props.children;
    return <section className="chat-render-error" role="alert" aria-label={`${this.props.scope} display error`}><h2>Could not display {this.props.scope}</h2><p>{this.props.retry ? 'Your conversation and draft remain open. Retrying the display does not resend messages or run tools.' : 'Reload to restore the latest saved conversation. Unsaved changes may be lost; messages and tools will not be automatically resent.'}</p><details><summary>Error details</summary><p>Build {process.env.NEXT_PUBLIC_APP_VERSION ?? 'development'}</p><pre>{error.stack ?? error.message}</pre></details>{this.props.retry ? <button onClick={() => this.setState({ error: undefined })}>Retry display</button> : <button onClick={() => location.reload()}>Reload Alohak</button>}<a href="../app/">Go to home</a></section>;
  }
}
