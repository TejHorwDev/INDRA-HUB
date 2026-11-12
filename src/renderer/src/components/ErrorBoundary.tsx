import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { AlertCircleIcon } from './icons'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

/**
 * Catches render errors anywhere below it. Users get a styled, on-brand
 * screen; the stack trace stays in the console.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[INDRA HUB] Unhandled render error', error, info.componentStack)
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="error-screen">
        <div className="empty-state">
          <span className="empty-state-icon">
            <AlertCircleIcon size={18} />
          </span>
          <h1 className="empty-state-title">Something went wrong</h1>
          <p className="empty-state-description">
            INDRA HUB hit an unexpected error. Reloading usually clears it.
          </p>
          <div className="empty-state-action flex items-center gap-2">
            <button type="button" className="btn btn-primary w-auto" onClick={this.handleReload}>
              Reload window
            </button>
            <a className="btn btn-ghost w-auto" href="#/dashboard">
              Back to dashboard
            </a>
          </div>
        </div>
      </div>
    )
  }
}
