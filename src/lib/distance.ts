type CalibrationPoint = { x: number; y: number }

type CalibrationSegmentInput = {
  id: string
  pointA: CalibrationPoint
  pointB: CalibrationPoint
  knownDistanceMeters: number
  notes?: string
}

type CalibrationJson = {
  mapImage: string
  coordinateSystem: string
  calibrationMethod: string
  segments: CalibrationSegmentInput[]
}

export type CalibrationSegmentDerived = {
  id: string
  pixelDistance: number
  knownDistanceMeters: number
  metersPerPixel: number
}

export type DerivedCalibration = {
  mapImage: string
  coordinateSystem: string
  calibrationMethod: string
  metersPerPixel: number
  pixelsPerMeter: number
  segments: CalibrationSegmentDerived[]
  warning: string | null
}

export function distancePx(pointA: CalibrationPoint, pointB: CalibrationPoint): number {
  return Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y)
}

export function deriveCalibration(calibrationJson: CalibrationJson): DerivedCalibration {
  const segments = calibrationJson.segments
    .map((segment) => {
      const pixelDistance = distancePx(segment.pointA, segment.pointB)
      const metersPerPixel = segment.knownDistanceMeters / pixelDistance
      return {
        id: segment.id,
        pixelDistance,
        knownDistanceMeters: segment.knownDistanceMeters,
        metersPerPixel,
      }
    })
    .filter((segment) => Number.isFinite(segment.metersPerPixel) && segment.pixelDistance > 0)

  const totalKnownMeters = segments.reduce((sum, s) => sum + s.knownDistanceMeters, 0)
  const totalPixels = segments.reduce((sum, s) => sum + s.pixelDistance, 0)
  const metersPerPixel = totalKnownMeters / totalPixels
  const pixelsPerMeter = 1 / metersPerPixel

  const ratios = segments.map((s) => s.metersPerPixel)
  const minRatio = Math.min(...ratios)
  const maxRatio = Math.max(...ratios)
  const ratioDiff = minRatio > 0 ? (maxRatio - minRatio) / minRatio : 0
  const warning = ratioDiff > 0.1 ? '校准线比例差异较大，请检查已知距离或坐标。' : null

  return {
    mapImage: calibrationJson.mapImage,
    coordinateSystem: calibrationJson.coordinateSystem,
    calibrationMethod: calibrationJson.calibrationMethod,
    metersPerPixel,
    pixelsPerMeter,
    segments,
    warning,
  }
}

export function pxToMeters(px: number, calibration: DerivedCalibration): number {
  return px * calibration.metersPerPixel
}

export function metersToPx(meters: number, calibration: DerivedCalibration): number {
  return meters * calibration.pixelsPerMeter
}

export function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`
  }
  return `${meters.toFixed(0)} m`
}
