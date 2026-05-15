import { NavLink } from 'react-router-dom'

export function TopNav() {
  return (
    <header className="top-nav" aria-label="Main navigation">
      <div className="top-nav-inner">
        <NavLink to="/" className="brand-link">
          <img className="brand-logo" src="/data/images/logo/logo.png" alt="PacePath logo" />
          <span>PacePath</span>
        </NavLink>
        <nav className="top-nav-links" aria-label="Primary">
          <NavLink
            to="/"
            end
            className={({ isActive }) => (isActive ? 'top-nav-link is-active' : 'top-nav-link')}
          >
            Home
          </NavLink>
          <NavLink
            to="/shortest"
            className={({ isActive }) => (isActive ? 'top-nav-link is-active' : 'top-nav-link')}
          >
            Shortest Route Navigation
          </NavLink>
          <NavLink
            to="/planner"
            className={({ isActive }) => (isActive ? 'top-nav-link is-active' : 'top-nav-link')}
          >
            Running Route Planner
          </NavLink>
          <NavLink
            to="/help"
            className={({ isActive }) => (isActive ? 'top-nav-link is-active' : 'top-nav-link')}
          >
            Help
          </NavLink>
        </nav>
      </div>
    </header>
  )
}
