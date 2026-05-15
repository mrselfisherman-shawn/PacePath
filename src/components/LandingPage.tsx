import { useNavigate } from 'react-router-dom'

export function LandingPage() {
  const navigate = useNavigate()
  const coverSrc = `${import.meta.env.BASE_URL}data/images/maps/cover-map.jpg`

  return (
    <div className="landing">
      <div className="landing-bg" style={{ backgroundImage: `url(${coverSrc})` }} />
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
