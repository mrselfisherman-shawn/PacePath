import { useEffect, useMemo, useState } from 'react'
import { parseRoadsFromSvg, type SvgRoad } from '../lib/svgRoadNetwork'

type SvgRoadNetworkState = {
  roads: SvgRoad[]
  loading: boolean
  error: string | null
}

const initialState: SvgRoadNetworkState = {
  roads: [],
  loading: true,
  error: null,
}

export function useSvgRoadNetwork() {
  const [state, setState] = useState<SvgRoadNetworkState>(initialState)

  useEffect(() => {
    let cancelled = false

    async function loadSvgRoadNetwork() {
      try {
        const response = await fetch('/data/images/maps/campus-running-network.svg')
        if (!response.ok) {
          throw new Error('Failed to fetch campus-running-network.svg')
        }

        const svgText = await response.text()
        const roads = parseRoadsFromSvg(svgText)

        if (!cancelled) {
          setState({ roads, loading: false, error: null })
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            roads: [],
            loading: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      }
    }

    loadSvgRoadNetwork()

    return () => {
      cancelled = true
    }
  }, [])

  return useMemo(() => state, [state])
}
