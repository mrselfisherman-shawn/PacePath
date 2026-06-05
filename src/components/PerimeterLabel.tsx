import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadCsv, type CsvRow } from '../lib/csv'
import { parseLineStringWkt } from '../lib/wkt'

type ParsedRoad = {
  road_id: string
  points: Array<{ x: number; y: number }>
  popularity: number
}

export function PerimeterLabel() {
  const roadsPath = `${import.meta.env.BASE_URL}data/guide_roads.csv`
  const guideMapSrc = `${import.meta.env.BASE_URL}data/images/guides/campus-guide.jpg`
  const [roads, setRoads] = useState<CsvRow[]>([])
  const [loading, setLoading] = useState(true)
  const [perimeterRoadIds, setPerimeterRoadIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    loadCsv(roadsPath)
      .then((data) => {
        if (!cancelled) {
          setRoads(data)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [roadsPath])

  const parsedRoads = useMemo(() => {
    const out: ParsedRoad[] = []
    for (const row of roads) {
      const points = parseLineStringWkt(row.geometry_wkt ?? '')
      if (points.length < 2) continue
      out.push({
        road_id: row.road_id ?? '',
        points,
        popularity: Number(row.popularity ?? '0'),
      })
    }
    return out
  }, [roads])

  const popularRoads = useMemo(() => parsedRoads.filter((r) => r.popularity > 0), [parsedRoads])
  const nonPopularRoads = useMemo(() => parsedRoads.filter((r) => r.popularity <= 0), [parsedRoads])

  const togglePerimeter = useCallback((roadId: string) => {
    setPerimeterRoadIds((prev) => {
      const next = new Set(prev)
      if (next.has(roadId)) next.delete(roadId)
      else next.add(roadId)
      return next
    })
  }, [])

  function handleDownload() {
    const data = { perimeterRoadIds: [...perimeterRoadIds].sort() }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'perimeter-roads.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return <main className="page"><p>Loading road data...</p></main>
  }

  return (
    <main className="page">
      <h1 className="page-title">Perimeter Road Labeling</h1>
      <p className="planner-subtitle">
        Click on a popular road to toggle between <strong>internal</strong> (blue) and <strong>perimeter</strong> (orange).
      </p>

      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <span>Marked: <strong>{perimeterRoadIds.size}</strong> / {popularRoads.length} popular roads as perimeter</span>
        <button type="button" className="mode-button" onClick={handleDownload}>
          Download perimeter-roads.json
        </button>
        <span style={{ fontSize: 13, color: '#66705f' }}>
          Place the downloaded file in <code>public/data/meta/perimeter-roads.json</code>
        </span>
      </div>

      <section className="map-section">
        <div className="map-container" style={{ cursor: 'crosshair', overflow: 'hidden' }}>
          <img className="map-image" src={guideMapSrc} alt="Campus guide map" />
          <svg className="map-overlay" viewBox="0 0 3085 3221" preserveAspectRatio="xMidYMid meet">
            <g>
              {nonPopularRoads.map((r) =>
                r.points.slice(0, -1).map((p, i) => (
                  <line
                    key={`np-${r.road_id}-${i}`}
                    x1={p.x} y1={p.y}
                    x2={r.points[i + 1].x} y2={r.points[i + 1].y}
                    stroke="#ccc" strokeWidth={2} opacity={0.25}
                  />
                ))
              )}
            </g>
            <g>
              {popularRoads.map((r) => {
                const isPerimeter = perimeterRoadIds.has(r.road_id)
                const color = isPerimeter ? '#f97316' : '#3b82f6'
                return r.points.slice(0, -1).map((p, i) => (
                  <line
                    key={`pop-${r.road_id}-${i}`}
                    x1={p.x} y1={p.y}
                    x2={r.points[i + 1].x} y2={r.points[i + 1].y}
                    stroke={color}
                    strokeWidth={isPerimeter ? 16 : 10}
                    strokeLinecap="round"
                    opacity={0.85}
                    style={{ cursor: 'pointer' }}
                    onClick={() => togglePerimeter(r.road_id)}
                  />
                ))
              })}
            </g>
          </svg>
        </div>
      </section>

      <section className="map-legend" style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 10 }}>
        <div className="map-legend-item">
          <span style={{ width: 20, height: 4, background: '#3b82f6', display: 'inline-block', borderRadius: 2 }} />
          <span>Internal popular</span>
        </div>
        <div className="map-legend-item">
          <span style={{ width: 20, height: 4, background: '#f97316', display: 'inline-block', borderRadius: 2 }} />
          <span>Perimeter popular</span>
        </div>
        <div className="map-legend-item">
          <span style={{ width: 20, height: 2, background: '#ccc', display: 'inline-block', borderRadius: 1 }} />
          <span>Other roads</span>
        </div>
      </section>
    </main>
  )
}
