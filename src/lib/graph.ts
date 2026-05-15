import { parseLineStringWkt, type Point } from './wkt'

export type GraphNode = {
  node_id: string
  x: number
  y: number
}

export type GraphEdge = {
  edge_id: string
  road_id: string
  type: string
  from_node_id: string
  to_node_id: string
  length_px: number
  is_bridge: string
  crosses_river: string
  confidence: number
  popularity: number
  preferred: boolean
  scenicScore: number
  notes: string
}

export type RoadGraph = {
  roadCount: number
  nodes: GraphNode[]
  edges: GraphEdge[]
  adjacency: Record<string, string[]>
  connectedComponentCount: number
  largestComponentNodeCount: number
}

type CsvRow = Record<string, string>

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function buildRoadGraph(rows: CsvRow[], snapTolerance = 8): RoadGraph {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const adjacencyMap = new Map<string, Set<string>>()
  const cellSize = snapTolerance
  const grid = new Map<string, string[]>()
  const nodeById = new Map<string, GraphNode>()
  const roadRows = rows.filter((row) => (row.geometry_wkt ?? '').trim().length > 0)

  function getCellKey(x: number, y: number): string {
    return `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`
  }

  function addNode(point: Point): GraphNode {
    const nodeId = `N${String(nodes.length + 1).padStart(5, '0')}`
    const node: GraphNode = { node_id: nodeId, x: point.x, y: point.y }
    nodes.push(node)
    nodeById.set(nodeId, node)
    const key = getCellKey(point.x, point.y)
    const list = grid.get(key) ?? []
    list.push(nodeId)
    grid.set(key, list)
    adjacencyMap.set(nodeId, new Set<string>())
    return node
  }

  function findOrCreateNode(point: Point): GraphNode {
    const cx = Math.floor(point.x / cellSize)
    const cy = Math.floor(point.y / cellSize)

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const key = `${cx + dx},${cy + dy}`
        const candidateIds = grid.get(key) ?? []
        for (const nodeId of candidateIds) {
          const candidate = nodeById.get(nodeId)
          if (!candidate) continue
          if (distance(point, candidate) <= snapTolerance) {
            return candidate
          }
        }
      }
    }

    return addNode(point)
  }

  for (const row of roadRows) {
    const points = parseLineStringWkt(row.geometry_wkt ?? '')
    if (points.length < 2) continue

    const confidenceValue = Number(row.confidence ?? '')
    const confidence = Number.isFinite(confidenceValue) ? confidenceValue : 0
    const popularityValue = Number(row.popularity ?? '')
    const popularity = Number.isFinite(popularityValue) ? Math.max(0, Math.min(1, popularityValue)) : 0
    const preferred = (row.preferred ?? '').trim().toLowerCase() === 'yes'
    const scenicValue = Number(row.scenic_score ?? '')
    const scenicScore = Number.isFinite(scenicValue) ? Math.max(0, Math.min(1, scenicValue)) : 0
    const notes = row.notes ?? ''

    for (let i = 1; i < points.length; i += 1) {
      const fromNode = findOrCreateNode(points[i - 1])
      const toNode = findOrCreateNode(points[i])
      if (fromNode.node_id === toNode.node_id) continue

      const edge: GraphEdge = {
        edge_id: `E${String(edges.length + 1).padStart(6, '0')}`,
        road_id: row.road_id ?? '',
        type: row.type ?? '',
        from_node_id: fromNode.node_id,
        to_node_id: toNode.node_id,
        length_px: distance(fromNode, toNode),
        is_bridge: row.is_bridge ?? 'no',
        crosses_river: row.crosses_river ?? 'no',
        confidence,
        popularity,
        preferred,
        scenicScore,
        notes,
      }
      edges.push(edge)

      const fromSet = adjacencyMap.get(fromNode.node_id) ?? new Set<string>()
      fromSet.add(toNode.node_id)
      adjacencyMap.set(fromNode.node_id, fromSet)

      const toSet = adjacencyMap.get(toNode.node_id) ?? new Set<string>()
      toSet.add(fromNode.node_id)
      adjacencyMap.set(toNode.node_id, toSet)
    }
  }

  const adjacency: Record<string, string[]> = {}
  for (const [nodeId, neighbors] of adjacencyMap) {
    adjacency[nodeId] = [...neighbors]
  }

  const visited = new Set<string>()
  let connectedComponentCount = 0
  let largestComponentNodeCount = 0

  for (const node of nodes) {
    if (visited.has(node.node_id)) continue
    connectedComponentCount += 1

    const queue = [node.node_id]
    visited.add(node.node_id)
    let size = 0

    while (queue.length > 0) {
      const current = queue.shift()
      if (!current) continue
      size += 1

      for (const neighbor of adjacency[current] ?? []) {
        if (visited.has(neighbor)) continue
        visited.add(neighbor)
        queue.push(neighbor)
      }
    }

    if (size > largestComponentNodeCount) {
      largestComponentNodeCount = size
    }
  }

  return {
    roadCount: roadRows.length,
    nodes,
    edges,
    adjacency,
    connectedComponentCount,
    largestComponentNodeCount,
  }
}
