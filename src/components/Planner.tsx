import { type KeyboardEvent, useMemo, useState } from 'react'
import { useGuideRoadGraph } from '../hooks/useGuideRoadGraph'
import { dijkstra, generateAlternativeRoutes, type RouteCandidate } from '../lib/routing'
import { formatDistance, pxToMeters } from '../lib/distance'
import { useMapCalibration } from '../hooks/useMapCalibration'

type MapPoint = { node_id: string; x: number; y: number }

function slicePolyline(points: MapPoint[], fromPx: number, toPx: number): MapPoint[] {
  if (points.length < 2 || toPx <= fromPx) return []
  const out: MapPoint[] = []
  let travelled = 0

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const seg = Math.hypot(b.x - a.x, b.y - a.y)
    if (seg <= 0) continue

    const segStart = travelled
    const segEnd = travelled + seg
    if (segEnd < fromPx || segStart > toPx) {
      travelled = segEnd
      continue
    }

    const localFrom = Math.max(0, (fromPx - segStart) / seg)
    const localTo = Math.min(1, (toPx - segStart) / seg)

    const p1: MapPoint = {
      node_id: `slice-${i}-a`,
      x: a.x + (b.x - a.x) * localFrom,
      y: a.y + (b.y - a.y) * localFrom,
    }
    const p2: MapPoint = {
      node_id: `slice-${i}-b`,
      x: a.x + (b.x - a.x) * localTo,
      y: a.y + (b.y - a.y) * localTo,
    }

    if (out.length === 0) out.push(p1)
    else {
      const last = out[out.length - 1]
      if (last.x !== p1.x || last.y !== p1.y) out.push(p1)
    }
    out.push(p2)
    travelled = segEnd
  }

  return out
}

type SelectionMode = 'selecting_start' | 'selecting_end' | 'selecting_waypoint'

type PlaceOption = {
  key: string
  name: string
  anchorNodeId: string
  routeEnabled: boolean
  area: string
  category: string
  x: number | null
  y: number | null
}

type RouteMode = 'direct' | 'via' | 'return_via'

type RouteSummary = {
  startName: string
  viaName: string | null
  endName: string
  mode: RouteMode
  segment1LengthPx: number
  segment2LengthPx: number | null
  totalLengthPx: number
  note: string | null
}

function normalizeFlag(value: string | undefined): boolean {
  const text = (value ?? '').trim().toLowerCase()
  if (!text) return true
  return ['true', '1', 'yes', 'y'].includes(text)
}

function parseNumber(value: string | undefined): number | null {
  const num = Number(value ?? '')
  return Number.isFinite(num) ? num : null
}

function findNearestNodeId(
  x: number,
  y: number,
  nodes: { node_id: string; x: number; y: number }[],
): string {
  let bestId = ''
  let bestDist = Number.POSITIVE_INFINITY
  for (const node of nodes) {
    const d = Math.hypot(node.x - x, node.y - y)
    if (d < bestDist) {
      bestDist = d
      bestId = node.node_id
    }
  }
  return bestId
}

export function Planner({ variant = 'running' }: { variant?: 'running' | 'shortest' }) {
  const isShortestMode = variant === 'shortest'
  const { places, roads, graph, loading, error } = useGuideRoadGraph(8)
  const {
    calibration,
    loading: calibrationLoading,
    error: calibrationError,
  } = useMapCalibration()
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('selecting_start')
  const [startKey, setStartKey] = useState('')
  const [endKey, setEndKey] = useState('')
  const [waypointKey, setWaypointKey] = useState('')
  const [targetDistanceKmInput, setTargetDistanceKmInput] = useState('')
  const [routeError, setRouteError] = useState('')
  const [routeNotice, setRouteNotice] = useState('')
  const [routeNodeIds, setRouteNodeIds] = useState<string[]>([])
  const [routeEdgeIds, setRouteEdgeIds] = useState<string[]>([])
  const [routeSummary, setRouteSummary] = useState<RouteSummary | null>(null)
  const [routeCandidate, setRouteCandidate] = useState<RouteCandidate | null>(null)
  const [routeCandidates, setRouteCandidates] = useState<RouteCandidate[]>([])
  const [selectedCandidateId, setSelectedCandidateId] = useState('')
  const [hoveredPlaceKey, setHoveredPlaceKey] = useState('')

  function handleSvgActionKeyDown(event: KeyboardEvent<SVGElement>, action: () => void) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      action()
    }
  }

  const nodeMap = useMemo(() => {
    const map = new Map<string, { node_id: string; x: number; y: number }>()
    graph?.nodes.forEach((n) => map.set(n.node_id, n))
    return map
  }, [graph])

  const edgeMap = useMemo(() => {
    const map = new Map<
      string,
      {
        edge_id: string
        road_id: string
        is_bridge: string
        popularity: number
        preferred: boolean
        scenicScore: number
        notes: string
        from_node_id: string
        to_node_id: string
      }
    >()
    graph?.edges.forEach((e) => map.set(e.edge_id, e))
    return map
  }, [graph])

  const placeOptions = useMemo<PlaceOption[]>(() => {
    if (!graph) return []

    return places.map((row, index) => {
      const name =
        row.place_name?.trim() ||
        row['中文名称']?.trim() ||
        row['英文名称']?.trim() ||
        row.place_id?.trim() ||
        row['编号']?.trim() ||
        `Place ${index + 1}`
      const area = row.area?.trim() || row['建筑分区']?.trim() || '-'
      const category = row.category?.trim() || row['类别']?.trim() || '-'
      const routeEnabled = normalizeFlag(row.route_enabled)

      let anchorNodeId = (row.anchor_node_id ?? '').trim()
      const x = parseNumber(row.x)
      const y = parseNumber(row.y)

      if (!anchorNodeId && x !== null && y !== null) {
        anchorNodeId = findNearestNodeId(x, y, graph.nodes)
      }

      return {
        key: `${name}__${index}`,
        name,
        anchorNodeId,
        routeEnabled,
        area,
        category,
        x,
        y,
      }
    })
  }, [places, graph])

  const selectablePlaces = useMemo(
    () => placeOptions.filter((p) => p.routeEnabled),
    [placeOptions],
  )

  const startPlace = useMemo(
    () => selectablePlaces.find((p) => p.key === startKey) ?? null,
    [selectablePlaces, startKey],
  )
  const endPlace = useMemo(
    () => selectablePlaces.find((p) => p.key === endKey) ?? null,
    [selectablePlaces, endKey],
  )
  const waypointPlace = useMemo(
    () => selectablePlaces.find((p) => p.key === waypointKey) ?? null,
    [selectablePlaces, waypointKey],
  )

  const routePoints = useMemo(() => {
    const active = routeCandidates.find((c) => c.id === selectedCandidateId)
    const nodeIds = active ? active.routeNodeIds : routeNodeIds
    return nodeIds
      .map((id) => nodeMap.get(id))
      .filter((n): n is MapPoint => !!n)
  }, [routeNodeIds, nodeMap, routeCandidates, selectedCandidateId])

  const targetDistanceKm = useMemo(() => {
    const value = Number(targetDistanceKmInput)
    if (!Number.isFinite(value) || value <= 0) return null
    return value
  }, [targetDistanceKmInput])

  const targetDistanceM = useMemo(
    () => (targetDistanceKm !== null ? targetDistanceKm * 1000 : null),
    [targetDistanceKm],
  )

  const warmupCooldownSegments = useMemo(() => {
    if (isShortestMode || !calibration || targetDistanceM === null || routePoints.length < 2) {
      return { start: [] as MapPoint[], end: [] as MapPoint[] }
    }

    let totalPx = 0
    for (let i = 0; i < routePoints.length - 1; i++) {
      totalPx += Math.hypot(
        routePoints[i + 1].x - routePoints[i].x,
        routePoints[i + 1].y - routePoints[i].y,
      )
    }
    const totalM = pxToMeters(totalPx, calibration)
    const excessM = totalM - targetDistanceM
    if (excessM <= 0) return { start: [] as MapPoint[], end: [] as MapPoint[] }

    const segmentPx = (excessM / 2) / calibration.metersPerPixel
    const start = slicePolyline(routePoints, 0, segmentPx)
    const end = slicePolyline(routePoints, Math.max(0, totalPx - segmentPx), totalPx)
    return { start, end }
  }, [calibration, isShortestMode, routePoints, targetDistanceM])

  function buildCandidate(
    routeNodeIdsValue: string[],
    routeEdgeIdsValue: string[],
    totalLengthPxValue: number,
    routeMode: RouteCandidate['routeMode'],
    name: string,
    warnings: string[] = [],
  ): RouteCandidate | null {
    if (!calibration) return null
    const actualDistanceM = pxToMeters(totalLengthPxValue, calibration)
    const targetM = targetDistanceM ?? actualDistanceM
    const differenceM = actualDistanceM - targetM
    const differencePercent = targetM > 0 ? (differenceM / targetM) * 100 : 0
    const diffAbs = Math.abs(differencePercent)
    const qualityLabel = diffAbs <= 10 ? 'recommended' : diffAbs <= 20 ? 'acceptable' : diffAbs <= 40 ? 'poor' : 'invalid'
    const score = diffAbs * 100

    return {
      id: 'CAND_001',
      name,
      routeNodeIds: routeNodeIdsValue,
      routeEdgeIds: routeEdgeIdsValue,
      totalLengthPx: totalLengthPxValue,
      totalLengthM: actualDistanceM,
      targetDistanceM: targetM,
      actualDistanceM,
      differenceM,
      differencePercent,
      baseRouteLengthM: actualDistanceM,
      routeMode,
      usedLoop: false,
      repeatedLoopCount: 0,
      repeatedEdgeRatio: 0,
      popularEdgeRatio: 0,
      preferredEdgeRatio: 0,
      scenicAverage: 0,
      popularityBonus: 0,
      qualityLabel,
      score,
      warnings,
    }
  }

  function applyCandidate(candidate: RouteCandidate) {
    setSelectedCandidateId(candidate.id)
    setRouteNodeIds(candidate.routeNodeIds)
    setRouteEdgeIds(candidate.routeEdgeIds)
    setRouteCandidate(candidate)
  }

  function handleGenerateRoute() {
    if (!graph) {
      setRouteError('路网尚未加载完成。')
      return
    }

    setRouteCandidates([])
    setSelectedCandidateId('')

    if (!startPlace || !endPlace) {
      setRouteError('起点和终点不能为空。')
      return
    }

    if (!startPlace.anchorNodeId || !endPlace.anchorNodeId) {
      setRouteError('该地点尚未接入道路网络，暂时不能用于路线规划。')
      return
    }

    if (!isShortestMode && targetDistanceKmInput && targetDistanceKm === null) {
      setRouteError('目标距离必须大于 0。')
      return
    }

    const isSameStartEnd = startPlace.key === endPlace.key
    const hasWaypoint = !!waypointPlace
    const waypointSameAsStart = hasWaypoint && waypointPlace.key === startPlace.key
    const waypointSameAsEnd = hasWaypoint && waypointPlace.key === endPlace.key

    setRouteNotice('')

    if (isShortestMode && !hasWaypoint && isSameStartEnd) {
      setRouteNodeIds([])
      setRouteEdgeIds([])
      setRouteSummary(null)
      setRouteCandidate(null)
      setRouteError('For shortest route, choose different start/end or add a waypoint.')
      return
    }

    if (!isShortestMode && !hasWaypoint && isSameStartEnd && targetDistanceM === null) {
      setRouteNodeIds([])
      setRouteEdgeIds([])
      setRouteSummary(null)
      setRouteCandidate(null)
      setRouteError('')
      setRouteNotice('起点和终点相同时，请输入目标跑步距离，或选择一个途经点来生成环线。')
      return
    }

    if (!isShortestMode && !hasWaypoint && isSameStartEnd && targetDistanceM !== null) {
      setRouteError('')
      setRouteSummary({
        startName: startPlace.name,
        viaName: null,
        endName: endPlace.name,
        mode: 'direct',
        segment1LengthPx: 0,
        segment2LengthPx: null,
        totalLengthPx: 0,
        note: 'loop route 模式',
      })

      const alternatives = generateAlternativeRoutes({
        graph,
        startNodeId: startPlace.anchorNodeId,
        endNodeId: startPlace.anchorNodeId,
        targetDistanceM,
        metersPerPixel: calibration?.metersPerPixel ?? 0,
        maxCandidates: 5,
        penaltyFactor: 1.5,
      })
      setRouteCandidates(alternatives)
      if (alternatives.length > 0) {
        applyCandidate(alternatives[0])
        if (alternatives[0].warnings.includes('under_target_fallback')) {
          setRouteNotice('当前路网限制下未能完全达到目标距离，已返回最接近路线。')
        } else {
          setRouteNotice('该路线包含重复路段，用于匹配目标距离。')
        }
      } else {
        setRouteNodeIds([])
        setRouteEdgeIds([])
        setRouteCandidate(null)
        setRouteNotice('当前路网限制下未能生成可用环线。')
      }
      return
    }

    if (
      hasWaypoint &&
      waypointPlace &&
      waypointPlace.key === startPlace.key &&
      waypointPlace.key === endPlace.key
    ) {
      setRouteNodeIds([])
      setRouteEdgeIds([])
      setRouteSummary(null)
      setRouteCandidate(null)
      setRouteError('起点、途经点和终点不能全部相同。')
      return
    }

    if (hasWaypoint && waypointPlace && !waypointPlace.anchorNodeId) {
      setRouteNodeIds([])
      setRouteEdgeIds([])
      setRouteSummary(null)
      setRouteCandidate(null)
      setRouteError('该地点尚未接入道路网络，暂时不能用于路线规划。')
      return
    }

    const useWaypoint =
      hasWaypoint &&
      waypointPlace &&
      waypointPlace.anchorNodeId &&
      waypointPlace.key !== startPlace.key &&
      waypointPlace.key !== endPlace.key

    if (hasWaypoint && waypointPlace && !useWaypoint) {
      if (waypointSameAsStart && !isSameStartEnd) {
        setRouteNotice('途经点与起点相同，将按起点到终点路线计算。')
      } else if (waypointSameAsEnd && !isSameStartEnd) {
        setRouteNotice('途经点与终点相同，将按起点到终点路线计算。')
      }
    }

    if (!useWaypoint) {
      const direct = dijkstra(graph, startPlace.anchorNodeId, endPlace.anchorNodeId)
      if (!direct.found) {
        setRouteNodeIds([])
        setRouteEdgeIds([])
        setRouteSummary(null)
        setRouteCandidate(null)
        setRouteError('当前路网不连通，或地点 anchor_node_id 无法接入 graph。')
        return
      }

      setRouteError('')
      setRouteNodeIds(direct.routeNodeIds)
      setRouteEdgeIds(direct.routeEdgeIds)
      setRouteSummary({
        startName: startPlace.name,
        viaName: null,
        endName: endPlace.name,
        mode: 'direct',
        segment1LengthPx: direct.totalLengthPx,
        segment2LengthPx: null,
        totalLengthPx: direct.totalLengthPx,
        note: null,
      })

      if (!isShortestMode && targetDistanceM !== null) {
        const directMeters = calibration ? pxToMeters(direct.totalLengthPx, calibration) : 0
        const within10 = targetDistanceM > 0 && Math.abs(directMeters - targetDistanceM) / targetDistanceM <= 0.1
        const over = directMeters > targetDistanceM
        const routeMode: RouteCandidate['routeMode'] = over ? 'over_target' : 'shortest'
        const warnings: string[] = []
        if (!within10) {
          if (over) {
            warnings.push('基础路线长于目标距离，已标记为 over_target。')
          } else {
            warnings.push('基础路线短于目标距离，后续阶段将生成绕行候选路线。')
          }
        }
        const base = buildCandidate(
          direct.routeNodeIds,
          direct.routeEdgeIds,
          direct.totalLengthPx,
          routeMode,
          'Base route',
          warnings,
        )
        if (base) {
          setRouteCandidate(base)
        }

        const alternatives = generateAlternativeRoutes({
          graph,
          startNodeId: startPlace.anchorNodeId,
          endNodeId: endPlace.anchorNodeId,
          targetDistanceM,
          metersPerPixel: calibration?.metersPerPixel ?? 0,
          maxCandidates: 5,
          penaltyFactor: 1.5,
        })
        setRouteCandidates(alternatives)
        if (alternatives.length > 0) {
          applyCandidate(alternatives[0])
        }
      } else {
        setRouteCandidate(
          buildCandidate(
            direct.routeNodeIds,
            direct.routeEdgeIds,
            direct.totalLengthPx,
            'shortest',
            'Base route',
          ),
        )
      }
      return
    }

    const waypointNodeId = waypointPlace.anchorNodeId

    if (!isSameStartEnd) {
      const segment1 = dijkstra(graph, startPlace.anchorNodeId, waypointNodeId)
      if (!segment1.found) {
        setRouteNodeIds([])
        setRouteEdgeIds([])
        setRouteSummary(null)
        setRouteCandidate(null)
        setRouteError('起点 → 途经点 无可用路径')
        return
      }

      const segment2 = dijkstra(graph, waypointNodeId, endPlace.anchorNodeId)
      if (!segment2.found) {
        setRouteNodeIds([])
        setRouteEdgeIds([])
        setRouteSummary(null)
        setRouteCandidate(null)
        setRouteError('途经点 → 终点 无可用路径')
        return
      }

      const totalPx = segment1.totalLengthPx + segment2.totalLengthPx
      setRouteError('')
      setRouteNodeIds([...segment1.routeNodeIds, ...segment2.routeNodeIds.slice(1)])
      setRouteEdgeIds([...segment1.routeEdgeIds, ...segment2.routeEdgeIds])
      setRouteSummary({
        startName: startPlace.name,
        viaName: waypointPlace.name,
        endName: endPlace.name,
        mode: 'via',
        segment1LengthPx: segment1.totalLengthPx,
        segment2LengthPx: segment2.totalLengthPx,
        totalLengthPx: totalPx,
        note: null,
      })

      const totalMeters = calibration ? pxToMeters(totalPx, calibration) : 0
      const over = targetDistanceM !== null ? totalMeters > targetDistanceM : false
      const routeMode: RouteCandidate['routeMode'] = over ? 'over_target' : 'shortest'
      const warnings: string[] = []
      if (!isShortestMode && targetDistanceM !== null) {
        const within10 = Math.abs(totalMeters - targetDistanceM) / targetDistanceM <= 0.1
        if (!within10) {
          if (over) {
            warnings.push('基础路线长于目标距离，已标记为 over_target。')
          } else {
            warnings.push('基础路线短于目标距离，后续阶段将生成绕行候选路线。')
          }
        }
      }
      setRouteCandidate(
        buildCandidate(
          [...segment1.routeNodeIds, ...segment2.routeNodeIds.slice(1)],
          [...segment1.routeEdgeIds, ...segment2.routeEdgeIds],
          totalPx,
          routeMode,
          'Base route via waypoint',
          warnings,
        ),
      )

      if (!isShortestMode && targetDistanceM !== null) {
        const alternatives = generateAlternativeRoutes({
          graph,
          startNodeId: startPlace.anchorNodeId,
          endNodeId: endPlace.anchorNodeId,
          waypointNodeId,
          targetDistanceM,
          metersPerPixel: calibration?.metersPerPixel ?? 0,
          maxCandidates: 5,
          penaltyFactor: 1.5,
        })
        setRouteCandidates(alternatives)
        if (alternatives.length > 0) {
          applyCandidate(alternatives[0])
        }
      }
      return
    }

    const segment1 = dijkstra(graph, startPlace.anchorNodeId, waypointNodeId)
    if (!segment1.found) {
      setRouteNodeIds([])
      setRouteEdgeIds([])
      setRouteSummary(null)
      setRouteCandidate(null)
      setRouteError('起点 → 途经点 无可用路径')
      return
    }

    const segment2 = dijkstra(graph, waypointNodeId, startPlace.anchorNodeId)
    if (!segment2.found) {
      setRouteNodeIds([])
      setRouteEdgeIds([])
      setRouteSummary(null)
      setRouteCandidate(null)
      setRouteError('途经点 → 起点 无可用路径')
      return
    }

    const totalPx = segment1.totalLengthPx + segment2.totalLengthPx
    setRouteError('')
    setRouteNodeIds([...segment1.routeNodeIds, ...segment2.routeNodeIds.slice(1)])
    setRouteEdgeIds([...segment1.routeEdgeIds, ...segment2.routeEdgeIds])
    setRouteSummary({
      startName: startPlace.name,
      viaName: waypointPlace.name,
      endName: endPlace.name,
      mode: 'return_via',
      segment1LengthPx: segment1.totalLengthPx,
      segment2LengthPx: segment2.totalLengthPx,
      totalLengthPx: totalPx,
      note: '往返路线：从起点出发，经由途经点返回起点。',
    })

    const totalMeters = calibration ? pxToMeters(totalPx, calibration) : 0
    const over = targetDistanceM !== null ? totalMeters > targetDistanceM : false
    const routeMode: RouteCandidate['routeMode'] = over ? 'over_target' : 'loop'
    const warnings: string[] = []
    if (!isShortestMode && targetDistanceM !== null) {
      const within10 = Math.abs(totalMeters - targetDistanceM) / targetDistanceM <= 0.1
      if (!within10) {
        if (over) {
          warnings.push('基础路线长于目标距离，已标记为 over_target。')
        } else {
          warnings.push('基础路线短于目标距离，后续阶段将生成绕行候选路线。')
        }
      }
    }
    setRouteCandidate(
      buildCandidate(
        [...segment1.routeNodeIds, ...segment2.routeNodeIds.slice(1)],
        [...segment1.routeEdgeIds, ...segment2.routeEdgeIds],
        totalPx,
        routeMode,
        'Base return route',
        warnings,
      ),
    )

    if (targetDistanceM !== null) {
      const alternatives = generateAlternativeRoutes({
        graph,
        startNodeId: startPlace.anchorNodeId,
        endNodeId: startPlace.anchorNodeId,
        waypointNodeId,
        targetDistanceM,
        metersPerPixel: calibration?.metersPerPixel ?? 0,
        maxCandidates: 5,
        penaltyFactor: 1.5,
      })
      setRouteCandidates(alternatives)
      if (alternatives.length > 0) {
        applyCandidate(alternatives[0])
        if (alternatives[0].warnings.includes('under_target_fallback')) {
          setRouteNotice('当前路网限制下未能完全达到目标距离，已返回最接近路线。')
        } else if (alternatives[0].usedLoop) {
          setRouteNotice('该路线包含重复路段，用于匹配目标距离。')
        }
      }
    }
  }

  function handleMarkerClick(place: PlaceOption) {
    if (!place.routeEnabled) {
      setRouteError('该地点 route_enabled=false，暂不可用于路线规划。')
      return
    }
    if (!place.anchorNodeId) {
      setRouteError('该地点尚未接入道路网络，暂时不能用于路线规划。')
      return
    }

    setRouteError('')

    if (selectionMode === 'selecting_start') {
      setStartKey(place.key)
      return
    }

    if (selectionMode === 'selecting_end') {
      setEndKey(place.key)
      return
    }

    if (selectionMode === 'selecting_waypoint') {
      setWaypointKey(place.key)
    }
  }

  const routeMeta = useMemo(() => {
    if (!routeSummary) return null
    const routeEdges = routeEdgeIds.map((id) => edgeMap.get(id)).filter(Boolean)
    const roadIdCount = new Set(routeEdges.map((e) => e!.road_id)).size
    const hasBridge = routeEdges.some((e) => e!.is_bridge === 'yes')
    const estimatedLengthM = calibration ? pxToMeters(routeSummary.totalLengthPx, calibration) : null
    const estimatedLengthKm = estimatedLengthM !== null ? estimatedLengthM / 1000 : null

    return {
      ...routeSummary,
      roadIdCount,
      hasBridge,
      totalLengthPx: routeSummary.totalLengthPx,
      estimatedLengthM,
      estimatedLengthKm,
      estimatedLengthText: estimatedLengthM !== null ? formatDistance(estimatedLengthM) : null,
      distanceNote: '距离为基于手动比例尺校准的估算值',
    }
  }, [routeSummary, routeEdgeIds, edgeMap, calibration])

  return (
    <main className="page">
      <h1 className="page-title planner-title">
        {isShortestMode ? 'Shortest Route Navigation' : 'Running Route Planner'}
      </h1>
      <p className="planner-subtitle">
        {isShortestMode
          ? 'Pick start and end points. Get the shortest route.'
          : 'Pick a place. Set a distance. Start running!'}
      </p>

      <section className="data-status" aria-label="Data loading status" aria-live="polite">
        {loading ? (
          <p>Loading roads and places...</p>
        ) : error ? (
          <p>Failed to load data: {error}</p>
        ) : calibrationLoading ? (
          <p>Loading map calibration...</p>
        ) : calibrationError ? (
          <p>Map calibration error: {calibrationError}</p>
        ) : (
          <p>
            places: {placeOptions.length} | roads: {roads.length} | nodes:{' '}
            {graph?.nodes.length ?? 0}
          </p>
        )}
      </section>

      <section className="control-section" aria-label="Route selection controls">
        {!isShortestMode ? (
          <div className="control-row control-row-top">
            <label className="distance-field">
              <span>Target Distance (Km)</span>
              <input
                name="targetDistanceKm"
                type="number"
                min="0"
                step="0.1"
                inputMode="decimal"
                autoComplete="off"
                placeholder="e.g. 3"
                value={targetDistanceKmInput}
                onChange={(event) => setTargetDistanceKmInput(event.target.value)}
              />
            </label>
            <button className="mode-button" type="button" onClick={() => setTargetDistanceKmInput('1')}>
              1 Km
            </button>
            <button className="mode-button" type="button" onClick={() => setTargetDistanceKmInput('2')}>
              2 Km
            </button>
            <button className="mode-button" type="button" onClick={() => setTargetDistanceKmInput('3')}>
              3 Km
            </button>
            <button className="mode-button" type="button" onClick={() => setTargetDistanceKmInput('5')}>
              5 Km
            </button>
          </div>
        ) : null}

        <div className="control-row control-row-points">
          <div className="point-picker">
            <button
              type="button"
              className={selectionMode === 'selecting_start' ? 'mode-button is-active' : 'mode-button'}
              onClick={() => setSelectionMode('selecting_start')}
            >
              Start Point
            </button>
            <div className="point-select-wrap">
              <select
                name="start"
                autoComplete="off"
                aria-label="Start point list"
                value={startKey}
                onChange={(event) => setStartKey(event.target.value)}
              >
                <option value="">Select from list</option>
                {selectablePlaces.map((place) => (
                  <option key={place.key} value={place.key}>
                    {place.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="point-picker">
            <button
              type="button"
              className={selectionMode === 'selecting_waypoint' ? 'mode-button is-active' : 'mode-button'}
              onClick={() => setSelectionMode('selecting_waypoint')}
            >
              Waypoint
            </button>
            <div className="point-select-wrap">
              <select
                name="waypoint"
                autoComplete="off"
                aria-label="Waypoint list"
                value={waypointKey}
                onChange={(event) => setWaypointKey(event.target.value)}
              >
                <option value="">None</option>
                {selectablePlaces.map((place) => (
                  <option key={place.key} value={place.key}>
                    {place.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="point-picker">
            <button
              type="button"
              className={selectionMode === 'selecting_end' ? 'mode-button is-active' : 'mode-button'}
              onClick={() => setSelectionMode('selecting_end')}
            >
              End Point
            </button>
            <div className="point-select-wrap">
              <select
                name="end"
                autoComplete="off"
                aria-label="End point list"
                value={endKey}
                onChange={(event) => setEndKey(event.target.value)}
              >
                <option value="">Select from list</option>
                {selectablePlaces.map((place) => (
                  <option key={place.key} value={place.key}>
                    {place.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="control-row control-row-bottom">
          <button className="mode-button generate-button" type="button" onClick={handleGenerateRoute}>
            Generate Route
          </button>
        </div>
      </section>

      {routeError ? (
        <p className="route-error" aria-live="polite">
          {routeError}
        </p>
      ) : null}
      {routeNotice ? (
        <p className="route-notice" aria-live="polite">
          {routeNotice}
        </p>
      ) : null}

      <section className="map-section" aria-label="Route map view">
        <div className="map-container">
          <img
            className="map-image"
            src="/data/images/guides/campus-guide.jpg"
            alt="Campus guide map"
          />
          <svg className="map-overlay" viewBox="0 0 3085 3221" preserveAspectRatio="xMidYMid meet">
            <g>
              {routePoints.length >= 2 ? (
                <polyline
                  points={routePoints.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke={isShortestMode ? '#2563eb' : '#f97316'}
                  strokeWidth={12}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.96}
                />
              ) : null}
              {warmupCooldownSegments.start.length >= 2 ? (
                <polyline
                  points={warmupCooldownSegments.start.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke="#16a34a"
                  strokeWidth={12}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.98}
                />
              ) : null}
              {warmupCooldownSegments.end.length >= 2 ? (
                <polyline
                  points={warmupCooldownSegments.end.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke="#16a34a"
                  strokeWidth={12}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.98}
                />
              ) : null}
            </g>

            <g>
              {placeOptions.map((place) => {
                const markerX =
                  place.x ??
                  (place.anchorNodeId ? nodeMap.get(place.anchorNodeId)?.x ?? null : null)
                const markerY =
                  place.y ??
                  (place.anchorNodeId ? nodeMap.get(place.anchorNodeId)?.y ?? null : null)
                if (markerX === null || markerY === null) return null

                const isStart = startKey === place.key
                const isEnd = endKey === place.key
                const isWaypoint = waypointKey === place.key
                const isHovered = hoveredPlaceKey === place.key
                const isPicked = isStart || isEnd || isWaypoint
                const fill = isStart
                  ? '#16a34a'
                  : isEnd
                    ? '#dc2626'
                    : isWaypoint
                      ? '#d97706'
                      : isHovered
                        ? '#2f6b1a'
                        : '#9ecb6d'
                const markerLabel = isStart ? 'S' : isEnd ? 'E' : 'V'

                return (
                  <g key={`marker-${place.key}`}>
                    <circle
                      cx={markerX}
                      cy={markerY}
                      r={isPicked ? 15 : isHovered ? 13 : 10}
                      fill={fill}
                      className={isHovered && !isPicked ? 'place-marker is-hovered' : 'place-marker'}
                      role="button"
                      tabIndex={0}
                      aria-label={`select ${place.name}`}
                      onClick={() => handleMarkerClick(place)}
                      onMouseEnter={() => setHoveredPlaceKey(place.key)}
                      onMouseLeave={() => setHoveredPlaceKey('')}
                      onFocus={() => setHoveredPlaceKey(place.key)}
                      onBlur={() => setHoveredPlaceKey('')}
                      onKeyDown={(event) => handleSvgActionKeyDown(event, () => handleMarkerClick(place))}
                    />
                    {isPicked ? (
                      <g>
                        <circle cx={markerX} cy={markerY - 26} r={14} className="picked-marker-icon" />
                        <text x={markerX} y={markerY - 20} className="picked-marker-text">
                          {markerLabel}
                        </text>
                      </g>
                    ) : null}
                    {isHovered ? (
                      <g className="place-hover-card" transform={`translate(${markerX + 18}, ${markerY - 56})`}>
                        <path
                          d="M14 40h178a10 10 0 0 0 10-10V10A10 10 0 0 0 192 0H14A10 10 0 0 0 4 10v20a10 10 0 0 0 10 10z"
                          fill="#eff6ff"
                          stroke="#60a5fa"
                          strokeWidth="2"
                        />
                        <path
                          d="M0 10c0-6 5-10 10-10h4a10 10 0 0 0-10 10v20a10 10 0 0 0 10 10h-4C5 40 0 35 0 30z"
                          fill="#3b82f6"
                        />
                        <circle cx="14" cy="16" r="4" fill="#ffffff" />
                        <text x="24" y="16" className="hover-place-name">
                          {place.name}
                        </text>
                        <text x="24" y="31" className="hover-place-meta">
                          {`Position: ${place.area || '-'} | No. ${place.anchorNodeId || 'N/A'}`}
                        </text>
                      </g>
                    ) : null}
                  </g>
                )
              })}
            </g>
          </svg>
          {!isShortestMode ? (
            <div className="map-legend" aria-label="Route legend">
              <div className="map-legend-item">
                <span className="map-legend-line is-main" />
                <span>Orange = Main running segment</span>
              </div>
              <div className="map-legend-item">
                <span className="map-legend-line is-warmup" />
                <span>Green = Warm-up / Cool-down segment</span>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="route-info-panel" aria-label="Route details">
        <h2 className="route-options-title">{isShortestMode ? 'The Shortest Route' : 'Route Options'}</h2>
        {routeMeta ? (
          <p className="route-option-meta">
            Active route: {routeMeta.startName}
            {routeMeta.viaName ? ` -> ${routeMeta.viaName}` : ''}
            {' -> '}
            {routeMeta.endName} | {routeMeta.estimatedLengthText ?? '-'}
            {routeCandidate ? ` | Mode: ${routeCandidate.routeMode}` : ''}
          </p>
        ) : null}
        {isShortestMode ? (
          <p className="route-option-meta">
            {routeMeta?.estimatedLengthText
              ? `Distance: ${routeMeta.estimatedLengthText}`
              : 'Select points and click Generate Route.'}
          </p>
        ) : (
          <div className="candidate-list">
            {routeCandidates.length === 0 ? (
              <p>No route options yet. Set a target distance and generate route.</p>
            ) : (
              routeCandidates.map((candidate, index) => (
                <button
                  key={candidate.id}
                  type="button"
                  className={selectedCandidateId === candidate.id ? 'candidate-item is-active' : 'candidate-item'}
                  onClick={() => applyCandidate(candidate)}
                >
                  <span className="candidate-item-title">Option {index + 1}</span>
                  <span className="candidate-item-meta">
                    {(candidate.totalLengthM / 1000).toFixed(2)} km | diff{' '}
                    {candidate.differencePercent >= 0 ? '+' : ''}
                    {candidate.differencePercent.toFixed(1)}% ({candidate.qualityLabel} / {candidate.routeMode})
                    {candidate.popularEdgeRatio > 0
                      ? ` | Popular ${(candidate.popularEdgeRatio * 100).toFixed(0)}%`
                      : ''}
                    {candidate.preferredEdgeRatio > 0
                      ? ` | Preferred ${(candidate.preferredEdgeRatio * 100).toFixed(0)}%`
                      : ''}
                    {candidate.scenicAverage > 0
                      ? ` | Scenic ${(candidate.scenicAverage * 100).toFixed(0)}%`
                      : ''}
                    {(candidate.qualityLabel === 'recommended' || candidate.qualityLabel === 'acceptable') &&
                    (candidate.preferredEdgeRatio > 0 || candidate.popularEdgeRatio > 0)
                      ? ' | Recommended'
                      : ''}
                    {candidate.warnings.includes('under_target_fallback')
                      ? ' | under target fallback'
                      : ''}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </section>
    </main>
  )
}
