'use client'

// ErrorBoundary — catches React render errors and shows a recovery screen.
// Prevents a single component crash from blanking the entire page.

import * as React from 'react'

interface ErrorBoundaryProps {
  children: React.ReactNode
  fallback?: React.ReactNode
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
    console.error('[error-boundary] Caught:', error, info.componentStack)
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null })
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-950 p-6">
          <div className="max-w-md rounded-lg border border-red-500/30 bg-zinc-900 p-6 text-center">
            <div className="mb-3 text-4xl">⚠️</div>
            <h2 className="mb-2 font-mono text-lg font-bold text-red-300">Render Error</h2>
            <p className="mb-4 font-mono text-xs text-zinc-400">
              {this.state.error?.message ?? 'Unknown error'}
            </p>
            <button
              onClick={this.handleReset}
              className="rounded border border-emerald-400/40 bg-zinc-800 px-4 py-2 font-mono text-xs uppercase tracking-wider text-emerald-300 hover:bg-emerald-500/10"
            >
              Try Again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
