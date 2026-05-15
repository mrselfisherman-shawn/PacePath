import { useMemo } from 'react'
import { useCampusData } from './useCampusData'
import { buildRoadGraph } from '../lib/graph'

export function useGuideRoadGraph(snapTolerance = 8) {
  const { places, roads, loading, error } = useCampusData()

  const graph = useMemo(() => {
    if (loading || error) return null
    return buildRoadGraph(roads, snapTolerance)
  }, [roads, loading, error, snapTolerance])

  return {
    loading,
    error,
    places,
    roads,
    graph,
  }
}
