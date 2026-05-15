import { useEffect, useMemo, useState } from 'react'
import { loadCsv, type CsvRow } from '../lib/csv'

type CampusDataState = {
  places: CsvRow[]
  roads: CsvRow[]
  mappings: CsvRow[]
  loading: boolean
  error: string | null
}

const initialState: CampusDataState = {
  places: [],
  roads: [],
  mappings: [],
  loading: true,
  error: null,
}

export function useCampusData() {
  const [state, setState] = useState<CampusDataState>(initialState)

  useEffect(() => {
    let cancelled = false

    async function loadCampusData() {
      try {
        const [places, roads, mappings] = await Promise.all([
          loadCsv('/data/csv/place-annotated.csv'),
          loadCsv('/data/guide_roads.csv'),
          loadCsv('/data/csv/place-road-mapping.csv'),
        ])

        if (!cancelled) {
          setState({
            places,
            roads,
            mappings,
            loading: false,
            error: null,
          })
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            places: [],
            roads: [],
            mappings: [],
            loading: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      }
    }

    loadCampusData()

    return () => {
      cancelled = true
    }
  }, [])

  return useMemo(() => state, [state])
}
