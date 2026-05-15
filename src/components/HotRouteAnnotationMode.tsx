import { type KeyboardEvent, useEffect, useMemo, useState } from 'react'
import { loadCsv, type CsvRow } from '../lib/csv'
import { parseLineStringWkt } from '../lib/wkt'

type RoadRow = CsvRow & {
  road_id: string
  type: string
  geometry_wkt: string
  preferred: string
  popularity: string
  scenic_score: string
  hot_route_group: string
  hot_route_name: string
  notes: string
}

const REQUIRED_FIELDS = [
  'preferred',
  'popularity',
  'scenic_score',
  'hot_route_group',
  'hot_route_name',
  'notes',
] as const

function normalizeRoad(row: CsvRow): RoadRow {
  return {
    ...row,
    road_id: row.road_id ?? '',
    type: row.type ?? '',
    geometry_wkt: row.geometry_wkt ?? '',
    preferred: (row.preferred ?? 'no').trim() || 'no',
    popularity: (row.popularity ?? '0').trim() || '0',
    scenic_score: (row.scenic_score ?? '0').trim() || '0',
    hot_route_group: row.hot_route_group ?? '',
    hot_route_name: row.hot_route_name ?? '',
    notes: row.notes ?? '',
  }
}

function toNumber(value: string, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function HotRouteAnnotationMode() {
  const [rows, setRows] = useState<RoadRow[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selectedRoadIds, setSelectedRoadIds] = useState<Set<string>>(new Set())
  const [focusedRoadId, setFocusedRoadId] = useState('')

  const [batchPopularity, setBatchPopularity] = useState(0.8)
  const [batchScenic, setBatchScenic] = useState(0.6)
  const [batchGroup, setBatchGroup] = useState('')
  const [batchName, setBatchName] = useState('')
  const [batchNotes, setBatchNotes] = useState('')

  const [singlePreferred, setSinglePreferred] = useState(false)
  const [singlePopularity, setSinglePopularity] = useState(0)
  const [singleScenic, setSingleScenic] = useState(0)
  const [singleName, setSingleName] = useState('')
  const [singleNotes, setSingleNotes] = useState('')

  function handleSvgActionKeyDown(event: KeyboardEvent<SVGElement>, action: () => void) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      action()
    }
  }

  useEffect(() => {
    let cancelled = false

    async function loadRoads() {
      try {
        const data = await loadCsv('/data/guide-roads.csv')
        if (cancelled) return

        const normalized = data.map(normalizeRoad)
        setRows(normalized)

        const baseHeaders = normalized.length > 0 ? Object.keys(normalized[0]) : []
        const merged = [...baseHeaders]
        REQUIRED_FIELDS.forEach((field) => {
          if (!merged.includes(field)) merged.push(field)
        })
        setHeaders(merged)
        setLoading(false)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load guide-roads.csv')
          setLoading(false)
        }
      }
    }

    loadRoads()
    return () => {
      cancelled = true
    }
  }, [])

  const roads = useMemo(() => {
    return rows
      .map((row) => ({
        row,
        points: parseLineStringWkt(row.geometry_wkt),
      }))
      .filter((item) => item.points.length >= 2)
  }, [rows])

  const focusedRoad = useMemo(() => rows.find((r) => r.road_id === focusedRoadId) ?? null, [rows, focusedRoadId])

  useEffect(() => {
    if (!focusedRoad) return
    setSinglePreferred((focusedRoad.preferred ?? 'no').toLowerCase() === 'yes')
    setSinglePopularity(clamp01(toNumber(focusedRoad.popularity, 0)))
    setSingleScenic(clamp01(toNumber(focusedRoad.scenic_score, 0)))
    setSingleName(focusedRoad.hot_route_name ?? '')
    setSingleNotes(focusedRoad.notes ?? '')
  }, [focusedRoad])

  const hotRoads = useMemo(() => {
    return rows.filter((row) => {
      const preferred = (row.preferred ?? 'no').toLowerCase() === 'yes'
      const pop = toNumber(row.popularity, 0)
      return preferred || pop > 0
    })
  }, [rows])

  function toggleRoadSelection(roadId: string) {
    setFocusedRoadId(roadId)
    setSelectedRoadIds((prev) => {
      const next = new Set(prev)
      if (next.has(roadId)) next.delete(roadId)
      else next.add(roadId)
      return next
    })
  }

  function applyBatchToSelected() {
    if (selectedRoadIds.size === 0) {
      setNotice('Please select at least one road before applying batch changes.')
      return
    }
    setRows((prev) =>
      prev.map((row) => {
        if (!selectedRoadIds.has(row.road_id)) return row
        return {
          ...row,
          preferred: 'yes',
          popularity: String(clamp01(batchPopularity)),
          scenic_score: String(clamp01(batchScenic)),
          hot_route_group: batchGroup,
          hot_route_name: batchName,
          notes: batchNotes || row.notes || '',
        }
      }),
    )
    setNotice(`Applied batch settings to ${selectedRoadIds.size} selected road(s).`)
  }

  function saveSingleRoadEdit() {
    if (!focusedRoadId) {
      setNotice('Select a road first, then save single-road edits.')
      return
    }
    setRows((prev) =>
      prev.map((row) => {
        if (row.road_id !== focusedRoadId) return row
        return {
          ...row,
          preferred: singlePreferred ? 'yes' : 'no',
          popularity: String(clamp01(singlePopularity)),
          scenic_score: String(clamp01(singleScenic)),
          hot_route_name: singleName,
          notes: singleNotes,
        }
      }),
    )
    setNotice(`Saved changes for road ${focusedRoadId}.`)
  }

  function removeHotRoad(roadId: string) {
    setRows((prev) =>
      prev.map((row) => {
        if (row.road_id !== roadId) return row
        return {
          ...row,
          preferred: 'no',
          popularity: '0',
          scenic_score: '0',
          hot_route_group: '',
          hot_route_name: '',
        }
      }),
    )
    setNotice(`Removed hot-route metadata from road ${roadId}.`)
  }

  function exportUpdatedCsv() {
    const outHeaders = [...headers]
    REQUIRED_FIELDS.forEach((field) => {
      if (!outHeaders.includes(field)) outHeaders.push(field)
    })

    const lines = [outHeaders.join(',')]
    for (const row of rows) {
      const line = outHeaders.map((h) => escapeCsv(String(row[h] ?? ''))).join(',')
      lines.push(line)
    }

    downloadCsv('guide-roads.annotated.csv', lines.join('\n'))
    setNotice('Export complete: downloaded guide-roads.annotated.csv')
  }

  if (loading) {
    return <main className="page"><p>Loading hot route annotation mode...</p></main>
  }

  if (error) {
    return <main className="page"><p>Failed to load roads: {error}</p></main>
  }

  return (
    <main className="page hot-mode-page">
      <h1 className="page-title">Hot Route Annotation Mode</h1>
      <p className="route-notice" aria-live="polite">{notice}</p>

      <section className="hot-mode-layout">
        <aside className="hot-sidebar">
          <h2>Batch Apply</h2>
          <label>popularity (0-1)
            <input name="batchPopularityRange" type="range" min="0" max="1" step="0.01" value={batchPopularity} onChange={(e) => setBatchPopularity(clamp01(Number(e.target.value)))} />
            <input name="batchPopularity" type="number" min="0" max="1" step="0.01" inputMode="decimal" autoComplete="off" value={batchPopularity} onChange={(e) => setBatchPopularity(clamp01(Number(e.target.value)))} />
          </label>
          <label>scenic_score (0-1)
            <input name="batchScenicRange" type="range" min="0" max="1" step="0.01" value={batchScenic} onChange={(e) => setBatchScenic(clamp01(Number(e.target.value)))} />
            <input name="batchScenic" type="number" min="0" max="1" step="0.01" inputMode="decimal" autoComplete="off" value={batchScenic} onChange={(e) => setBatchScenic(clamp01(Number(e.target.value)))} />
          </label>
          <label>hot_route_group
            <input name="batchGroup" autoComplete="off" type="text" value={batchGroup} onChange={(e) => setBatchGroup(e.target.value)} />
          </label>
          <label>hot_route_name
            <input name="batchName" autoComplete="off" type="text" value={batchName} onChange={(e) => setBatchName(e.target.value)} />
          </label>
          <label>notes
            <textarea name="batchNotes" value={batchNotes} onChange={(e) => setBatchNotes(e.target.value)} />
          </label>
          <button type="button" onClick={applyBatchToSelected}>Apply to Selected Roads</button>
          <button type="button" onClick={exportUpdatedCsv}>Export Updated guide-roads.csv</button>

          <h2>Single Road Edit</h2>
          {focusedRoad ? (
            <>
              <p>road_id: {focusedRoad.road_id}</p>
              <label>
                <input name="singlePreferred" type="checkbox" checked={singlePreferred} onChange={(e) => setSinglePreferred(e.target.checked)} />
                preferred
              </label>
              <label>popularity
                <input name="singlePopularity" type="number" min="0" max="1" step="0.01" inputMode="decimal" autoComplete="off" value={singlePopularity} onChange={(e) => setSinglePopularity(clamp01(Number(e.target.value)))} />
              </label>
              <label>scenic_score
                <input name="singleScenic" type="number" min="0" max="1" step="0.01" inputMode="decimal" autoComplete="off" value={singleScenic} onChange={(e) => setSingleScenic(clamp01(Number(e.target.value)))} />
              </label>
              <label>hot_route_name
                <input name="singleName" autoComplete="off" type="text" value={singleName} onChange={(e) => setSingleName(e.target.value)} />
              </label>
              <label>notes
                <textarea name="singleNotes" value={singleNotes} onChange={(e) => setSingleNotes(e.target.value)} />
              </label>
              <button type="button" onClick={saveSingleRoadEdit}>Save Road Edit</button>
            </>
          ) : (
            <p>Click a road to edit.</p>
          )}

          <h2>Selected Hot Roads</h2>
          <ul className="hot-road-list">
            {hotRoads.map((row) => (
              <li key={`hot-${row.road_id}`}>
                <div>
                  <strong>{row.road_id}</strong> ({row.type})<br />
                  pop {row.popularity} | scenic {row.scenic_score}<br />
                  {row.hot_route_name || '-'}
                </div>
                <button type="button" onClick={() => removeHotRoad(row.road_id)}>remove</button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="map-section">
          <div className="map-container">
            <img className="map-image" src="/data/images/guides/campus-guide.jpg" alt="Campus guide map" />
            <svg className="map-overlay" viewBox="0 0 3085 3221" preserveAspectRatio="xMidYMid meet">
              {roads.map(({ row, points }) => {
                const selected = selectedRoadIds.has(row.road_id)
                const isHot = (row.preferred ?? 'no').toLowerCase() === 'yes' || toNumber(row.popularity, 0) > 0
                return (
                  <polyline
                    key={row.road_id}
                    points={points.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke={selected ? '#f97316' : isHot ? '#22c55e' : '#64748b'}
                    strokeWidth={selected ? 5 : isHot ? 3 : 2}
                    opacity={selected ? 1 : isHot ? 0.85 : 0.25}
                    className="road-line"
                    role="button"
                    tabIndex={0}
                    aria-label={`toggle road ${row.road_id}`}
                    onClick={() => toggleRoadSelection(row.road_id)}
                    onKeyDown={(event) =>
                      handleSvgActionKeyDown(event, () => toggleRoadSelection(row.road_id))
                    }
                  >
                    <title>{`road_id: ${row.road_id}\ntype: ${row.type}\npopularity: ${row.popularity}\npreferred: ${row.preferred}\nscenic_score: ${row.scenic_score}\nhot_route_name: ${row.hot_route_name}\nnotes: ${row.notes}`}</title>
                  </polyline>
                )
              })}
            </svg>
          </div>
        </section>
      </section>
    </main>
  )
}
