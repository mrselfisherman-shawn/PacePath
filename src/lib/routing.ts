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

function uniqueRatio(edgeIds: string[]): number {
  if (edgeIds.length === 0) return 0
  const counts = new Map<string, number>()
  edgeIds.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1))
  const repeated = [...counts.values()].filter((c) => c > 1).length
  return repeated / edgeIds.length
}

function qualityFromDiff(diffPercentAbs: number): RouteCandidate['qualityLabel'] {
  if (diffPercentAbs <= 10) return 'recommended'
  if (diffPercentAbs <= 20) return 'acceptable'
  if (diffPercentAbs <= 40) return 'poor'
  return 'invalid'
}

export function dijkstra(graph: RoadGraph, startNodeId: string, endNodeId: string): DijkstraResult {
  return dijkstraWithPenalties(graph, startNodeId, endNodeId, new Map(), 1)
}

export function getEdgeTraversalCost(edge: EdgeMeta, options: EdgeTraversalCostOptions): number {
  let factor = 1
  if (edge.preferred) factor *= 0.9
  if (edge.popularity > 0) factor *= 1 - Math.min(1, edge.popularity) * 0.15
  if (edge.scenicScore > 0) factor *= 1 - Math.min(1, edge.scenicScore) * 0.1
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
  const qualityLabel = qualityFromDiff(diffAbs)

  const edgeMap = new Map(graph.edges.map((e) => [e.edge_id, e]))
  const edgeLenMap = edgeLengthMap(graph)
  const pedCount = route.routeEdgeIds.reduce((sum, edgeId) => {
    const edge = edgeMap.get(edgeId)
    return sum + ((edge?.type ?? '').toLowerCase() === 'pedestrian_path' ? 1 : 0)
  }, 0)
  const pedestrianRatio = route.routeEdgeIds.length > 0 ? pedCount / route.routeEdgeIds.length : 0

  let popularLen = 0
  let preferredLen = 0
  let scenicWeighted = 0
  let totalLen = 0
  for (const edgeId of route.routeEdgeIds) {
    const edge = edgeMap.get(edgeId)
    const len = edgeLenMap.get(edgeId) ?? 0
    if (!edge || len <= 0) continue
    totalLen += len
    if ((edge.popularity ?? 0) > 0) popularLen += len
    if (edge.preferred) preferredLen += len
    scenicWeighted += len * (edge.scenicScore ?? 0)
  }

  const popularEdgeRatio = totalLen > 0 ? popularLen / totalLen : 0
  const preferredEdgeRatio = totalLen > 0 ? preferredLen / totalLen : 0
  const scenicAverage = totalLen > 0 ? scenicWeighted / totalLen : 0
  const popularityBonus = preferredEdgeRatio * 15 + popularEdgeRatio * 10 + scenicAverage * 8

  const distanceErrorRatio = Math.abs(actualDistanceM - targetDistanceM) / targetDistanceM
  const score =
    distanceErrorRatio * 100 +
    repeatedEdgeRatio * 20 +
    pedestrianRatio * 10 -
    preferredEdgeRatio * 15 -
    popularEdgeRatio * 10 -
    scenicAverage * 8

  const warnings = [...extraWarnings]
  if (usedLoop) warnings.push('包含重复路段，用于匹配目标距离。')

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

  const candidates: RouteCandidate[] = []
  const baseRoutes: SegmentRoute[] = []

  if (!waypointNodeId && startNodeId === endNodeId) {
    const loopCandidates = generateLoopCandidates({
      graph,
      loopStartNodeId: startNodeId,
      targetLoopDistanceM: targetDistanceM,
      metersPerPixel,
      maxCandidates: 5,
    })

    const emptyBase: SegmentRoute = {
      routeNodeIds: [startNodeId],
      routeEdgeIds: [],
      totalLengthPx: 0,
    }

    const extended = extendRouteWithRepeatedLoops({
      graph,
      baseRoute: emptyBase,
      baseRouteLengthM: 0,
      loopCandidates,
      targetDistanceM,
      metersPerPixel,
      maxRepeatCount: Math.max(4, Math.ceil(targetDistanceM / 300) + 2),
      insertAtNodeId: startNodeId,
    })

    let idx = 1
    for (const ex of extended) {
      candidates.push(
        toCandidate(
          graph,
          ex,
          `CAND_${String(idx).padStart(3, '0')}`,
          `环线 ${idx}`,
          targetDistanceM,
          0,
          metersPerPixel,
          'loop',
          true,
          1,
        ),
      )
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

  candidates.sort((a, b) => a.score - b.score)

  // default do not prioritize invalid
  const notShort = candidates.filter((c) => c.actualDistanceM >= c.targetDistanceM)
  const validFirst = notShort.filter((c) => c.qualityLabel !== 'invalid')
  const invalidRest = candidates.filter((c) => c.qualityLabel === 'invalid' && c.actualDistanceM >= c.targetDistanceM)

  // fallback: if no >=target candidate, allow best under-target with warning
  if (validFirst.length === 0 && invalidRest.length === 0) {
    const fallback = [...candidates]
      .sort((a, b) => a.score - b.score)
      .slice(0, maxCandidates)
      .map((c) => ({ ...c, warnings: [...c.warnings, 'under_target_fallback'] }))
    return fallback
  }

  const merged = [...validFirst, ...invalidRest]

  return merged.slice(0, maxCandidates)
}
