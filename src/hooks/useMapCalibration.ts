import { useEffect, useMemo, useState } from 'react'
import { deriveCalibration, type DerivedCalibration } from '../lib/distance'

type CalibrationState = {
  calibration: DerivedCalibration | null
  loading: boolean
  error: string | null
}

const initialState: CalibrationState = {
  calibration: null,
  loading: true,
  error: null,
}

export function useMapCalibration() {
  const [state, setState] = useState<CalibrationState>(initialState)

  useEffect(() => {
    let cancelled = false

    async function loadCalibration() {
      try {
        const response = await fetch('/data/meta/map-calibration.json')
        if (!response.ok) {
          throw new Error('Failed to fetch map-calibration.json')
        }

        const json = await response.json()
        const calibration = deriveCalibration(json)

        if (!cancelled) {
          setState({ calibration, loading: false, error: null })
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            calibration: null,
            loading: false,
            error: error instanceof Error ? error.message : 'Unknown calibration error',
          })
        }
      }
    }

    loadCalibration()

    return () => {
      cancelled = true
    }
  }, [])

  return useMemo(() => state, [state])
}
