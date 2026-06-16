import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AppV2 from './AppV2.tsx'
import { TourProvider } from './tour'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TourProvider>
      <AppV2 />
    </TourProvider>
  </StrictMode>,
)
