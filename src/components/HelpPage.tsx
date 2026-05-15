export function HelpPage() {
  return (
    <main className="page help-page">
      <h1 className="page-title planner-title">Help & Guide</h1>
      <p className="planner-subtitle">Quick steps for planning better campus runs</p>

      <section className="help-card" aria-label="Planner instructions">
        <h2 className="help-section-title">Running Route Planner</h2>
        <p>1. Set your Target Distance (Km).</p>
        <p>2. Choose Start Point and End Point by map click or dropdown.</p>
        <p>3. Optionally add a Waypoint if you want a specific passing place.</p>
        <p>4. Click Generate Route, then choose your preferred option below the map.</p>
        <p>5. Orange line is the main running segment; green line is warm-up/cool-down.</p>
      </section>

      <section className="help-card" aria-label="Shortest route instructions">
        <h2 className="help-section-title">Shortest Route Navigation</h2>
        <p>1. Choose Start Point and End Point.</p>
        <p>2. Click Generate Route to get the shortest path.</p>
        <p>3. The shortest route is displayed in blue, with distance shown below the map.</p>
      </section>

      <section className="help-card" aria-label="Tips and notes">
        <h2 className="help-section-title">Tips</h2>
        <p>- Hover a map point to view place name and position info.</p>
        <p>- Use Start/Waypoint/End buttons to switch map selection mode quickly.</p>
        <p>- If no route appears, confirm both points are connected in the current road network.</p>
      </section>
    </main>
  )
}
