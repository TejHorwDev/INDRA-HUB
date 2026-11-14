import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { isPreview } from './lib/bridge'
import './index.css'

// In a browser preview there is no transparent window, so the frame is centred
// on a page instead. Inside Electron this attribute is never set.
if (isPreview) document.documentElement.dataset['mode'] = 'web'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
)
