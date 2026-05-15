import { Navigate, Route, Routes } from 'react-router-dom'
import './App.css'
import { HelpPage } from './components/HelpPage'
import { HotRouteAnnotationMode } from './components/HotRouteAnnotationMode'
import { LandingPage } from './components/LandingPage'
import { Planner } from './components/Planner'
import { TopNav } from './components/TopNav'

function App() {
  const isHotMode =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('mode') === 'hot-route-annotation'

  if (isHotMode) {
    return <HotRouteAnnotationMode />
  }

  return (
    <div className="app-shell">
      <TopNav />
      <div className="app-main">
        <Routes>
          <Route index element={<LandingPage />} />
          <Route path="shortest" element={<Planner variant="shortest" />} />
          <Route path="planner" element={<Planner />} />
          <Route path="help" element={<HelpPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  )
}

export default App
