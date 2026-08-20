'use client'

// ErrorBoundary — isolates failures per-section instead of crashing
// the whole app.
//
// The original roast documented: "no per-component error boundaries".
// Previously this class wrapped the entire app — one failure anywhere
// killed the whole UI. Now individual sections (PatternEditor, Mixer,
// Library, etc.) are wrapped with their own <ErrorBoundary name="...">
// so a failure in one section degrades gracefully without taking down
// the rest.
//
// Usage:
//   <ErrorBoundary name="PatternEditor">
//     <PatternEditor {...} />
//   </ErrorBoundary>
//
// When a section fails, its boundary shows a localized fallback UI
// (collapsible card with the error message + a Retry button).
//
// Error logging: in production, componentDidCatch should forward to
// Sentry/Bugsnag (Phase 0.2 — error tracking). For now it logs to
// console.error with the section name for grep.

import * as React from 'react'

interface ErrorBoundaryProps {
  children: React.ReactNode
  /** Section name for logging + fallback UI (e.g. "PatternEditor"). */
  name?: string
  /** Optional custom fallback — defaults to a styled card. */
  fallback?: React.ReactNode
  /** Called when an error is caught — useful for Sentry/Bugsnag. */
  onError?: (error: Error, info: React.ErrorInfo, sectionName: string) => void
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    const sectionName = this.props.name ?? 'unknown'
    // Log with section prefix so we can grep which section failed.
    console.error(`[psy-sampler] ErrorBoundary "${sectionName}" caught:`, error, info)
    // Forward to external error tracker if provided.
    if (this.props.onError) {
      this.props.onError(error, info, sectionName)
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      // Custom fallback takes precedence.
      if (this.props.fallback) return this.props.fallback
      const sectionName = this.props.name ?? 'section'
      // Per-section fallback — shows a collapsed card instead of the
      // failed section. The rest of the UI keeps working.
      return (
        <div
          className="section p-4"
          style={{
            borderRadius: '8px',
            border: '1px solid rgba(248,81,73,0.3)',
            background: 'rgba(248,81,73,0.05)',
          }}
        >
          <div className="flex items-center gap-2">
            <span
              className="font-mono text-xs font-bold uppercase tracking-wider"
              style={{ color: '#f85149' }}
            >
              {sectionName} failed
            </span>
            <button
              onClick={this.handleReset}
              className="rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider hover:brightness-125"
              style={{ borderColor: 'rgba(0,229,255,0.3)', color: '#86f7ff', background: 'transparent' }}
              title={`Retry ${sectionName}`}
            >
              Retry
            </button>
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer font-mono text-[10px]" style={{ color: '#9aa3af' }}>
              show error details
            </summary>
            <pre
              className="mt-2 overflow-x-auto font-mono text-[10px]"
              style={{ color: '#f85149', whiteSpace: 'pre-wrap' }}
            >
              {this.state.error?.stack ?? this.state.error?.message ?? 'Unknown error'}
            </pre>
          </details>
        </div>
      )
    }
    return this.props.children
  }
}
