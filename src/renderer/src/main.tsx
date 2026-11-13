import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { ToastProvider } from './components/ToastProvider'
import { SessionProvider } from './lib/session'
import { ThemeProvider, initTheme } from './lib/theme'
import { AppStatusProvider } from './lib/appStatus'
import { ConnectivityProvider } from './lib/connectivity'
import './styles/index.css'
import './styles/workspace.css'
import './styles/document.css'
import './styles/presentation.css'

initTheme()

const container = document.getElementById('root')
if (!container) throw new Error('Root element #root was not found')

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <AppStatusProvider>
          <SessionProvider>
            <ConnectivityProvider>
              <ErrorBoundary>
                <HashRouter>
                  <App />
                </HashRouter>
              </ErrorBoundary>
            </ConnectivityProvider>
          </SessionProvider>
        </AppStatusProvider>
      </ToastProvider>
    </ThemeProvider>
  </StrictMode>
)
