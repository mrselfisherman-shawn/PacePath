import { useNavigate } from 'react-router-dom'

export function LandingPage() {
  const navigate = useNavigate()

  return (
    <div className="landing">
      <div className="landing-bg" />
      <div className="landing-overlay" />
      <div className="landing-content">
        <h1 className="landing-title">PacePath: Smart Route Planner</h1>
        <p className="landing-desc">
          A graph-based running route planner for Westlake University campus spaces.
        </p>
        <button type="button" className="landing-button" onClick={() => navigate('/planner')}>
          Run Now!
        </button>
      </div>
    </div>
  )
}
