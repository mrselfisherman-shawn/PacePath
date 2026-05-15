import fs from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const svgPath = path.join(root, 'public', 'data', 'images', 'maps', 'campus-running-network.svg')
const outCsvPath = path.join(root, 'public', 'data', 'guide_roads.csv')

function csvEscape(value) {
  const text = String(value ?? '')
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

function tokenizePathData(d) {
  return d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []
}

function isCommand(token) {
  return /^[a-zA-Z]$/.test(token)
}

function parsePathToPoints(d) {
  const tokens = tokenizePathData(d)
  const points = []
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

    if ('CcSsQqTtAa'.includes(command)) {
      break
    }

    i += 1
  }

  return points
}

function parsePolylinePoints(pointsRaw) {
  const nums = pointsRaw
    .trim()
    .split(/[\s,]+/)
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v))

  const points = []
  for (let i = 0; i + 1 < nums.length; i += 2) {
    points.push({ x: nums[i], y: nums[i + 1] })
  }
  return points
}

function cleanPoints(points, stats) {
  if (points.length < 2) return []

  const cleaned = [points[0]]
  for (let i = 1; i < points.length; i += 1) {
    const prev = cleaned[cleaned.length - 1]
    const curr = points[i]
    const dx = curr.x - prev.x
    const dy = curr.y - prev.y
    const dist = Math.hypot(dx, dy)

    if (dist === 0) {
      stats.zeroLengthSegments += 1
      stats.removedDuplicatePoints += 1
      continue
    }
    if (dist < 1) {
      stats.removedDuplicatePoints += 1
      continue
    }

    cleaned.push(curr)
  }

  return cleaned.length >= 2 ? cleaned : []
}

function toWkt(points) {
  return `LINESTRING(${points.map((p) => `${p.x} ${p.y}`).join(', ')})`
}

function inferType(sourceId, layerName) {
  const normalizedId = /^path\d+$/i.test(sourceId) ? '' : sourceId
  const text = `${normalizedId} ${layerName}`.toLowerCase()
  if (text.includes('bridge')) return 'bridge'
  if (text.includes('primary')) return 'primary_road'
  if (text.includes('pedestrian') || text.includes('path')) return 'pedestrian_path'
  return 'secondary_road'
}

function buildNotes(sourceId, type) {
  const notes = []
  if (sourceId) notes.push(`source_id=${sourceId}`)
  if (type !== 'bridge') notes.push('needs_bridge_check')
  return notes.join('; ')
}

function extractRoadElements(roadsLayerText) {
  const elements = []

  function extractStyle(tag) {
    const style = /\bstyle="([^"]*)"/.exec(tag)?.[1] ?? ''
    const strokeFromStyle = /(?:^|;)\s*stroke\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim() ?? ''
    const strokeAttr = /\bstroke="([^"]*)"/i.exec(tag)?.[1]?.trim() ?? ''
    const stroke = (strokeAttr || strokeFromStyle || '').toLowerCase()
    return { stroke }
  }

  const pathRegex = /<path\b[^>]*>/g
  for (const tag of roadsLayerText.match(pathRegex) ?? []) {
    const id = /\bid="([^"]*)"/.exec(tag)?.[1] ?? ''
    const d = /\bd="([^"]*)"/.exec(tag)?.[1] ?? ''
    if (d) elements.push({ tag: 'path', id, data: d, ...extractStyle(tag) })
  }

  const polylineRegex = /<polyline\b[^>]*>/g
  for (const tag of roadsLayerText.match(polylineRegex) ?? []) {
    const id = /\bid="([^"]*)"/.exec(tag)?.[1] ?? ''
    const pts = /\bpoints="([^"]*)"/.exec(tag)?.[1] ?? ''
    if (pts) elements.push({ tag: 'polyline', id, data: pts, ...extractStyle(tag) })
  }

  const lineRegex = /<line\b[^>]*>/g
  for (const tag of roadsLayerText.match(lineRegex) ?? []) {
    const id = /\bid="([^"]*)"/.exec(tag)?.[1] ?? ''
    const x1 = Number(/\bx1="([^"]*)"/.exec(tag)?.[1])
    const y1 = Number(/\by1="([^"]*)"/.exec(tag)?.[1])
    const x2 = Number(/\bx2="([^"]*)"/.exec(tag)?.[1])
    const y2 = Number(/\by2="([^"]*)"/.exec(tag)?.[1])
    if ([x1, y1, x2, y2].every((v) => Number.isFinite(v))) {
      elements.push({ tag: 'line', id, data: `${x1},${y1} ${x2},${y2}`, ...extractStyle(tag) })
    }
  }

  return elements
}

async function main() {
  const svgText = await fs.readFile(svgPath, 'utf8')
  const hasTransform = /\btransform\s*=/.test(svgText)

  const roadsLayerMatch = /<g\b[^>]*\bid="roads_manual"[^>]*>([\s\S]*?)<\/g>/.exec(svgText)
  if (!roadsLayerMatch) {
    throw new Error('roads_manual layer not found')
  }
  const roadsLayerText = roadsLayerMatch[1]
  const layerName = /inkscape:label="([^"]+)"/.exec(roadsLayerMatch[0])?.[1] ?? 'roads_manual'

  const stats = {
    zeroLengthSegments: 0,
    removedDuplicatePoints: 0,
  }

  const rows = []
  let totalVertexCount = 0
  let bridgeCount = 0
  let preferredCount = 0

  function isGreenStroke(strokeRaw) {
    const stroke = (strokeRaw ?? '').trim().toLowerCase()
    if (!stroke) return false

    const quickSet = new Set([
      '#00ff00',
      '#0f0',
      '#22c55e',
      'rgb(0,255,0)',
      'rgb(34,197,94)',
    ])
    if (quickSet.has(stroke)) return true

    const hex = stroke.startsWith('#') ? stroke.slice(1) : ''
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16)
      const g = parseInt(hex[1] + hex[1], 16)
      const b = parseInt(hex[2] + hex[2], 16)
      if ([r, g, b].every((v) => Number.isFinite(v))) {
        return g >= 200 && r <= 40 && b <= 40
      }
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16)
      const g = parseInt(hex.slice(2, 4), 16)
      const b = parseInt(hex.slice(4, 6), 16)
      if ([r, g, b].every((v) => Number.isFinite(v))) {
        return g >= 200 && r <= 40 && b <= 40
      }
    }

    const rgbMatch = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(stroke)
    if (rgbMatch) {
      const r = Number(rgbMatch[1])
      const g = Number(rgbMatch[2])
      const b = Number(rgbMatch[3])
      return g >= 200 && r <= 40 && b <= 40
    }

    return false
  }

  const elements = extractRoadElements(roadsLayerText)
  for (const [idx, el] of elements.entries()) {
    let rawPoints = []
    if (el.tag === 'path') rawPoints = parsePathToPoints(el.data)
    if (el.tag === 'polyline') rawPoints = parsePolylinePoints(el.data)
    if (el.tag === 'line') rawPoints = parsePolylinePoints(el.data)

    const points = cleanPoints(rawPoints, stats)
    if (points.length < 2) continue

    const roadId = `R${String(rows.length + 1).padStart(3, '0')}`
    const type = inferType(el.id, layerName)
    const isBridge = type === 'bridge' ? 'yes' : 'no'
    const crossesRiver = type === 'bridge' ? 'yes' : 'no'
    const isPreferred = isGreenStroke(el.stroke)
    const popularity = isPreferred ? '0.8' : '0'
    const scenicScore = isPreferred ? '0.6' : '0'
    const preferred = isPreferred ? 'yes' : 'no'
    if (type === 'bridge') bridgeCount += 1
    if (isPreferred) preferredCount += 1
    totalVertexCount += points.length

    rows.push({
      road_id: roadId,
      type,
      from_area: '',
      to_area: '',
      description: '',
      crosses_river: crossesRiver,
      is_bridge: isBridge,
      confidence: '0.75',
      preferred,
      popularity,
      scenic_score: scenicScore,
      hot_route_group: '',
      hot_route_name: '',
      notes: buildNotes(el.id, type),
      geometry_wkt: toWkt(points),
    })
  }

  const header = [
    'road_id',
    'type',
    'from_area',
    'to_area',
    'description',
    'crosses_river',
    'is_bridge',
    'confidence',
    'preferred',
    'popularity',
    'scenic_score',
    'hot_route_group',
    'hot_route_name',
    'notes',
    'geometry_wkt',
  ]

  const csv = [
    header.join(','),
    ...rows.map((row) => header.map((key) => csvEscape(row[key])).join(',')),
  ].join('\n')

  await fs.writeFile(outCsvPath, csv, 'utf8')

  const report = {
    roadCount: rows.length,
    totalVertexCount,
    bridgeCount,
    preferredCount,
    zeroLengthSegments: stats.zeroLengthSegments,
    removedDuplicatePoints: stats.removedDuplicatePoints,
    hasTransform,
  }

  console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
