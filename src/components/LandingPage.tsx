import { useNavigate } from 'react-router-dom'

export function LandingPage() {
  const navigate = useNavigate()
  const coverSrc = `${import.meta.env.BASE_URL}data/images/maps/cover-map.jpg`

  return (
    <div className="landing">
      <div className="landing-content">
        <section className="landing-hero" aria-label="PacePath hero">
          <div className="landing-copy">
            <p className="landing-slogan">
              Generate Your Path,
              <br />
              Run at Your Pace.
            </p>
            <p className="landing-desc">
              Plan the shortest way across campus, or create a target-distance route for your
              daily run.
            </p>
            <div className="landing-actions">
              <button
                type="button"
                className="landing-button landing-button-primary"
                onClick={() => navigate('/planner')}
              >
                Run Now!
              </button>
              <button
                type="button"
                className="landing-button landing-button-secondary"
                onClick={() => navigate('/shortest')}
              >
                Shortest Route Navigation
              </button>
            </div>
          </div>

          <aside className="landing-preview" aria-label="Campus route preview">
            <div className="landing-preview-label landing-preview-label-main">3.0 km Running Route</div>
            <div className="landing-preview-label landing-preview-label-sub">Shortest path available</div>
            <div className="landing-preview-image-wrap">
              <img className="landing-preview-image" src={coverSrc} alt="Campus route map preview" />
              <span className="landing-route-dot landing-route-dot-main" aria-hidden="true" />
              <span className="landing-route-dot landing-route-dot-alt" aria-hidden="true" />
            </div>
          </aside>
        </section>
      </div>
    </div>
  )
}
