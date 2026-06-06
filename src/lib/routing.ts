import type { RoadGraph } from './graph'

export type DijkstraResult = {
  found: boolean
  routeNodeIds: string[]
  routeEdgeIds: string[]
  totalLengthPx: number
}

export type RouteCandidate = {
  id: string
  name: string
  routeNodeIds: string[]
  routeEdgeIds: string[]
  totalLengthPx: number
  totalLengthM: number
  targetDistanceM: number
  actualDistanceM: number
  differenceM: number
  differencePercent: number
  baseRouteLengthM: number
  routeMode: 'shortest' | 'detour' | 'loop' | 'repeat' | 'over_target'
  usedLoop: boolean
  repeatedLoopCount: number
  repeatedEdgeRatio: number
  popularEdgeRatio: number
  preferredEdgeRatio: number
  scenicAverage: number
  popularityBonus: number
  qualityLabel: 'recommended' | 'acceptable' | 'poor' | 'invalid'
  score: number
  warnings: string[]
}

type QueueItem = {
  nodeId: string
  distance: number
}

type EdgeMeta = {
  edgeId: string
  length: number
  type: string
  popularity: number
  preferred: boolean
  scenicScore: number
}

type EdgeTraversalCostOptions = {
  penaltyFactor: number
  usedCount: number
}

function mergedPopularityValue(edge: { popularity?: number; preferred?: boolean; scenicScore?: number }): number {
  const popularity = Math.max(0, Math.min(1, edge.popularity ?? 0))
  const preferredAsPopular = edge.preferred ? 1 : 0
  const scenicAsPopular = Math.max(0, Math.min(1, edge.scenicScore ?? 0))
  return Math.max(popularity, preferredAsPopular, scenicAsPopular)
}

type SegmentRoute = {
  routeNodeIds: string[]
  routeEdgeIds: string[]
  totalLengthPx: number
}

type GenerateAlternativeRoutesArgs = {
  graph: RoadGraph
  startNodeId: string
  endNodeId: string
  waypointNodeId?: string
  targetDistanceM: number
  metersPerPixel: number
  maxCandidates?: number
  penaltyFactor?: number
}

const LONG_RUN_THRESHOLD_M = 4000
const SHORT_LOOP_THRESHOLD_M = 4000
const ENTRY_CANDIDATE_COUNT = 5
const MAX_PERIMETER_OVERRUN_RATIO = 1.3
const MAX_LOOP_PERIMETER_OVERRUN_RATIO = 1.1
const MAX_FILL_SHORTFALL_M = 1000
const MAX_FILL_OVERRUN_RATIO = 1.15
const MAX_FILL_REPEATED_EDGE_RATIO = 0.35
const MIN_PERIMETER_ROUTE_RATIO = 0.25
const MIN_SHORT_LOOP_UNDERRUN_RATIO = 0.85
const MAX_SHORT_LOOP_OVERRUN_RATIO = 1.2
const MAX_SHORT_LOOP_REPEATED_EDGE_RATIO = 0.3

type GenerateLoopCandidatesArgs = {
  graph: RoadGraph
  loopStartNodeId: string
  targetLoopDistanceM: number
  metersPerPixel: number
  maxCandidates: number
}

type ExtendRouteArgs = {
  graph: RoadGraph
  baseRoute: SegmentRoute
  baseRouteLengthM: number
  loopCandidates: SegmentRoute[]
  targetDistanceM: number
  metersPerPixel: number
  maxRepeatCount: number
  insertAtNodeId: string
}

function buildEdgeByPair(graph: RoadGraph): Map<string, EdgeMeta> {
  const edgeByPair = new Map<string, EdgeMeta>()
  for (const edge of graph.edges) {
    const directKey = `${edge.from_node_id}|${edge.to_node_id}`
    const reverseKey = `${edge.to_node_id}|${edge.from_node_id}`
    const meta: EdgeMeta = {
      edgeId: edge.edge_id,
      length: edge.length_px,
      type: edge.type,
      popularity: edge.popularity ?? 0,
      preferred: edge.preferred ?? false,
      scenicScore: edge.scenicScore ?? 0,
    }

    const direct = edgeByPair.get(directKey)
    if (!direct || meta.length < direct.length) edgeByPair.set(directKey, meta)

    const reverse = edgeByPair.get(reverseKey)
    if (!reverse || meta.length < reverse.length) edgeByPair.set(reverseKey, meta)
  }
  return edgeByPair
}

function edgeLengthMap(graph: RoadGraph): Map<string, number> {
  return new Map(graph.edges.map((e) => [e.edge_id, e.length_px]))
}

function perimeterEdgeRatio(graph: RoadGraph, routeEdgeIds: string[]): number {
  const edgeMap = new Map(graph.edges.map((edge) => [edge.edge_id, edge]))
  const edgeLen = edgeLengthMap(graph)
  let perimeterLen = 0
  let totalLen = 0

  for (const edgeId of routeEdgeIds) {
    const edge = edgeMap.get(edgeId)
    const len = edgeLen.get(edgeId) ?? 0
    if (!edge || len <= 0) continue
    totalLen += len
    if (edge.isPerimeter) perimeterLen += len
  }

  return totalLen > 0 ? perimeterLen / totalLen : 0
}

function uniqueRatio(edgeIds: string[]): number {
  if (edgeIds.length === 0) return 0
  const counts = new Map<string, number>()
  edgeIds.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1))
  const repeated = [...counts.values()].filter((c) => c > 1).length
  return repeated / edgeIds.length
}

function addedEdgeIds(baseRoute: SegmentRoute, route: SegmentRoute): string[] {
  const baseCounts = new Map<string, number>()
  for (const edgeId of baseRoute.routeEdgeIds) {
    baseCounts.set(edgeId, (baseCounts.get(edgeId) ?? 0) + 1)
  }

  const out: string[] = []
  for (const edgeId of route.routeEdgeIds) {
    const remaining = baseCounts.get(edgeId) ?? 0
    if (remaining > 0) {
      baseCounts.set(edgeId, remaining - 1)
    } else {
      out.push(edgeId)
    }
  }
  return out
}

function qualityFromDiff(diffPercentAbs: number): RouteCandidate['qualityLabel'] {
  if (diffPercentAbs <= 10) return 'recommended'
  if (diffPercentAbs <= 20) return 'acceptable'
  if (diffPercentAbs <= 40) return 'poor'
  return 'invalid'
}

function qualityRank(label: RouteCandidate['qualityLabel']): number {
  if (label === 'recommended') return 0
  if (label === 'acceptable') return 1
  if (label === 'poor') return 2
  return 3
}

function compareRouteCandidates(a: RouteCandidate, b: RouteCandidate): number {
  const qualityDiff = qualityRank(a.qualityLabel) - qualityRank(b.qualityLabel)
  if (qualityDiff !== 0) return qualityDiff

  const distanceDiff = Math.abs(a.differenceM) - Math.abs(b.differenceM)
  if (distanceDiff !== 0) return distanceDiff

  const repeatDiff = a.repeatedEdgeRatio - b.repeatedEdgeRatio
  if (repeatDiff !== 0) return repeatDiff

  return a.score - b.score
}

function countImmediateBacktracks(routeNodeIds: string[]): number {
  if (routeNodeIds.length < 3) return 0
  let count = 0
  for (let i = 2; i < routeNodeIds.length; i += 1) {
    if (routeNodeIds[i] === routeNodeIds[i - 2]) count += 1
  }
  return count
}

export function dijkstra(graph: RoadGraph, startNodeId: string, endNodeId: string): DijkstraResult {
  return dijkstraWithPenalties(graph, startNodeId, endNodeId, new Map(), 1)
}

export function getEdgeTraversalCost(edge: EdgeMeta, options: EdgeTraversalCostOptions): number {
  let factor = 1
  const mergedPopularity = mergedPopularityValue(edge)
  if (mergedPopularity > 0) factor *= 1 - mergedPopularity * 0.18
  factor = Math.max(0.7, factor)

  const preferredCost = edge.length * factor
  return preferredCost * (1 + options.usedCount * (options.penaltyFactor - 1))
}

function dijkstraWithPenalties(
  graph: RoadGraph,
  startNodeId: string,
  endNodeId: string,
  edgePenaltyCount: Map<string, number>,
  penaltyFactor: number,
): DijkstraResult {
  if (!startNodeId || !endNodeId) {
    return { found: false, routeNodeIds: [], routeEdgeIds: [], totalLengthPx: 0 }
  }

  if (startNodeId === endNodeId) {
    return { found: true, routeNodeIds: [startNodeId], routeEdgeIds: [], totalLengthPx: 0 }
  }

  const nodeSet = new Set(graph.nodes.map((n) => n.node_id))
  if (!nodeSet.has(startNodeId) || !nodeSet.has(endNodeId)) {
    return { found: false, routeNodeIds: [], routeEdgeIds: [], totalLengthPx: 0 }
  }

  const edgeByPair = buildEdgeByPair(graph)
  const edgeLen = edgeLengthMap(graph)

  const dist = new Map<string, number>()
  const prevNode = new Map<string, string>()
  const prevEdge = new Map<string, string>()
  const visited = new Set<string>()

  graph.nodes.forEach((node) => dist.set(node.node_id, Number.POSITIVE_INFINITY))
  dist.set(startNodeId, 0)

  const queue: QueueItem[] = [{ nodeId: startNodeId, distance: 0 }]

  while (queue.length > 0) {
    queue.sort((a, b) => a.distance - b.distance)
    const current = queue.shift()
    if (!current) break
    if (visited.has(current.nodeId)) continue
    visited.add(current.nodeId)
    if (current.nodeId === endNodeId) break

    const neighbors = graph.adjacency[current.nodeId] ?? []
    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue
      const pairKey = `${current.nodeId}|${neighbor}`
      const edgeMeta = edgeByPair.get(pairKey)
      if (!edgeMeta) continue

      const usedCount = edgePenaltyCount.get(edgeMeta.edgeId) ?? 0
      const weighted = getEdgeTraversalCost(edgeMeta, { penaltyFactor, usedCount })
      const nextDist = (dist.get(current.nodeId) ?? Number.POSITIVE_INFINITY) + weighted

      if (nextDist < (dist.get(neighbor) ?? Number.POSITIVE_INFINITY)) {
        dist.set(neighbor, nextDist)
        prevNode.set(neighbor, current.nodeId)
        prevEdge.set(neighbor, edgeMeta.edgeId)
        queue.push({ nodeId: neighbor, distance: nextDist })
      }
    }
  }

  if (!prevNode.has(endNodeId)) {
    return { found: false, routeNodeIds: [], routeEdgeIds: [], totalLengthPx: 0 }
  }

  const routeNodeIds: string[] = []
  const routeEdgeIds: string[] = []
  let cursor = endNodeId
  while (cursor !== startNodeId) {
    routeNodeIds.push(cursor)
    const edgeId = prevEdge.get(cursor)
    if (edgeId) routeEdgeIds.push(edgeId)
    const parent = prevNode.get(cursor)
    if (!parent) break
    cursor = parent
  }
  routeNodeIds.push(startNodeId)
  routeNodeIds.reverse()
  routeEdgeIds.reverse()

  const totalLengthPx = routeEdgeIds.reduce((sum, id) => sum + (edgeLen.get(id) ?? 0), 0)
  return { found: true, routeNodeIds, routeEdgeIds, totalLengthPx }
}

function generateSegmentAlternatives(
  graph: RoadGraph,
  startNodeId: string,
  endNodeId: string,
  maxCandidates: number,
  penaltyFactor: number,
): SegmentRoute[] {
  const out: SegmentRoute[] = []
  const sig = new Set<string>()
  const edgePenaltyCount = new Map<string, number>()
  const maxAttempts = Math.max(maxCandidates * 3, 6)

  for (let i = 0; i < maxAttempts && out.length < maxCandidates; i += 1) {
    const r = dijkstraWithPenalties(graph, startNodeId, endNodeId, edgePenaltyCount, penaltyFactor)
    if (!r.found || r.routeEdgeIds.length === 0) break
    const s = r.routeEdgeIds.join('|')
    if (!sig.has(s)) {
      sig.add(s)
      out.push({ routeNodeIds: r.routeNodeIds, routeEdgeIds: r.routeEdgeIds, totalLengthPx: r.totalLengthPx })
    }
    r.routeEdgeIds.forEach((edgeId) => edgePenaltyCount.set(edgeId, (edgePenaltyCount.get(edgeId) ?? 0) + 1))
  }
  return out
}

function buildSubPathToNode(route: SegmentRoute, nodeId: string): SegmentRoute | null {
  const idx = route.routeNodeIds.indexOf(nodeId)
  if (idx < 0) return null
  if (idx === 0) return { routeNodeIds: [route.routeNodeIds[0]], routeEdgeIds: [], totalLengthPx: 0 }

  const edgeLen = route.routeEdgeIds.length
  const subEdgeIds = route.routeEdgeIds.slice(0, Math.min(idx, edgeLen))
  const subNodeIds = route.routeNodeIds.slice(0, idx + 1)
  return { routeNodeIds: subNodeIds, routeEdgeIds: subEdgeIds, totalLengthPx: 0 }
}

function buildSubPathFromNode(route: SegmentRoute, nodeId: string): SegmentRoute | null {
  const idx = route.routeNodeIds.indexOf(nodeId)
  if (idx < 0) return null
  if (idx >= route.routeNodeIds.length - 1) {
    return { routeNodeIds: [route.routeNodeIds[route.routeNodeIds.length - 1]], routeEdgeIds: [], totalLengthPx: 0 }
  }

  const subNodeIds = route.routeNodeIds.slice(idx)
  const subEdgeIds = route.routeEdgeIds.slice(idx)
  return { routeNodeIds: subNodeIds, routeEdgeIds: subEdgeIds, totalLengthPx: 0 }
}

export function generateLoopCandidates({
  graph,
  loopStartNodeId,
  targetLoopDistanceM,
  metersPerPixel,
  maxCandidates,
}: GenerateLoopCandidatesArgs): SegmentRoute[] {
  if (!loopStartNodeId || targetLoopDistanceM <= 0) return []

  const targetLoopPx = targetLoopDistanceM / metersPerPixel
  const startNode = graph.nodes.find((n) => n.node_id === loopStartNodeId)
  if (!startNode) return []

  const nodeCandidates = graph.nodes
    .map((n) => ({
      nodeId: n.node_id,
      d: Math.hypot(n.x - startNode.x, n.y - startNode.y),
    }))
    .filter((n) => n.nodeId !== loopStartNodeId)
    .sort((a, b) => Math.abs(a.d - targetLoopPx / 2) - Math.abs(b.d - targetLoopPx / 2))
    .slice(0, 60)

  const loops: SegmentRoute[] = []
  const signatures = new Set<string>()

  for (const mid of nodeCandidates) {
    const first = dijkstra(graph, loopStartNodeId, mid.nodeId)
    if (!first.found || first.routeEdgeIds.length === 0) continue

    const penalty = new Map<string, number>()
    first.routeEdgeIds.forEach((id) => penalty.set(id, 2))

    const second = dijkstraWithPenalties(graph, mid.nodeId, loopStartNodeId, penalty, 1.6)
    if (!second.found || second.routeEdgeIds.length === 0) continue

    const routeNodeIds = [...first.routeNodeIds, ...second.routeNodeIds.slice(1)]
    const routeEdgeIds = [...first.routeEdgeIds, ...second.routeEdgeIds]
    const signature = routeEdgeIds.join('|')
    if (signatures.has(signature)) continue
    signatures.add(signature)

    loops.push({
      routeNodeIds,
      routeEdgeIds,
      totalLengthPx: first.totalLengthPx + second.totalLengthPx,
    })

    if (loops.length >= maxCandidates) break
  }

  return loops
}

export function extendRouteWithRepeatedLoops({
  graph,
  baseRoute,
  baseRouteLengthM,
  loopCandidates,
  targetDistanceM,
  metersPerPixel,
  maxRepeatCount,
  insertAtNodeId,
}: ExtendRouteArgs): SegmentRoute[] {
  const out: SegmentRoute[] = []

  if (loopCandidates.length === 0) return out

  const remainingDistanceM = targetDistanceM - baseRouteLengthM
  const edgeLenMap = edgeLengthMap(graph)

  const baseStartNode = baseRoute.routeNodeIds[0]
  if (!baseStartNode) return out

  const prefix = buildSubPathToNode(baseRoute, insertAtNodeId)
  const suffix = buildSubPathFromNode(baseRoute, insertAtNodeId)
  if (!prefix || !suffix) return out

  for (const loop of loopCandidates) {
    if (loop.routeNodeIds[0] !== insertAtNodeId) continue
    if (loop.routeNodeIds[loop.routeNodeIds.length - 1] !== insertAtNodeId) continue

    const loopLengthM = loop.totalLengthPx * metersPerPixel
    if (loopLengthM <= 0) continue

    const rough = remainingDistanceM / loopLengthM
    const ks = [Math.ceil(rough), Math.ceil(rough) + 1, Math.ceil(rough) + 2]

    for (const kRaw of ks) {
      const k = Math.max(1, Math.min(maxRepeatCount, kRaw))
      const repeatedRouteNodeIds: string[] = [...prefix.routeNodeIds]
      const repeatedRouteEdgeIds: string[] = [...prefix.routeEdgeIds]
      let totalLengthPx = 0

      for (let i = 0; i < k; i += 1) {
        repeatedRouteNodeIds.push(...loop.routeNodeIds.slice(1))
        repeatedRouteEdgeIds.push(...loop.routeEdgeIds)
      }

      repeatedRouteNodeIds.push(...suffix.routeNodeIds.slice(1))
      repeatedRouteEdgeIds.push(...suffix.routeEdgeIds)
      totalLengthPx = repeatedRouteEdgeIds.reduce((sum, id) => sum + (edgeLenMap.get(id) ?? 0), 0)

      const totalLengthM = totalLengthPx * metersPerPixel
      if (totalLengthM < targetDistanceM) continue

      out.push({
        routeNodeIds: repeatedRouteNodeIds,
        routeEdgeIds: repeatedRouteEdgeIds,
        totalLengthPx,
      })
    }
  }

  const dedup = new Map<string, SegmentRoute>()
  for (const route of out) {
    const key = route.routeEdgeIds.join('|')
    if (!dedup.has(key)) dedup.set(key, route)
  }
  return [...dedup.values()]
}

function buildPerimeterCycle(graph: RoadGraph): SegmentRoute | null {
  const perimeterEdges = graph.edges.filter((e) => e.isPerimeter)
  if (perimeterEdges.length < 3) return null

  const adj = new Map<string, string[]>()
  for (const edge of perimeterEdges) {
    const a = adj.get(edge.from_node_id) ?? []
    a.push(edge.to_node_id)
    adj.set(edge.from_node_id, a)
    const b = adj.get(edge.to_node_id) ?? []
    b.push(edge.from_node_id)
    adj.set(edge.to_node_id, b)
  }

  for (const [, neighbors] of adj) {
    if (neighbors.length !== 2) return null
  }

  const startId = perimeterEdges[0].from_node_id
  const openCycleNodeIds: string[] = [startId]
  const routeEdgeIds: string[] = []
  let prev = startId
  let cur = adj.get(startId)![0]

  while (cur !== startId) {
    openCycleNodeIds.push(cur)
    const neighbors = adj.get(cur)!
    const next = neighbors[0] === prev ? neighbors[1] : neighbors[0]
    prev = cur
    cur = next
  }

  const edgeByPair = new Map<string, string>()
  for (const edge of graph.edges) {
    edgeByPair.set(`${edge.from_node_id}|${edge.to_node_id}`, edge.edge_id)
  }

  for (let i = 0; i < openCycleNodeIds.length; i++) {
    const from = openCycleNodeIds[i]
    const to = openCycleNodeIds[(i + 1) % openCycleNodeIds.length]
    const edgeId = edgeByPair.get(`${from}|${to}`) ?? edgeByPair.get(`${to}|${from}`)
    if (!edgeId) return null
    routeEdgeIds.push(edgeId)
  }

  const edgeLen = edgeLengthMap(graph)
  const totalLengthPx = routeEdgeIds.reduce((s, id) => s + (edgeLen.get(id) ?? 0), 0)

  return { routeNodeIds: [...openCycleNodeIds, startId], routeEdgeIds, totalLengthPx }
}

function rotateCycleToStart(cycle: SegmentRoute, targetStart: string): SegmentRoute {
  const isClosed = cycle.routeNodeIds[0] === cycle.routeNodeIds[cycle.routeNodeIds.length - 1]
  const openNodeIds = isClosed ? cycle.routeNodeIds.slice(0, -1) : cycle.routeNodeIds
  const idx = openNodeIds.indexOf(targetStart)
  if (idx < 0) return cycle

  const rotatedOpenNodeIds = [...openNodeIds.slice(idx), ...openNodeIds.slice(0, idx)]
  return {
    routeNodeIds: [...rotatedOpenNodeIds, targetStart],
    routeEdgeIds: [...cycle.routeEdgeIds.slice(idx), ...cycle.routeEdgeIds.slice(0, idx)],
    totalLengthPx: cycle.totalLengthPx,
  }
}

function findBestPerimeterEntry(
  graph: RoadGraph,
  startNodeId: string,
  perimeterNodeIds: string[],
): DijkstraResult | null {
  const paths = findPerimeterAccessPaths(graph, startNodeId, perimeterNodeIds, ENTRY_CANDIDATE_COUNT)
  return paths[0] ?? null
}

function findPerimeterAccessPaths(
  graph: RoadGraph,
  startNodeId: string,
  perimeterNodeIds: string[],
  maxCandidates: number,
): DijkstraResult[] {
  const startNode = graph.nodes.find((node) => node.node_id === startNodeId)
  if (!startNode) return []

  const nodeById = new Map(graph.nodes.map((node) => [node.node_id, node]))
  const entryCandidates = perimeterNodeIds
    .filter((nodeId, idx, arr) => arr.indexOf(nodeId) === idx)
    .map((nodeId) => {
      const node = nodeById.get(nodeId)
      if (!node) return null
      return {
        nodeId,
        distancePx: Math.hypot(node.x - startNode.x, node.y - startNode.y),
      }
    })
    .filter((candidate): candidate is { nodeId: string; distancePx: number } => !!candidate)
    .sort((a, b) => a.distancePx - b.distancePx)
    .slice(0, maxCandidates)

  const paths: DijkstraResult[] = []
  for (const candidate of entryCandidates) {
    const path = dijkstra(graph, startNodeId, candidate.nodeId)
    if (!path.found) continue
    paths.push(path)
  }

  return paths.sort((a, b) => a.totalLengthPx - b.totalLengthPx)
}

function reversePath(path: DijkstraResult): DijkstraResult {
  return {
    found: path.found,
    routeNodeIds: [...path.routeNodeIds].reverse(),
    routeEdgeIds: [...path.routeEdgeIds].reverse(),
    totalLengthPx: path.totalLengthPx,
  }
}

function buildCycleTravel(
  graph: RoadGraph,
  cycle: SegmentRoute,
  entryNodeId: string,
  exitNodeId: string,
  forward: boolean,
  fullLoopCount: number,
): SegmentRoute | null {
  const openNodeIds = cycle.routeNodeIds[0] === cycle.routeNodeIds[cycle.routeNodeIds.length - 1]
    ? cycle.routeNodeIds.slice(0, -1)
    : cycle.routeNodeIds
  const n = openNodeIds.length
  const entryIdx = openNodeIds.indexOf(entryNodeId)
  const exitIdx = openNodeIds.indexOf(exitNodeId)
  if (n < 3 || entryIdx < 0 || exitIdx < 0) return null

  const edgeByPair = new Map<string, string>()
  for (let i = 0; i < n; i += 1) {
    const from = openNodeIds[i]
    const to = openNodeIds[(i + 1) % n]
    const edgeId = cycle.routeEdgeIds[i]
    if (!edgeId) return null
    edgeByPair.set(`${from}|${to}`, edgeId)
    edgeByPair.set(`${to}|${from}`, edgeId)
  }

  const routeNodeIds: string[] = [entryNodeId]
  const routeEdgeIds: string[] = []
  let idx = entryIdx

  function appendStep(): boolean {
    const nextIdx = forward ? (idx + 1) % n : (idx - 1 + n) % n
    const from = openNodeIds[idx]
    const to = openNodeIds[nextIdx]
    const edgeId = edgeByPair.get(`${from}|${to}`)
    if (!edgeId) return false
    routeEdgeIds.push(edgeId)
    routeNodeIds.push(to)
    idx = nextIdx
    return true
  }

  for (let loop = 0; loop < fullLoopCount; loop += 1) {
    for (let step = 0; step < n; step += 1) {
      if (!appendStep()) return null
    }
  }

  let guard = 0
  while (idx !== exitIdx) {
    if (!appendStep()) return null
    guard += 1
    if (guard > n) return null
  }

  const edgeLen = edgeLengthMap(graph)
  const totalLengthPx = routeEdgeIds.reduce((sum, id) => sum + (edgeLen.get(id) ?? 0), 0)
  return { routeNodeIds, routeEdgeIds, totalLengthPx }
}

function toCandidate(
  graph: RoadGraph,
  route: SegmentRoute,
  id: string,
  name: string,
  targetDistanceM: number,
  baseRouteLengthM: number,
  metersPerPixel: number,
  routeMode: RouteCandidate['routeMode'],
  usedLoop: boolean,
  repeatedLoopCount: number,
  extraWarnings: string[] = [],
): RouteCandidate {
  const actualDistanceM = route.totalLengthPx * metersPerPixel
  const differenceM = actualDistanceM - targetDistanceM
  const differencePercent = (differenceM / targetDistanceM) * 100
  const diffAbs = Math.abs(differencePercent)
  const repeatedEdgeRatio = uniqueRatio(route.routeEdgeIds)
  const immediateBacktrackCount = countImmediateBacktracks(route.routeNodeIds)
  const qualityLabel = qualityFromDiff(diffAbs)

  const edgeMap = new Map(graph.edges.map((e) => [e.edge_id, e]))
  const edgeLenMap = edgeLengthMap(graph)
  let perimeterPopularLen = 0
  let internalPopularLen = 0
  let totalLen = 0
  for (const edgeId of route.routeEdgeIds) {
    const edge = edgeMap.get(edgeId)
    const len = edgeLenMap.get(edgeId) ?? 0
    if (!edge || len <= 0) continue
    totalLen += len
    if (mergedPopularityValue(edge) > 0) {
      if (edge.isPerimeter) {
        perimeterPopularLen += len
      } else {
        internalPopularLen += len
      }
    }
  }

  const popularEdgeRatio = totalLen > 0 ? (perimeterPopularLen + internalPopularLen) / totalLen : 0
  const perimeterPopularRatio = totalLen > 0 ? perimeterPopularLen / totalLen : 0
  const internalPopularRatio = totalLen > 0 ? internalPopularLen / totalLen : 0
  const preferredEdgeRatio = 0
  const scenicAverage = 0
  const popularityBonus = popularEdgeRatio * 18

  const distanceErrorRatio = Math.abs(actualDistanceM - targetDistanceM) / targetDistanceM
  const qualityPenalty =
    qualityLabel === 'recommended' ? 0 : qualityLabel === 'acceptable' ? 80 : qualityLabel === 'poor' ? 250 : 800
  const perimeterMultiplier = targetDistanceM > 4000 ? 120 : 40
  const internalMultiplier = targetDistanceM > 4000 ? 40 : 120
  const score =
    distanceErrorRatio * 700 +
    qualityPenalty +
    repeatedEdgeRatio * 25 -
    perimeterPopularRatio * perimeterMultiplier -
    internalPopularRatio * internalMultiplier +
    immediateBacktrackCount * 50

  const warnings = [...extraWarnings]
  if (usedLoop) warnings.push('包含重复路段，用于匹配目标距离。')
  if (immediateBacktrackCount > 0) warnings.push('包含连续折返路段。')

  return {
    id,
    name,
    routeNodeIds: route.routeNodeIds,
    routeEdgeIds: route.routeEdgeIds,
    totalLengthPx: route.totalLengthPx,
    totalLengthM: actualDistanceM,
    targetDistanceM,
    actualDistanceM,
    differenceM,
    differencePercent,
    baseRouteLengthM,
    routeMode,
    usedLoop,
    repeatedLoopCount,
    repeatedEdgeRatio,
    popularEdgeRatio,
    preferredEdgeRatio,
    scenicAverage,
    popularityBonus,
    qualityLabel,
    score,
    warnings,
  }
}

function isAcceptableShortLoopCandidate(candidate: RouteCandidate): boolean {
  return (
    candidate.actualDistanceM >= candidate.targetDistanceM * MIN_SHORT_LOOP_UNDERRUN_RATIO &&
    candidate.actualDistanceM <= candidate.targetDistanceM * MAX_SHORT_LOOP_OVERRUN_RATIO &&
    candidate.repeatedEdgeRatio <= MAX_SHORT_LOOP_REPEATED_EDGE_RATIO &&
    candidate.qualityLabel !== 'invalid' &&
    countImmediateBacktracks(candidate.routeNodeIds) === 0
  )
}

function generateShortLoopRoutes({
  graph,
  startNodeId,
  targetDistanceM,
  metersPerPixel,
  maxCandidates,
}: {
  graph: RoadGraph
  startNodeId: string
  targetDistanceM: number
  metersPerPixel: number
  maxCandidates: number
}): RouteCandidate[] {
  const loopCandidates = generateLoopCandidates({
    graph,
    loopStartNodeId: startNodeId,
    targetLoopDistanceM: targetDistanceM,
    metersPerPixel,
    maxCandidates: Math.max(maxCandidates * 3, 12),
  })

  const candidates = loopCandidates
    .map((route, idx) =>
      toCandidate(
        graph,
        route,
        `SHORT_${String(idx + 1).padStart(3, '0')}`,
        `短距离环线 ${idx + 1}`,
        targetDistanceM,
        0,
        metersPerPixel,
        'loop',
        false,
        0,
      ),
    )
    .filter(isAcceptableShortLoopCandidate)
    .sort(compareRouteCandidates)

  return candidates.slice(0, maxCandidates)
}

function generateDistanceFillRoutes({
  graph,
  baseRoute,
  baseRouteLengthM,
  targetDistanceM,
  metersPerPixel,
  insertAtNodeIds,
}: {
  graph: RoadGraph
  baseRoute: SegmentRoute
  baseRouteLengthM: number
  targetDistanceM: number
  metersPerPixel: number
  insertAtNodeIds: string[]
}): SegmentRoute[] {
  const shortfallM = targetDistanceM - baseRouteLengthM
  if (shortfallM <= 100 || shortfallM > MAX_FILL_SHORTFALL_M) return []

  const out: SegmentRoute[] = []
  const seen = new Set<string>()
  const targetLoopDistanceM = shortfallM <= 600 ? shortfallM : Math.min(shortfallM, 900)

  for (const insertAtNodeId of insertAtNodeIds.filter((v, idx, arr) => arr.indexOf(v) === idx)) {
    const loopCandidates = generateLoopCandidates({
      graph,
      loopStartNodeId: insertAtNodeId,
      targetLoopDistanceM,
      metersPerPixel,
      maxCandidates: shortfallM <= 600 ? 3 : 4,
    })
    const extended = extendRouteWithRepeatedLoops({
      graph,
      baseRoute,
      baseRouteLengthM,
      loopCandidates,
      targetDistanceM,
      metersPerPixel,
      maxRepeatCount: 1,
      insertAtNodeId,
    })

    for (const route of extended) {
      const totalLengthM = route.totalLengthPx * metersPerPixel
      if (totalLengthM > targetDistanceM * MAX_FILL_OVERRUN_RATIO) continue

      const diffPercentAbs = Math.abs((totalLengthM - targetDistanceM) / targetDistanceM) * 100
      if (qualityFromDiff(diffPercentAbs) === 'invalid') continue
      if (countImmediateBacktracks(route.routeNodeIds) > 0) continue

      const fillEdgeIds = addedEdgeIds(baseRoute, route)
      if (fillEdgeIds.length > 0 && uniqueRatio(fillEdgeIds) > MAX_FILL_REPEATED_EDGE_RATIO) continue

      const key = route.routeEdgeIds.join('|')
      if (seen.has(key)) continue
      seen.add(key)
      out.push(route)
    }
  }

  return out
}

function generatePerimeterFirstLoopRoutes({
  graph,
  startNodeId,
  targetDistanceM,
  metersPerPixel,
  maxCandidates,
}: {
  graph: RoadGraph
  startNodeId: string
  targetDistanceM: number
  metersPerPixel: number
  maxCandidates: number
}): RouteCandidate[] {
  const rawCycle = buildPerimeterCycle(graph)
  if (!rawCycle || rawCycle.totalLengthPx <= 0) return []

  const cycleLenM = rawCycle.totalLengthPx * metersPerPixel
  if (cycleLenM <= 0) return []

  let entryNodeId: string
  let approachPath: DijkstraResult = { found: true, routeNodeIds: [startNodeId], routeEdgeIds: [], totalLengthPx: 0 }

  if (rawCycle.routeNodeIds.includes(startNodeId)) {
    entryNodeId = startNodeId
  } else {
    const path = findBestPerimeterEntry(graph, startNodeId, rawCycle.routeNodeIds.slice(0, -1))
    if (!path) return []
    entryNodeId = path.routeNodeIds[path.routeNodeIds.length - 1]
    approachPath = path
  }

  const perimeterCycle = rotateCycleToStart(rawCycle, entryNodeId)
  const approachTotalM = approachPath.totalLengthPx * metersPerPixel * 2
  const availableForPerimeterM = targetDistanceM - approachTotalM
  if (availableForPerimeterM <= 0) return []

  const appNodes = approachPath.routeNodeIds
  const appEdgeIds = approachPath.routeEdgeIds
  const revAppNodes = [...appNodes].reverse()
  const revAppEdgeIds = [...appEdgeIds].reverse()
  const pNodes = perimeterCycle.routeNodeIds
  const pEdgeIds = perimeterCycle.routeEdgeIds
  const edgeLen = edgeLengthMap(graph)

  function buildPerimeterRoute(loopCount: number): SegmentRoute {
    const routeNodeIds: string[] = [...appNodes]
    const routeEdgeIds: string[] = [...appEdgeIds]
    for (let i = 0; i < loopCount; i += 1) {
      routeNodeIds.push(...pNodes.slice(1))
      routeEdgeIds.push(...pEdgeIds)
    }
    routeNodeIds.push(...revAppNodes.slice(1))
    routeEdgeIds.push(...revAppEdgeIds)
    const totalLengthPx = routeEdgeIds.reduce((sum, id) => sum + (edgeLen.get(id) ?? 0), 0)
    return { routeNodeIds, routeEdgeIds, totalLengthPx }
  }

  const baseCycleCount = Math.max(1, Math.floor(availableForPerimeterM / cycleLenM))
  const cycleCounts = [baseCycleCount, baseCycleCount + 1].filter((value, idx, arr) => arr.indexOf(value) === idx)
  const candidates: RouteCandidate[] = []
  const seen = new Set<string>()
  let candidateIndex = 1

  for (const cycleCount of cycleCounts) {
    const route = buildPerimeterRoute(cycleCount)
    const routeLengthM = route.totalLengthPx * metersPerPixel
    if (routeLengthM > targetDistanceM * MAX_LOOP_PERIMETER_OVERRUN_RATIO) continue
    const routeKey = route.routeEdgeIds.join('|')
    if (seen.has(routeKey)) continue
    seen.add(routeKey)
    candidates.push(
      toCandidate(
        graph,
        route,
        `PERIM_${String(candidateIndex).padStart(3, '0')}`,
        cycleCount === baseCycleCount ? 'Perimeter Loop' : 'Perimeter Extended Loop',
        targetDistanceM,
        routeLengthM,
        metersPerPixel,
        'loop',
        cycleCount > 1,
        cycleCount,
      ),
    )
    candidateIndex += 1

    const fillRoutes = generateDistanceFillRoutes({
      graph,
      baseRoute: route,
      baseRouteLengthM: routeLengthM,
      targetDistanceM,
      metersPerPixel,
      insertAtNodeIds: [entryNodeId, startNodeId],
    })

    for (const fillRoute of fillRoutes) {
      const fillLengthM = fillRoute.totalLengthPx * metersPerPixel
      if (fillLengthM > targetDistanceM * MAX_LOOP_PERIMETER_OVERRUN_RATIO) continue
      const fillKey = fillRoute.routeEdgeIds.join('|')
      if (seen.has(fillKey)) continue
      seen.add(fillKey)
      candidates.push(
        toCandidate(
          graph,
          fillRoute,
          `PERIM_${String(candidateIndex).padStart(3, '0')}`,
          'Perimeter + Distance Fill',
          targetDistanceM,
          routeLengthM,
          metersPerPixel,
          'loop',
          true,
          cycleCount,
        ),
      )
      candidateIndex += 1
    }
  }

  const accessPaths = findPerimeterAccessPaths(graph, startNodeId, rawCycle.routeNodeIds.slice(0, -1), ENTRY_CANDIDATE_COUNT)
  if (accessPaths.length === 0) accessPaths.push(approachPath)

  for (const entryPath of accessPaths) {
    const segmentEntryNodeId = entryPath.routeNodeIds[entryPath.routeNodeIds.length - 1]
    for (const exitAccessPath of accessPaths) {
      const segmentExitNodeId = exitAccessPath.routeNodeIds[exitAccessPath.routeNodeIds.length - 1]
      const exitToStartPath = reversePath(exitAccessPath)

      for (const forward of [true, false]) {
        const baseTravel = buildCycleTravel(graph, rawCycle, segmentEntryNodeId, segmentExitNodeId, forward, 0)
        if (!baseTravel) continue

        const baseLengthM = (entryPath.totalLengthPx + baseTravel.totalLengthPx + exitToStartPath.totalLengthPx) * metersPerPixel
        const remainingM = targetDistanceM - baseLengthM
        const baseFullLoopCount = Math.max(0, Math.floor(remainingM / cycleLenM))
        const segmentLoopCounts = [baseFullLoopCount, baseFullLoopCount + 1].filter((value, idx, arr) => arr.indexOf(value) === idx)

        for (const fullLoopCount of segmentLoopCounts) {
          const perimeterTravel = buildCycleTravel(graph, rawCycle, segmentEntryNodeId, segmentExitNodeId, forward, fullLoopCount)
          if (!perimeterTravel) continue

          const routeNodeIds = [
            ...entryPath.routeNodeIds,
            ...perimeterTravel.routeNodeIds.slice(1),
            ...exitToStartPath.routeNodeIds.slice(1),
          ]
          const routeEdgeIds = [
            ...entryPath.routeEdgeIds,
            ...perimeterTravel.routeEdgeIds,
            ...exitToStartPath.routeEdgeIds,
          ]
          const routeKey = routeEdgeIds.join('|')
          if (seen.has(routeKey)) continue

          const totalLengthPx = routeEdgeIds.reduce((sum, id) => sum + (edgeLen.get(id) ?? 0), 0)
          const routeLengthM = totalLengthPx * metersPerPixel
          if (routeLengthM > targetDistanceM * MAX_LOOP_PERIMETER_OVERRUN_RATIO) continue
          if (perimeterEdgeRatio(graph, routeEdgeIds) < MIN_PERIMETER_ROUTE_RATIO) continue

          seen.add(routeKey)
          candidates.push(
            toCandidate(
              graph,
              { routeNodeIds, routeEdgeIds, totalLengthPx },
              `PERIM_SEG_${String(candidateIndex).padStart(3, '0')}`,
              'Perimeter Segment Loop',
              targetDistanceM,
              routeLengthM,
              metersPerPixel,
              'loop',
              fullLoopCount > 0,
              fullLoopCount,
            ),
          )
          candidateIndex += 1
        }
      }
    }
  }

  const notShort = candidates.filter((candidate) => candidate.actualDistanceM >= candidate.targetDistanceM)
  notShort.sort(compareRouteCandidates)
  const validFirst = notShort.filter((candidate) => candidate.qualityLabel !== 'invalid')
  const invalidRest = notShort.filter((candidate) => candidate.qualityLabel === 'invalid')
  if (validFirst.length === 0 && invalidRest.length === 0) {
    return candidates
      .filter((candidate) => candidate.actualDistanceM >= candidate.targetDistanceM * MIN_SHORT_LOOP_UNDERRUN_RATIO)
      .sort(compareRouteCandidates)
      .slice(0, maxCandidates)
      .map((candidate) => ({ ...candidate, warnings: [...candidate.warnings, 'under_target_fallback'] }))
  }
  return [...validFirst, ...invalidRest].slice(0, maxCandidates)
}

function generatePerimeterFirstPointToPointRoutes({
  graph,
  startNodeId,
  endNodeId,
  targetDistanceM,
  metersPerPixel,
  maxCandidates,
}: {
  graph: RoadGraph
  startNodeId: string
  endNodeId: string
  targetDistanceM: number
  metersPerPixel: number
  maxCandidates: number
}): RouteCandidate[] {
  const rawCycle = buildPerimeterCycle(graph)
  if (!rawCycle || rawCycle.totalLengthPx <= 0) return []

  const cycleLenM = rawCycle.totalLengthPx * metersPerPixel
  if (cycleLenM <= 0) return []

  const perimeterNodeIds = rawCycle.routeNodeIds.slice(0, -1)
  const startAccessPaths = findPerimeterAccessPaths(graph, startNodeId, perimeterNodeIds, ENTRY_CANDIDATE_COUNT)
  const endAccessPaths = findPerimeterAccessPaths(graph, endNodeId, perimeterNodeIds, ENTRY_CANDIDATE_COUNT)
  if (startAccessPaths.length === 0 || endAccessPaths.length === 0) return []

  const candidates: RouteCandidate[] = []
  const seen = new Set<string>()
  let candidateIndex = 1

  for (const startAccessPath of startAccessPaths) {
    const entryNodeId = startAccessPath.routeNodeIds[startAccessPath.routeNodeIds.length - 1]
    for (const endAccessPath of endAccessPaths) {
      const exitNodeId = endAccessPath.routeNodeIds[endAccessPath.routeNodeIds.length - 1]
      const exitToEndPath = reversePath(endAccessPath)

      for (const forward of [true, false]) {
        const baseTravel = buildCycleTravel(graph, rawCycle, entryNodeId, exitNodeId, forward, 0)
        if (!baseTravel) continue

        const baseLengthM = (startAccessPath.totalLengthPx + baseTravel.totalLengthPx + exitToEndPath.totalLengthPx) * metersPerPixel
        const remainingM = targetDistanceM - baseLengthM
        const baseLoopCount = Math.max(0, Math.floor(remainingM / cycleLenM))
        const loopCounts = [baseLoopCount, baseLoopCount + 1].filter((value, idx, arr) => arr.indexOf(value) === idx)

        for (const fullLoopCount of loopCounts) {
          const perimeterTravel = buildCycleTravel(graph, rawCycle, entryNodeId, exitNodeId, forward, fullLoopCount)
          if (!perimeterTravel) continue

          const routeNodeIds = [
            ...startAccessPath.routeNodeIds,
            ...perimeterTravel.routeNodeIds.slice(1),
            ...exitToEndPath.routeNodeIds.slice(1),
          ]
          const routeEdgeIds = [
            ...startAccessPath.routeEdgeIds,
            ...perimeterTravel.routeEdgeIds,
            ...exitToEndPath.routeEdgeIds,
          ]
          const edgeLen = edgeLengthMap(graph)
          const totalLengthPx = routeEdgeIds.reduce((sum, id) => sum + (edgeLen.get(id) ?? 0), 0)
          const routeLengthM = totalLengthPx * metersPerPixel
          if (routeLengthM > targetDistanceM * MAX_PERIMETER_OVERRUN_RATIO) continue
          const routePerimeterRatio = perimeterEdgeRatio(graph, routeEdgeIds)
          if (routePerimeterRatio < MIN_PERIMETER_ROUTE_RATIO) continue

          const route: SegmentRoute = { routeNodeIds, routeEdgeIds, totalLengthPx }
          const key = routeEdgeIds.join('|')
          if (!seen.has(key)) {
            seen.add(key)
            candidates.push(
              toCandidate(
                graph,
                route,
                `PERIM_PT_${String(candidateIndex).padStart(3, '0')}`,
                fullLoopCount > baseLoopCount ? 'Perimeter Extended Route' : 'Perimeter Through Route',
                targetDistanceM,
                routeLengthM,
                metersPerPixel,
                'detour',
                fullLoopCount > 0,
                fullLoopCount,
              ),
            )
            candidateIndex += 1
          }

          const fillRoutes = generateDistanceFillRoutes({
            graph,
            baseRoute: route,
            baseRouteLengthM: routeLengthM,
            targetDistanceM,
            metersPerPixel,
            insertAtNodeIds: [entryNodeId, exitNodeId],
          })
          for (const fillRoute of fillRoutes) {
            const fillLengthM = fillRoute.totalLengthPx * metersPerPixel
            if (fillLengthM > targetDistanceM * MAX_PERIMETER_OVERRUN_RATIO) continue
            const fillPerimeterRatio = perimeterEdgeRatio(graph, fillRoute.routeEdgeIds)
            if (fillPerimeterRatio < MIN_PERIMETER_ROUTE_RATIO) continue
            const fillKey = fillRoute.routeEdgeIds.join('|')
            if (seen.has(fillKey)) continue
            seen.add(fillKey)
            candidates.push(
              toCandidate(
                graph,
                fillRoute,
                `PERIM_PT_${String(candidateIndex).padStart(3, '0')}`,
                'Perimeter Through + Distance Fill',
                targetDistanceM,
                routeLengthM,
                metersPerPixel,
                'detour',
                true,
                fullLoopCount,
              ),
            )
            candidateIndex += 1
          }
        }
      }
    }
  }

  const notShort = candidates.filter((candidate) => candidate.actualDistanceM >= candidate.targetDistanceM)
  notShort.sort(compareRouteCandidates)
  const validFirst = notShort.filter((candidate) => candidate.qualityLabel !== 'invalid')
  const invalidRest = notShort.filter((candidate) => candidate.qualityLabel === 'invalid')
  return [...validFirst, ...invalidRest].slice(0, maxCandidates)
}

function generatePerimeterFirstWaypointRoutes({
  graph,
  startNodeId,
  waypointNodeId,
  endNodeId,
  targetDistanceM,
  metersPerPixel,
  maxCandidates,
}: {
  graph: RoadGraph
  startNodeId: string
  waypointNodeId: string
  endNodeId: string
  targetDistanceM: number
  metersPerPixel: number
  maxCandidates: number
}): RouteCandidate[] {
  const rawCycle = buildPerimeterCycle(graph)
  if (!rawCycle || rawCycle.totalLengthPx <= 0) return []

  const startToWaypointPath = dijkstra(graph, startNodeId, waypointNodeId)
  if (!startToWaypointPath.found) return []

  const cycleLenM = rawCycle.totalLengthPx * metersPerPixel
  if (cycleLenM <= 0) return []

  const perimeterNodeIds = rawCycle.routeNodeIds.slice(0, -1)
  const waypointAccessPaths = findPerimeterAccessPaths(graph, waypointNodeId, perimeterNodeIds, ENTRY_CANDIDATE_COUNT)
  const endAccessPaths = findPerimeterAccessPaths(graph, endNodeId, perimeterNodeIds, ENTRY_CANDIDATE_COUNT)
  if (waypointAccessPaths.length === 0 || endAccessPaths.length === 0) return []

  const candidates: RouteCandidate[] = []
  const seen = new Set<string>()
  let candidateIndex = 1

  for (const waypointAccessPath of waypointAccessPaths) {
    const entryNodeId = waypointAccessPath.routeNodeIds[waypointAccessPath.routeNodeIds.length - 1]
    for (const endAccessPath of endAccessPaths) {
      const exitNodeId = endAccessPath.routeNodeIds[endAccessPath.routeNodeIds.length - 1]
      const exitToEndPath = reversePath(endAccessPath)

      for (const forward of [true, false]) {
        const baseTravel = buildCycleTravel(graph, rawCycle, entryNodeId, exitNodeId, forward, 0)
        if (!baseTravel) continue

        const baseLengthM = (
          startToWaypointPath.totalLengthPx +
          waypointAccessPath.totalLengthPx +
          baseTravel.totalLengthPx +
          exitToEndPath.totalLengthPx
        ) * metersPerPixel
        const remainingM = targetDistanceM - baseLengthM
        const baseLoopCount = Math.max(0, Math.floor(remainingM / cycleLenM))
        const loopCounts = [baseLoopCount, baseLoopCount + 1].filter((value, idx, arr) => arr.indexOf(value) === idx)

        for (const fullLoopCount of loopCounts) {
          const perimeterTravel = buildCycleTravel(graph, rawCycle, entryNodeId, exitNodeId, forward, fullLoopCount)
          if (!perimeterTravel) continue

          const routeNodeIds = [
            ...startToWaypointPath.routeNodeIds,
            ...waypointAccessPath.routeNodeIds.slice(1),
            ...perimeterTravel.routeNodeIds.slice(1),
            ...exitToEndPath.routeNodeIds.slice(1),
          ]
          const routeEdgeIds = [
            ...startToWaypointPath.routeEdgeIds,
            ...waypointAccessPath.routeEdgeIds,
            ...perimeterTravel.routeEdgeIds,
            ...exitToEndPath.routeEdgeIds,
          ]
          const edgeLen = edgeLengthMap(graph)
          const totalLengthPx = routeEdgeIds.reduce((sum, id) => sum + (edgeLen.get(id) ?? 0), 0)
          const routeLengthM = totalLengthPx * metersPerPixel
          if (routeLengthM > targetDistanceM * MAX_PERIMETER_OVERRUN_RATIO) continue
          const routePerimeterRatio = perimeterEdgeRatio(graph, routeEdgeIds)
          if (routePerimeterRatio < MIN_PERIMETER_ROUTE_RATIO) continue

          const route: SegmentRoute = { routeNodeIds, routeEdgeIds, totalLengthPx }
          const key = routeEdgeIds.join('|')
          if (!seen.has(key)) {
            seen.add(key)
            candidates.push(
              toCandidate(
                graph,
                route,
                `PERIM_WP_${String(candidateIndex).padStart(3, '0')}`,
                fullLoopCount > baseLoopCount ? 'Perimeter Extended via Waypoint' : 'Perimeter via Waypoint',
                targetDistanceM,
                routeLengthM,
                metersPerPixel,
                'detour',
                fullLoopCount > 0,
                fullLoopCount,
              ),
            )
            candidateIndex += 1
          }

          const fillRoutes = generateDistanceFillRoutes({
            graph,
            baseRoute: route,
            baseRouteLengthM: routeLengthM,
            targetDistanceM,
            metersPerPixel,
            insertAtNodeIds: [entryNodeId, exitNodeId],
          })
          for (const fillRoute of fillRoutes) {
            const fillLengthM = fillRoute.totalLengthPx * metersPerPixel
            if (fillLengthM > targetDistanceM * MAX_PERIMETER_OVERRUN_RATIO) continue
            const fillPerimeterRatio = perimeterEdgeRatio(graph, fillRoute.routeEdgeIds)
            if (fillPerimeterRatio < MIN_PERIMETER_ROUTE_RATIO) continue
            const fillKey = fillRoute.routeEdgeIds.join('|')
            if (seen.has(fillKey)) continue
            seen.add(fillKey)
            candidates.push(
              toCandidate(
                graph,
                fillRoute,
                `PERIM_WP_${String(candidateIndex).padStart(3, '0')}`,
                'Perimeter via Waypoint + Distance Fill',
                targetDistanceM,
                routeLengthM,
                metersPerPixel,
                'detour',
                true,
                fullLoopCount,
              ),
            )
            candidateIndex += 1
          }
        }
      }
    }
  }

  const notShort = candidates.filter((candidate) => candidate.actualDistanceM >= candidate.targetDistanceM)
  notShort.sort(compareRouteCandidates)
  const validFirst = notShort.filter((candidate) => candidate.qualityLabel !== 'invalid')
  const invalidRest = notShort.filter((candidate) => candidate.qualityLabel === 'invalid')
  return [...validFirst, ...invalidRest].slice(0, maxCandidates)
}

export function generateAlternativeRoutes({
  graph,
  startNodeId,
  endNodeId,
  waypointNodeId,
  targetDistanceM,
  metersPerPixel,
  maxCandidates = 5,
  penaltyFactor = 1.5,
}: GenerateAlternativeRoutesArgs): RouteCandidate[] {
  if (!startNodeId || !endNodeId || targetDistanceM <= 0 || !Number.isFinite(targetDistanceM)) {
    return []
  }

  if (!waypointNodeId && startNodeId === endNodeId && targetDistanceM > LONG_RUN_THRESHOLD_M) {
    const perimeterRoutes = generatePerimeterFirstLoopRoutes({
      graph,
      startNodeId,
      targetDistanceM,
      metersPerPixel,
      maxCandidates,
    })
    if (perimeterRoutes.length > 0) return perimeterRoutes
  }

  if (!waypointNodeId && startNodeId !== endNodeId && targetDistanceM > LONG_RUN_THRESHOLD_M) {
    const perimeterRoutes = generatePerimeterFirstPointToPointRoutes({
      graph,
      startNodeId,
      endNodeId,
      targetDistanceM,
      metersPerPixel,
      maxCandidates,
    })
    if (perimeterRoutes.length > 0) return perimeterRoutes
  }

  if (waypointNodeId && targetDistanceM > LONG_RUN_THRESHOLD_M) {
    const perimeterRoutes = generatePerimeterFirstWaypointRoutes({
      graph,
      startNodeId,
      waypointNodeId,
      endNodeId,
      targetDistanceM,
      metersPerPixel,
      maxCandidates,
    })
    if (perimeterRoutes.length > 0) return perimeterRoutes
  }

  if (!waypointNodeId && startNodeId === endNodeId && targetDistanceM <= SHORT_LOOP_THRESHOLD_M) {
    const shortLoopRoutes = generateShortLoopRoutes({
      graph,
      startNodeId,
      targetDistanceM,
      metersPerPixel,
      maxCandidates,
    })
    if (shortLoopRoutes.length > 0) return shortLoopRoutes
  }

  const candidates: RouteCandidate[] = []
  const baseRoutes: SegmentRoute[] = []

  if (!waypointNodeId && startNodeId === endNodeId) {
    const loopCandidates = generateLoopCandidates({
      graph, loopStartNodeId: startNodeId, targetLoopDistanceM: targetDistanceM, metersPerPixel, maxCandidates: 5,
    })
    const emptyBase: SegmentRoute = { routeNodeIds: [startNodeId], routeEdgeIds: [], totalLengthPx: 0 }
    const extended = extendRouteWithRepeatedLoops({
      graph, baseRoute: emptyBase, baseRouteLengthM: 0, loopCandidates, targetDistanceM, metersPerPixel,
      maxRepeatCount: 1, insertAtNodeId: startNodeId,
    })
    let idx = 1
    for (const ex of extended) {
      const candidate = toCandidate(graph, ex, `CAND_${String(idx).padStart(3, '0')}`, `环线 ${idx}`, targetDistanceM, 0, metersPerPixel, 'loop', true, 1)
      const acceptableLongFallback =
        targetDistanceM > SHORT_LOOP_THRESHOLD_M &&
        candidate.actualDistanceM <= candidate.targetDistanceM * MAX_LOOP_PERIMETER_OVERRUN_RATIO &&
        candidate.repeatedEdgeRatio <= MAX_FILL_REPEATED_EDGE_RATIO &&
        candidate.qualityLabel !== 'invalid' &&
        countImmediateBacktracks(candidate.routeNodeIds) === 0
      if (isAcceptableShortLoopCandidate(candidate) || acceptableLongFallback) {
        candidates.push(candidate)
      }
      idx += 1
    }
  } else if (!waypointNodeId) {
    baseRoutes.push(...generateSegmentAlternatives(graph, startNodeId, endNodeId, 3, penaltyFactor))
  } else {
    const seg1 = generateSegmentAlternatives(graph, startNodeId, waypointNodeId, 3, penaltyFactor)
    const seg2 = generateSegmentAlternatives(graph, waypointNodeId, endNodeId, 3, penaltyFactor)
    const combos: Array<[number, number]> = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 0],
      [0, 2],
    ]
    for (const [a, b] of combos) {
      const s1 = seg1[a]
      const s2 = seg2[b]
      if (!s1 || !s2) continue
      baseRoutes.push({
        routeNodeIds: [...s1.routeNodeIds, ...s2.routeNodeIds.slice(1)],
        routeEdgeIds: [...s1.routeEdgeIds, ...s2.routeEdgeIds],
        totalLengthPx: s1.totalLengthPx + s2.totalLengthPx,
      })
    }
  }

  const uniqueBase = new Map<string, SegmentRoute>()
  for (const r of baseRoutes) {
    const key = r.routeEdgeIds.join('|')
    if (!uniqueBase.has(key)) uniqueBase.set(key, r)
  }

  const finalBaseRoutes = [...uniqueBase.values()]

  let candidateIndex = 1
  for (const baseRoute of finalBaseRoutes) {
    const baseRouteLengthM = baseRoute.totalLengthPx * metersPerPixel
    const remainingDistanceM = targetDistanceM - baseRouteLengthM

    const baseMode: RouteCandidate['routeMode'] =
      baseRouteLengthM > targetDistanceM ? 'over_target' : 'shortest'

    // phase 1 candidate always available
    candidates.push(
      toCandidate(
        graph,
        baseRoute,
        `CAND_${String(candidateIndex).padStart(3, '0')}`,
        `路线 ${candidateIndex}`,
        targetDistanceM,
        baseRouteLengthM,
        metersPerPixel,
        baseMode,
        false,
        0,
      ),
    )
    candidateIndex += 1

    // phase 2: distance补足
    if (remainingDistanceM > targetDistanceM * 0.1) {
      const insertNodes = [
        baseRoute.routeNodeIds[0],
        waypointNodeId,
        baseRoute.routeNodeIds[baseRoute.routeNodeIds.length - 1],
      ].filter((v, idx, arr): v is string => !!v && arr.indexOf(v) === idx)

      const maxRepeatCount = Math.max(4, Math.ceil(targetDistanceM / Math.max(baseRouteLengthM, 1)) + 2)

      let extended: SegmentRoute[] = []
      for (const insertNode of insertNodes) {
        const loopCandidates = generateLoopCandidates({
          graph,
          loopStartNodeId: insertNode,
          targetLoopDistanceM: remainingDistanceM,
          metersPerPixel,
          maxCandidates: 4,
        })

        const part = extendRouteWithRepeatedLoops({
          graph,
          baseRoute,
          baseRouteLengthM,
          loopCandidates,
          targetDistanceM,
          metersPerPixel,
          maxRepeatCount,
          insertAtNodeId: insertNode,
        })
        extended = extended.concat(part)
      }

      for (const ex of extended) {
        const extraLengthM = ex.totalLengthPx * metersPerPixel - baseRouteLengthM
        const avgLoopLengthM = remainingDistanceM > 0 ? remainingDistanceM : 1
        const repeatedLoopCount = Math.max(1, Math.round(extraLengthM / avgLoopLengthM))
        candidates.push(
          toCandidate(
            graph,
            ex,
            `CAND_${String(candidateIndex).padStart(3, '0')}`,
            `路线 ${candidateIndex}`,
            targetDistanceM,
            baseRouteLengthM,
            metersPerPixel,
            'repeat',
            true,
            repeatedLoopCount,
          ),
        )
        candidateIndex += 1
      }
    }
  }

  candidates.sort(compareRouteCandidates)

  const noImmediateBacktrack = candidates.filter(
    (c) => countImmediateBacktracks(c.routeNodeIds) === 0,
  )
  const pool = noImmediateBacktrack.length > 0 ? noImmediateBacktrack : candidates

  // default do not prioritize invalid
  const notShort = pool.filter((c) => c.actualDistanceM >= c.targetDistanceM)
  const validFirst = notShort.filter((c) => c.qualityLabel !== 'invalid')
  const invalidRest = pool.filter((c) => c.qualityLabel === 'invalid' && c.actualDistanceM >= c.targetDistanceM)

  // fallback: if no >=target candidate, allow best under-target with warning
  if (validFirst.length === 0 && invalidRest.length === 0) {
    const fallback = [...pool]
      .sort(compareRouteCandidates)
      .slice(0, maxCandidates)
      .map((c) => ({ ...c, warnings: [...c.warnings, 'under_target_fallback'] }))
    return fallback
  }

  const merged = [...validFirst, ...invalidRest]

  return merged.slice(0, maxCandidates)
}
