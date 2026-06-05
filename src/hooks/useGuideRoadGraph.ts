import { useEffect, useMemo, useState } from 'react'
import { useCampusData } from './useCampusData'
import { buildRoadGraph } from '../lib/graph'

export function useGuideRoadGraph(snapTolerance = 8) {
  const { places, roads, loading, error } = useCampusData()
  const [perimeterRoadIds, setPerimeterRoadIds] = useState<Set<string> | null>(null)

  const perimeterPath = `${import.meta.env.BASE_URL}data/meta/perimeter-roads.json`

  useEffect(() => {
    let cancelled = false
    fetch(perimeterPath)
      .then((res) => {
        if (!res.ok) throw new Error('not found')
        return res.json()
      })
      .then((data) => {
        if (!cancelled) {
          setPerimeterRoadIds(new Set(data.perimeterRoadIds ?? []))
        }
      })
      .catch(() => {
        if (!cancelled) setPerimeterRoadIds(new Set())
      })
    return () => { cancelled = true }
  }, [perimeterPath])

  const graph = useMemo(() => {
    if (loading || error || perimeterRoadIds === null) return null
    return buildRoadGraph(roads, snapTolerance, perimeterRoadIds)
  }, [roads, loading, error, snapTolerance, perimeterRoadIds])

  return {
    loading: loading || perimeterRoadIds === null,
    error,
    places,
    roads,
    graph,
  }
}
