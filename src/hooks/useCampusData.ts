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
  const placesPath = `${import.meta.env.BASE_URL}data/csv/place-annotated.csv`
  const roadsPath = `${import.meta.env.BASE_URL}data/guide_roads.csv`
  const mappingsPath = `${import.meta.env.BASE_URL}data/csv/place-road-mapping.csv`
  const [state, setState] = useState<CampusDataState>(initialState)

  useEffect(() => {
    let cancelled = false

    async function loadCampusData() {
      try {
        const [places, roads, mappings] = await Promise.all([
          loadCsv(placesPath),
          loadCsv(roadsPath),
          loadCsv(mappingsPath),
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
  }, [mappingsPath, placesPath, roadsPath])

  return useMemo(() => state, [state])
}
