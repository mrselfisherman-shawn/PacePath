export type Point = { x: number; y: number }

export type SvgRoad = {
  roadId: string
  points: Point[]
  sourceId: string
}

function tokenizePathData(d: string): string[] {
  const matches = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi)
  return matches ?? []
}

function isCommand(token: string): boolean {
  return /^[a-zA-Z]$/.test(token)
}

export function parsePathToPoints(d: string): Point[] {
  if (!d.trim()) return []

  const tokens = tokenizePathData(d)
  if (tokens.length === 0) return []

  const points: Point[] = []
  let i = 0
  let command = ''
  let x = 0
  let y = 0
  let startX = 0
  let startY = 0

  while (i < tokens.length) {
    if (isCommand(tokens[i])) {
      command = tokens[i]
      i += 1
    }

    if (!command) break

    if (command === 'M' || command === 'm') {
      if (i + 1 >= tokens.length) break
      const nx = Number(tokens[i])
      const ny = Number(tokens[i + 1])
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) break

      if (command === 'm') {
        x += nx
        y += ny
      } else {
        x = nx
        y = ny
      }

      startX = x
      startY = y
      points.push({ x, y })
      i += 2
      command = command === 'm' ? 'l' : 'L'
      continue
    }

    if (command === 'L' || command === 'l') {
      if (i + 1 >= tokens.length) break
      const nx = Number(tokens[i])
      const ny = Number(tokens[i + 1])
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) break

      if (command === 'l') {
        x += nx
        y += ny
      } else {
        x = nx
        y = ny
      }

      points.push({ x, y })
      i += 2
      continue
    }

    if (command === 'H' || command === 'h') {
      if (i >= tokens.length) break
      const nx = Number(tokens[i])
      if (!Number.isFinite(nx)) break
      x = command === 'h' ? x + nx : nx
      points.push({ x, y })
      i += 1
      continue
    }

    if (command === 'V' || command === 'v') {
      if (i >= tokens.length) break
      const ny = Number(tokens[i])
      if (!Number.isFinite(ny)) break
      y = command === 'v' ? y + ny : ny
      points.push({ x, y })
      i += 1
      continue
    }

    if (command === 'Z' || command === 'z') {
      points.push({ x: startX, y: startY })
      command = ''
      continue
    }

    if (
      command === 'C' ||
      command === 'c' ||
      command === 'S' ||
      command === 's' ||
      command === 'Q' ||
      command === 'q' ||
      command === 'T' ||
      command === 't' ||
      command === 'A' ||
      command === 'a'
    ) {
      break
    }

    if (isCommand(tokens[i])) {
      continue
    }

    i += 1
  }

  const deduped: Point[] = []
  for (const point of points) {
    const last = deduped[deduped.length - 1]
    if (!last || last.x !== point.x || last.y !== point.y) {
      deduped.push(point)
    }
  }

  return deduped
}

function parsePolylinePoints(raw: string): Point[] {
  const nums = raw
    .trim()
    .split(/[\s,]+/)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))

  const points: Point[] = []
  for (let i = 0; i + 1 < nums.length; i += 2) {
    points.push({ x: nums[i], y: nums[i + 1] })
  }
  return points
}

export function parseRoadsFromSvg(svgText: string): SvgRoad[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgText, 'image/svg+xml')
  const layer = doc.querySelector('#roads_manual')
  if (!layer) {
    console.warn('parseRoadsFromSvg: roads_manual layer not found')
    return []
  }

  const roads: SvgRoad[] = []
  const elements = layer.querySelectorAll('path, polyline, line')

  elements.forEach((el, index) => {
    let points: Point[] = []

    if (el.tagName.toLowerCase() === 'path') {
      points = parsePathToPoints(el.getAttribute('d') ?? '')
    } else if (el.tagName.toLowerCase() === 'polyline') {
      points = parsePolylinePoints(el.getAttribute('points') ?? '')
    } else if (el.tagName.toLowerCase() === 'line') {
      const x1 = Number(el.getAttribute('x1'))
      const y1 = Number(el.getAttribute('y1'))
      const x2 = Number(el.getAttribute('x2'))
      const y2 = Number(el.getAttribute('y2'))
      if ([x1, y1, x2, y2].every((v) => Number.isFinite(v))) {
        points = [
          { x: x1, y: y1 },
          { x: x2, y: y2 },
        ]
      }
    }

    if (points.length >= 2) {
      roads.push({
        roadId: `R${String(index + 1).padStart(3, '0')}`,
        points,
        sourceId: el.getAttribute('id') ?? '',
      })
    }
  })

  return roads
}
