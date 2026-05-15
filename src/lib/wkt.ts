export type Point = { x: number; y: number }

export function parseLineStringWkt(wkt: string): Point[] {
  const text = wkt.trim()

  if (!text) {
    console.warn('parseLineStringWkt: empty WKT input')
    return []
  }

  const match = /^LINESTRING\s*\((.*)\)$/i.exec(text)
  if (!match) {
    console.warn('parseLineStringWkt: only LINESTRING is supported', wkt)
    return []
  }

  const body = match[1].trim()
  if (!body) {
    console.warn('parseLineStringWkt: LINESTRING has no coordinates', wkt)
    return []
  }

  const points: Point[] = []
  const pairs = body.split(',')

  for (const pair of pairs) {
    const values = pair.trim().split(/\s+/)
    if (values.length < 2) {
      console.warn('parseLineStringWkt: invalid coordinate pair', pair)
      return []
    }

    const x = Number(values[0])
    const y = Number(values[1])
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      console.warn('parseLineStringWkt: non-numeric coordinate', pair)
      return []
    }

    points.push({ x, y })
  }

  return points
}
