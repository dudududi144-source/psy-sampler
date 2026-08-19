'use client'

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

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="fixed inset-0 z-50 grid place-items-center p-6" style={{ background: '#0b0d11' }}>
          <div className="max-w-md p-6 text-center" style={{ borderRadius: '10px', border: '1px solid rgba(248,81,73,0.3)', background: '#14161c' }}>
            <h2 className="mb-2 font-mono text-lg font-bold" style={{ color: '#f85149' }}>ERROR</h2>
            <p className="mb-4 font-mono text-xs" style={{ color: '#9aa3af' }}>
              Something went wrong. Please refresh the page.
            </p>
            <button
              onClick={this.handleReset}
              className="px-4 py-2 font-mono text-xs uppercase tracking-wider hover:brightness-125"
              style={{ borderRadius: '7px', border: '1px solid rgba(0,229,255,0.3)', background: '#191c22', color: '#86f7ff' }}
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
