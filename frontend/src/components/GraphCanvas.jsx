import React, { useMemo, useState, useRef, useEffect } from "react"
import Button from './ui/Button'
import '../styles/ui.css'
import NodeCard from "./NodeCard"
import DraggableWindow from "./DraggableWindow"
import { API_BASE } from "../api/api"

/**
 * Simple SVG renderer for { nodes, edges }.
 * - domain nodes at center
 * - subdomain nodes on an inner ring
 * - ip nodes on an outer ring
 *
 * Accepts prop `data` with shape { nodes: [], edges: [] }.
 */
export default function GraphCanvas({ data, width = 3000, height = 2000, highlightIds = [], screenshotDomain = "", clearSelectionFlag = 0 }) {
  const padding = 40

  const { nodes = [], edges = [] } = data || {}
  const globalFontFamily = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial'
  const highlightedSet = useMemo(() => new Set(highlightIds || []), [highlightIds])

  const cardSizeFor = (category) => {
    if (category === "domain") return { w: 260, h: 120 }
    if (category === "subdomain") return { w: 220, h: 100 }
    if (category === "ip") return { w: 180, h: 80 }
    if (category === "port") return { w: 140, h: 64 }
    return { w: 200, h: 88 }
  }

  // Hierarchical, parent-centered layout similar to Neo4j
  const positioned = useMemo(() => {
    const positions = {}
    const nodesById = nodes.reduce((m, n) => ((m[n.id] = n), m), {})

    // Build child/parent relationships using common relation labels
    const childMap = {}
    const parentMap = {}
    edges.forEach((e) => {
      if (!e || !e.source || !e.target) return
      const lab = String(e.label || '').toUpperCase()
      // treat common hierarchical relations as parent -> child
      // HAS_SUBDOMAIN : domain -> subdomain
      // RESOLVES_TO   : subdomain -> ip
      // HAS_PORT      : ip -> port
      // fallback: treat as directed source->target
      const isHier = ['HAS_SUBDOMAIN', 'RESOLVES_TO', 'HAS_PORT'].includes(lab)
      const src = e.source
      const tgt = e.target
      childMap[src] = childMap[src] || []
      childMap[src].push(tgt)
      parentMap[tgt] = parentMap[tgt] || []
      parentMap[tgt].push(src)
    })

    // helper to get card size by node id
    const cardForId = (id) => {
      const n = nodesById[id]
      return cardSizeFor(n && n.category)
    }

    const minGapX = 40
    const minGapY = 80
    const pad = padding

    // memoized subtree width (in world units) computation to center parents above children
    const widthMemo = new Map()
    const visiting = new Set()
    const subtreeWidth = (id) => {
      if (widthMemo.has(id)) return widthMemo.get(id)
      if (visiting.has(id)) {
        // cycle detected; treat as leaf
        const w = cardForId(id).w + minGapX
        widthMemo.set(id, w)
        return w
      }
      visiting.add(id)
      const kids = (childMap[id] || []).filter((c) => nodesById[c])
      let w
      if (!kids.length) {
        w = cardForId(id).w + minGapX
      } else {
        w = kids.reduce((sum, c) => sum + subtreeWidth(c), 0)
      }
      widthMemo.set(id, w)
      visiting.delete(id)
      return w
    }

    // compute leaf descendants (used to produce a stable grouping key for sorting)
    const leavesMemo = new Map()
    const leavesVisiting = new Set()
    const subtreeLeaves = (id) => {
      if (leavesMemo.has(id)) return leavesMemo.get(id)
      if (leavesVisiting.has(id)) {
        leavesMemo.set(id, [])
        return []
      }
      leavesVisiting.add(id)
      const kids = (childMap[id] || []).filter((c) => nodesById[c])
      let out = []
      if (!kids.length) {
        out = [id]
      } else {
        const set = new Set()
        kids.forEach((c) => {
          const sub = subtreeLeaves(c) || []
          sub.forEach((s) => set.add(s))
        })
        out = Array.from(set).sort()
      }
      leavesMemo.set(id, out)
      leavesVisiting.delete(id)
      return out
    }

    // find roots (nodes without any parent). If none, pick all nodes as separate roots.
    const allIds = nodes.map((n) => n.id)
    const roots = allIds.filter((id) => !(parentMap[id] && parentMap[id].length))
    const effectiveRoots = roots.length ? roots : allIds.slice()

    // layout traversal: place subtrees left-to-right, compute x as center of children
    let cursorX = pad
    let maxDepth = 0
    const levelHeights = {} // track max card height per depth

    const placeSubtree = (id, depth = 0) => {
      maxDepth = Math.max(maxDepth, depth)
      let kids = (childMap[id] || []).filter((c) => nodesById[c])
      // Sort children to cluster nodes that share the same leaf/IP descendants.
      // This makes siblings that resolve to the same IP sit next to each other,
      // reducing long crossing edges when many subdomains point to the same IP.
      kids = kids.slice().sort((a, b) => {
        const la = subtreeLeaves(a).join(',')
        const lb = subtreeLeaves(b).join(',')
        if (la < lb) return -1
        if (la > lb) return 1
        // stable tie-breaker by id
        if (a < b) return -1
        if (a > b) return 1
        return 0
      })
      const card = cardForId(id)
      const cardW = card.w
      const cardH = card.h
      levelHeights[depth] = Math.max(levelHeights[depth] || 0, cardH)

  if (!kids.length) {
        // leaf: place at current cursorX
        const x = cursorX + cardW / 2
        const y = pad + depth * (Math.max(...Object.values(levelHeights || { 0: cardH })) + minGapY) + cardH / 2
        positions[id] = { x, y }
        cursorX += cardW + minGapX
        return
      }

      // internal: reserve width equal to sum of child subtree widths
      const totalKidsWidth = kids.reduce((s, c) => s + subtreeWidth(c), 0)
      const startX = cursorX
  kids.forEach((c) => placeSubtree(c, depth + 1))
      const childXs = kids.map((c) => positions[c].x)
      const minChildX = Math.min(...childXs)
      const maxChildX = Math.max(...childXs)
      const x = (minChildX + maxChildX) / 2
      const y = pad + depth * (Math.max(...Object.values(levelHeights || { 0: cardH })) + minGapY) + cardH / 2
      positions[id] = { x, y }
      // advance cursor if this subtree consumed space
      cursorX = Math.max(cursorX, startX + totalKidsWidth)
    }

    // place each root left-to-right
    effectiveRoots.forEach((r) => {
      // only place nodes that exist
      if (!nodesById[r]) return
      // compute width to advance cursor appropriately
      const w = subtreeWidth(r)
      // if cursor already beyond, leave as is, otherwise ensure cursor accounts for gap
      if (cursorX > pad && cursorX + w > cursorX) {
        // no-op; children placement will advance cursor
      }
      placeSubtree(r, 0)
      // add an extra gap between root subtrees
      cursorX += minGapX
    })

    // any node not placed (orphans/cycles) -> place on a supplemental row
    const unplaced = allIds.filter((id) => !positions[id])
    if (unplaced.length) {
      const rowY = pad + (maxDepth + 1) * (Math.max(...Object.values(levelHeights || { 0: 120 })) + minGapY) + 60
      unplaced.forEach((id) => {
        const card = cardForId(id)
        const x = cursorX + card.w / 2
        positions[id] = { x, y: rowY }
        cursorX += card.w + minGapX
      })
    }

    // Center nodes that have multiple parents (shared nodes), e.g. many subdomains resolving to same IP.
    // Compute the average x of available parent positions and shift the shared node's subtree by the delta.
    const shared = allIds.filter((id) => (parentMap[id] || []).length > 1)
    const shifted = new Set()
    const shiftSubtree = (startId, dx) => {
      const stack = [startId]
      while (stack.length) {
        const cur = stack.pop()
        if (!cur || shifted.has(cur)) continue
        if (positions[cur]) positions[cur].x = (positions[cur].x || 0) + dx
        shifted.add(cur)
        ;(childMap[cur] || []).forEach((c) => stack.push(c))
      }
    }
    shared.forEach((id) => {
      const parents = (parentMap[id] || []).filter((p) => positions[p])
      if (!parents.length) return
      const avg = parents.reduce((s, p) => s + (positions[p].x || 0), 0) / parents.length
      const curX = (positions[id] && positions[id].x) || null
      if (curX === null) return
      const dx = avg - curX
      if (Math.abs(dx) < 1) return
      shiftSubtree(id, dx)
    })

    const layoutWidth = Math.max(800, cursorX + pad)
    const totalLevelHeights = Object.values(levelHeights).reduce((s, v) => s + v, 0)
    const layoutHeight = Math.max(700, pad * 2 + (maxDepth + 1) * (Math.max(...Object.values(levelHeights || { 0: 120 })) + minGapY) + 200)

    return { positions, nodesById, layoutWidth, layoutHeight }
  }, [data, padding])

  const colorFor = (category) => {
    if (category === "domain") return "#f59e0b" // amber
    if (category === "subdomain") return "#3b82f6" // blue
    if (category === "ip") return "#a855f7" // purple
    if (category === "port") return "#14b8a6" // teal
    return "#94a3b8" // slate
  }

  const svgRef = useRef(null)
  const layoutWidth = positioned.layoutWidth || width
  const layoutHeight = positioned.layoutHeight || height
  const draggingNodeRef = useRef(null)
  const pressRef = useRef(null)
  const panningRef = useRef(null)
  const pointersRef = useRef({})
  const pinchRef = useRef(null)
  const panTargetRef = useRef({ x: 0, y: 0 })
  const scaleTargetRef = useRef(1)
  const animatingRef = useRef(false)
  const rafIdRef = useRef(null)
  const [positionsState, setPositionsState] = useState({})
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [scale, setScale] = useState(1)
  const panRef = useRef(pan)
  const scaleRef = useRef(scale)
  const [hoveredNodeId, setHoveredNodeId] = useState(null)
  const [screenshotUrl, setScreenshotUrl] = useState(null)
  const [screenshotError, setScreenshotError] = useState(null)
  const [previewTitle, setPreviewTitle] = useState(null)
  const [selectedNodeId, setSelectedNodeId] = useState(null)
  const [selectedComponentIds, setSelectedComponentIds] = useState(new Set())
  const [selectedEdgeIds, setSelectedEdgeIds] = useState(new Set())
  const inspectorInitialPos = useMemo(() => {
    if (typeof window === "undefined") return { x: 12, y: 80 }
    const panelW = 360
    const pad = 12
    const x = Math.max(pad, (window.innerWidth || 0) - panelW - pad)
    return { x, y: 80 }
  }, [])

  const buildScreenshotUrl = (label) => {
    const fname = String(label || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") + ".png"
    if (!screenshotDomain) return null
    return `/backend/projects/${encodeURIComponent(screenshotDomain)}/screenshot/${fname}`
  }

  const openScreenshotForNode = (node, fallbackId) => {
    const label = (node && (node.label || node.id)) || fallbackId || ""
    const url = buildScreenshotUrl(label)
    setScreenshotError(null)
    setPreviewTitle(label)
    if (!url) {
      setScreenshotError(true)
      setScreenshotUrl(null)
      return
    }
    setScreenshotUrl(url)
  }

  // initialize mutable positions when layout changes
  useEffect(() => {
    setPositionsState(positioned.positions || {})
  }, [data])

  // allow parent to clear selection + highlights on demand (e.g. Clear button)
  useEffect(() => {
    if (!clearSelectionFlag) return
    setSelectedNodeId(null)
    setSelectedComponentIds(new Set())
    setSelectedEdgeIds(new Set())
    setScreenshotUrl(null)
    setScreenshotError(null)
  }, [clearSelectionFlag])

  useEffect(() => {
    panRef.current = pan
  }, [pan])

  useEffect(() => {
    scaleRef.current = scale
  }, [scale])

  // When a node is selected, compute its connected component (BFS) and collect edges
  useEffect(() => {
    // If no selection, clear
    if (!selectedNodeId) {
      setSelectedComponentIds(new Set())
      setSelectedEdgeIds(new Set())
      return
    }
    const edgesList = edges || []
    const forwardAdj = {}
    const backwardAdj = {}
    edgesList.forEach((e, idx) => {
      forwardAdj[e.source] = forwardAdj[e.source] || []
      forwardAdj[e.source].push({ id: idx, to: e.target })
      backwardAdj[e.target] = backwardAdj[e.target] || []
      backwardAdj[e.target].push({ id: idx, from: e.source })
    })

    const nodesSet = new Set()
    const edgeSet = new Set()

    // include the selected node
    nodesSet.add(selectedNodeId)

    // backward traversal (ancestors) - e.g., find domain for a subdomain
    const bq = [selectedNodeId]
    while (bq.length) {
      const cur = bq.shift()
      const preds = backwardAdj[cur] || []
      preds.forEach((it) => {
        if (!nodesSet.has(it.from)) {
          nodesSet.add(it.from)
          bq.push(it.from)
        }
        edgeSet.add(it.id)
      })
    }

    // forward traversal (descendants) - e.g., IPs and ports from subdomain
    const fq = [selectedNodeId]
    while (fq.length) {
      const cur = fq.shift()
      const succ = forwardAdj[cur] || []
      succ.forEach((it) => {
        if (!nodesSet.has(it.to)) {
          nodesSet.add(it.to)
          fq.push(it.to)
        }
        edgeSet.add(it.id)
      })
    }

    setSelectedComponentIds(nodesSet)
    setSelectedEdgeIds(edgeSet)
  }, [selectedNodeId, edges])

  // attach a non-passive wheel listener to allow preventDefault
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const handler = (ev) => {
      // Always prevent the page from scrolling when wheel happens over the SVG
      ev.preventDefault()
      // Ctrl/Cmd + wheel => zoom centered on cursor; otherwise wheel pans
      const rect = svg.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      // If user is holding Ctrl or Meta, treat wheel as zoom
      if (ev.ctrlKey || ev.metaKey) {
        const clientSvgX = ((ev.clientX - rect.left) / rect.width) * layoutWidth
        const clientSvgY = ((ev.clientY - rect.top) / rect.height) * layoutHeight
        // compute world coordinates using current target values
        const worldX = (clientSvgX - panTargetRef.current.x) / scaleTargetRef.current
        const worldY = (clientSvgY - panTargetRef.current.y) / scaleTargetRef.current
        const factor = Math.pow(1.001, -ev.deltaY)
        const newScale = Math.max(0.3, Math.min(4, scaleTargetRef.current * factor))
        const newPanX = clientSvgX - worldX * newScale
        const newPanY = clientSvgY - worldY * newScale
        scaleTargetRef.current = newScale
        panTargetRef.current = { x: newPanX, y: newPanY }
        startAnimator()
        return
      }
      // otherwise treat wheel as pan (do not preventDefault unless needed)
      // standard wheel deltas: deltaY for vertical scroll, deltaX for horizontal
      const deltaX = ev.deltaX || 0
      const deltaY = ev.deltaY || 0
      // invert to get natural scrolling feel
      panTargetRef.current = { x: panTargetRef.current.x - deltaX, y: panTargetRef.current.y - deltaY }
      startAnimator()
    }

    svg.addEventListener("wheel", handler, { passive: false })
    return () => {
      svg.removeEventListener("wheel", handler)
    }
  }, [pan.x, pan.y, scale, layoutWidth, layoutHeight])

  // Smooth animator for pan and scale
  const startAnimator = () => {
    if (animatingRef.current) return
    animatingRef.current = true
    const step = () => {
      let nextPan = panRef.current
      let nextScale = scaleRef.current
      // lerp 0.22 for pan, 0.18 for scale
      setPan((cur) => {
        const tx = panTargetRef.current.x
        const ty = panTargetRef.current.y
        const nx = cur.x + (tx - cur.x) * 0.22
        const ny = cur.y + (ty - cur.y) * 0.22
        nextPan = { x: Math.abs(tx - nx) < 0.5 ? tx : nx, y: Math.abs(ty - ny) < 0.5 ? ty : ny }
        panRef.current = nextPan
        return nextPan
      })
      setScale((curS) => {
        const ts = scaleTargetRef.current
        const ns = curS + (ts - curS) * 0.18
        nextScale = Math.abs(ts - ns) < 0.001 ? ts : ns
        scaleRef.current = nextScale
        return nextScale
      })
      const closeEnough = Math.abs(nextPan.x - panTargetRef.current.x) < 0.6 && Math.abs(nextPan.y - panTargetRef.current.y) < 0.6 && Math.abs(nextScale - scaleTargetRef.current) < 0.002
      if (closeEnough) {
        // final snap
        setPan({ x: panTargetRef.current.x, y: panTargetRef.current.y })
        setScale(scaleTargetRef.current)
        panRef.current = { x: panTargetRef.current.x, y: panTargetRef.current.y }
        scaleRef.current = scaleTargetRef.current
        animatingRef.current = false
        rafIdRef.current = null
        return
      }
      rafIdRef.current = requestAnimationFrame(step)
    }
    rafIdRef.current = requestAnimationFrame(step)
  }

  // pointer events for pinch-to-zoom and wheel-as-pan fallback
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return

    const updatePointer = (ev) => {
      pointersRef.current[ev.pointerId] = { x: ev.clientX, y: ev.clientY }
    }

    const removePointer = (ev) => {
      delete pointersRef.current[ev.pointerId]
      pinchRef.current = null
    }

    const onPointerMoveNative = (ev) => {
      // update stored pointers
      if (pointersRef.current[ev.pointerId]) {
        updatePointer(ev)
      }
      const ids = Object.keys(pointersRef.current)
      if (ids.length === 2) {
        const p1 = pointersRef.current[ids[0]]
        const p2 = pointersRef.current[ids[1]]
        if (!p1 || !p2) return
        const dx = p2.x - p1.x
        const dy = p2.y - p1.y
        const dist = Math.hypot(dx, dy)
        if (!pinchRef.current) {
          pinchRef.current = { startDist: dist, startScale: scale }
          return
        }
        const factor = dist / pinchRef.current.startDist
        const newScale = Math.max(0.3, Math.min(4, pinchRef.current.startScale * factor))
        scaleTargetRef.current = newScale
        startAnimator()
      }
    }

    svg.addEventListener('pointerdown', updatePointer)
    svg.addEventListener('pointermove', onPointerMoveNative)
    svg.addEventListener('pointerup', removePointer)
    svg.addEventListener('pointercancel', removePointer)

    return () => {
      svg.removeEventListener('pointerdown', updatePointer)
      svg.removeEventListener('pointermove', onPointerMoveNative)
      svg.removeEventListener('pointerup', removePointer)
      svg.removeEventListener('pointercancel', removePointer)
      // nothing to remove for wheel here; main wheel listener is handled above
    }
  }, [scale])

  // pointer handlers for node dragging

  const onPointerMove = (e) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    if (!rect.width || !rect.height) return

    // if dragging a node, move that node in world coordinates
    const drag = draggingNodeRef.current
    if (drag) {
      const clientSvgX = ((e.clientX - rect.left) / rect.width) * layoutWidth
      const clientSvgY = ((e.clientY - rect.top) / rect.height) * layoutHeight
      if (!Number.isFinite(clientSvgX) || !Number.isFinite(clientSvgY)) return

      // convert to world coords (account for pan/scale)
      const currWorldX = (clientSvgX - pan.x) / scale
      const currWorldY = (clientSvgY - pan.y) / scale

      const startWorldX = drag.startClientWorldX
      const startWorldY = drag.startClientWorldY
      const id = drag.id

      setPositionsState((prev) => {
        const copy = { ...prev }
        const sx = drag.startNodeX
        const sy = drag.startNodeY
        const nx = sx + (currWorldX - startWorldX)
        const ny = sy + (currWorldY - startWorldY)
        const cx = Math.max(-10000, Math.min(10000, nx))
        const cy = Math.max(-10000, Math.min(10000, ny))
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) return prev
        copy[id] = { x: cx, y: cy }
        return copy
      })
      return
    }

    // if pressRef is active and movement exceeds threshold, start dragging
    if (pressRef.current && !draggingNodeRef.current) {
      const rect = svg.getBoundingClientRect()
      const clientSvgX = ((e.clientX - rect.left) / rect.width) * layoutWidth
      const clientSvgY = ((e.clientY - rect.top) / rect.height) * layoutHeight
      const dx = Math.abs(clientSvgX - pressRef.current.startClientSvgX)
      const dy = Math.abs(clientSvgY - pressRef.current.startClientSvgY)
      if (dx > 4 || dy > 4) {
        // start dragging
        draggingNodeRef.current = {
          id: pressRef.current.id,
          pointerId: pressRef.current.pointerId,
          startClientWorldX: pressRef.current.startClientWorldX,
          startClientWorldY: pressRef.current.startClientWorldY,
          startNodeX: pressRef.current.startNodeX,
          startNodeY: pressRef.current.startNodeY,
        }
        pressRef.current.moved = true
      }
    }

    // panning the background
    const panRef = panningRef.current
    if (panRef) {
      const clientSvgX = ((e.clientX - rect.left) / rect.width) * layoutWidth
      const clientSvgY = ((e.clientY - rect.top) / rect.height) * layoutHeight
      if (!Number.isFinite(clientSvgX) || !Number.isFinite(clientSvgY)) return
      const dx = clientSvgX - panRef.startClientSvgX
      const dy = clientSvgY - panRef.startClientSvgY
      setPan({ x: panRef.startPanX + dx, y: panRef.startPanY + dy })
      return
    }

    // otherwise no-op
  }

  const stopInteraction = (e) => {
    if (draggingNodeRef.current) {
      try { svgRef.current && svgRef.current.releasePointerCapture(draggingNodeRef.current.pointerId) } catch (err) {}
      draggingNodeRef.current = null
    }
    if (pressRef.current) {
      try { svgRef.current && svgRef.current.releasePointerCapture(pressRef.current.pointerId) } catch (err) {}
      // if press did not move, treat as click
      if (!pressRef.current.moved) {
        const id = pressRef.current.id
        // select node and compute related set in effect
        setSelectedNodeId(id)
        // open preview modal for this node
        const node = positioned.nodesById && positioned.nodesById[id]
        if (node && (node.category === "domain" || node.category === "subdomain")) {
          openScreenshotForNode(node, id)
        }
      }
      pressRef.current = null
    }
    if (panningRef.current) {
      try { svgRef.current && svgRef.current.releasePointerCapture(panningRef.current.pointerId) } catch (err) {}
      panningRef.current = null
    }
  }

  const nodesCount = (data && data.nodes && data.nodes.length) || 0
  const posMap = Object.keys(positionsState).length ? positionsState : positioned.positions
  const hasHighlights = highlightedSet.size > 0
  const selectedNode = selectedNodeId ? (positioned.nodesById && positioned.nodesById[selectedNodeId]) : null
  const selectedIsScreenshotNode = selectedNode && (selectedNode.category === "domain" || selectedNode.category === "subdomain")

  const getRelatedForSelected = () => {
    const relNodes = []
    const relEdges = []
    if (selectedComponentIds && selectedComponentIds.size) {
      for (const nid of selectedComponentIds) {
        if (positioned.nodesById[nid]) relNodes.push(positioned.nodesById[nid])
      }
    }
    if (selectedEdgeIds && selectedEdgeIds.size) {
      selectedEdgeIds.forEach((eid) => {
        if (edges[eid]) relEdges.push(edges[eid])
      })
    }
    return { relNodes, relEdges }
  }

  const resetView = () => {
    setPan({ x: 0, y: 0 })
    setScale(1)
    setPositionsState(positioned.positions || {})
    panRef.current = { x: 0, y: 0 }
    scaleRef.current = 1
  }

  return (
    <div style={{ width: "100%", overflow: "auto", position: "relative" }}>
      {/* floating reset control to recover from off-screen / blank view */}
      <div style={{ position: 'fixed', left: 12, top: 12, zIndex: 1000 }}>
        <Button onClick={resetView} className="btn-ghost">Reset view</Button>
      </div>
      {/* wheel listener attached in useEffect to allow non-passive preventDefault */}
      <svg
        ref={svgRef}
        width={layoutWidth}
        height={layoutHeight}
        viewBox={`0 0 ${layoutWidth} ${layoutHeight}`}
        style={{ border: "1px solid #0f1724", background: "#071024", touchAction: "none", display: "block" }}
        onPointerMove={onPointerMove}
        onPointerUp={stopInteraction}
        onPointerCancel={stopInteraction}
        onPointerLeave={stopInteraction}
        onPointerDown={(ev) => {
          // start panning when background is clicked (only when target is svg)
          if (ev.target !== svgRef.current) return
          const svg = svgRef.current
          if (!svg) return
          const rect = svg.getBoundingClientRect()
          if (!rect.width || !rect.height) return
          const clientSvgX = ((ev.clientX - rect.left) / rect.width) * layoutWidth
          const clientSvgY = ((ev.clientY - rect.top) / rect.height) * layoutHeight
          panningRef.current = {
            pointerId: ev.pointerId,
            startClientSvgX: clientSvgX,
            startClientSvgY: clientSvgY,
            startPanX: pan.x,
            startPanY: pan.y,
          }
          try { svg.setPointerCapture(ev.pointerId) } catch (err) {}
        }}
      >
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${scale})`}>
          {nodesCount === 0 && (
            <g>
              <rect x={0} y={0} width={layoutWidth} height={layoutHeight} fill="rgba(7,16,36,0.0)" />
              <text x={layoutWidth / 2} y={layoutHeight / 2} textAnchor="middle" fontSize={18} fill="#94a3b8">No nodes to display — run a scan or load data</text>
            </g>
          )}
          {/* edges */}
          {hasHighlights ? null : (
            <g stroke="#374151" strokeWidth="1">
              {/* arrow marker for directed edges */}
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto" markerUnits="strokeWidth">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#9ca3af" />
                </marker>
              </defs>
              {edges.map((e, idx) => {
                const s = posMap[e.source]
                const t = posMap[e.target]
                if (!s || !t) return null
                // safety: avoid rendering edges between two port nodes (ports should not directly connect)
                const sNode = positioned.nodesById[e.source]
                const tNode = positioned.nodesById[e.target]
                if (sNode && tNode && sNode.category === "port" && tNode.category === "port") return null
                // draw line with arrow marker and relation label
                const mx = (s.x + t.x) / 2
                const my = (s.y + t.y) / 2
                const angle = Math.atan2(t.y - s.y, t.x - s.x) * (180 / Math.PI)
                return (
                  <g key={idx} opacity={selectedComponentIds.size ? (selectedEdgeIds.has(idx) ? 1 : 0.08) : 1}>
                    <line
                      x1={s.x}
                      y1={s.y}
                      x2={t.x}
                      y2={t.y}
                      strokeOpacity={0.9}
                      stroke="#9ca3af"
                      strokeWidth={1.8}
                      markerEnd="url(#arrow)"
                    />
                    {e.label && (() => {
                      const lbl = String(e.label || '')
                      const fontSize = 12
                      const approxCharWidth = 7
                      const padX = 8
                      const padY = 6
                      const textWidth = Math.max(24, lbl.length * approxCharWidth)
                      const boxW = textWidth + padX * 2
                      const boxH = fontSize + padY * 2
                      // normalize angle so text never appears upside-down
                      let angleDeg = angle
                      if (angleDeg > 90 || angleDeg < -90) {
                        angleDeg = angleDeg + 180
                      }
                      return (
                        <g transform={`translate(${mx}, ${my}) rotate(${angleDeg})`} pointerEvents="none">
                          {/* background box */}
                          <rect x={-boxW / 2} y={-boxH / 2} width={boxW} height={boxH} rx={6} fill="#0b1220" stroke="#233047" strokeWidth={1} />
                          {/* bold label text centered in box */}
                          <text x={0} y={0} fontSize={fontSize} fontWeight={800} fill="#f1f5f9" textAnchor="middle" dominantBaseline="middle" style={{ fontFamily: globalFontFamily }}>{lbl}</text>
                        </g>
                      )
                    })()}
                  </g>
                )
              })}
            </g>
          )}
          {/* nodes */}
          {Object.entries(posMap).map(([id, p]) => {
            const node = positioned.nodesById[id] || {}
            const displayLabel = node.category === "port" && node.service ? `${node.number || node.label}${node.service ? ", " + node.service : ""}` : node.label
            const isHighlighted = highlightedSet.size > 0 ? highlightedSet.has(id) : false
            const dim = highlightedSet.size > 0 && !isHighlighted
            // Always show labels (Neo4j-like) but reserve highlight styling
            const showLabel = true
            return (
              <g
                key={id}
                transform={`translate(${p.x}, ${p.y})`}
                style={{ cursor: "pointer" }}
                onPointerEnter={() => setHoveredNodeId(id)}
                onPointerLeave={() => setHoveredNodeId((cur) => (cur === id ? null : cur))}
                onDoubleClick={() => {
                  // open screenshot preview for subdomain nodes
                  if (node && node.category === "subdomain") {
                    openScreenshotForNode(node, id)
                  }
                }}
                onClick={(e) => {
                  // single click -> select node (dock inspector); double-click handled above or via detail===2
                  if (e && e.detail === 2 && node && node.category === "subdomain") {
                    openScreenshotForNode(node, id)
                    return
                  }
                  if (e && e.detail === 1) {
                    setSelectedNodeId(id)
                  }
                }}
                onPointerDown={(ev) => {
                  // register press; start drag only if pointer moves beyond threshold
                  ev.stopPropagation()
                  const svg = svgRef.current
                  if (!svg) return
                  const rect = svg.getBoundingClientRect()
                  if (!rect.width || !rect.height) return
                  const clientSvgX = ((ev.clientX - rect.left) / rect.width) * layoutWidth
                  const clientSvgY = ((ev.clientY - rect.top) / rect.height) * layoutHeight
                  if (!Number.isFinite(clientSvgX) || !Number.isFinite(clientSvgY)) return
                  const startWorldX = (clientSvgX - pan.x) / scale
                  const startWorldY = (clientSvgY - pan.y) / scale
                  pressRef.current = {
                    id,
                    pointerId: ev.pointerId,
                    startClientWorldX: startWorldX,
                    startClientWorldY: startWorldY,
                    startNodeX: p.x,
                    startNodeY: p.y,
                    startClientSvgX: clientSvgX,
                    startClientSvgY: clientSvgY,
                    moved: false,
                    ts: Date.now(),
                  }
                  try { svg.setPointerCapture(ev.pointerId) } catch (err) {}
                }}
              >
                {/* Card-style node */}
                {(() => {
                  const card = cardSizeFor(node.category)
                  const cardW = card.w
                  const cardH = card.h
                  const halfW = cardW / 2
                  const halfH = cardH / 2
                  // border color per category (reuse colorFor)
                  const borderColor = colorFor(node.category)
                  const bg = '#0b1220'
                  const opacityVal = selectedComponentIds.size ? (selectedComponentIds.has(id) ? 1 : 0.12) : (dim ? 0.12 : 1)
                  // text area (no inline screenshot by default)
                  const textX = -halfW + 12
                  const textWidth = cardW - 24
                  // compute max chars based on width (approx)
                  const approxCharWidth = 7
                  const maxCharsPerLine = Math.max(6, Math.floor(textWidth / approxCharWidth))
                  // build two-line truncated text starting from beginning
                  const full = String(displayLabel || '')
                  let line1 = full.slice(0, maxCharsPerLine)
                  let line2 = ''
                  if (full.length > maxCharsPerLine) {
                    line2 = full.slice(maxCharsPerLine, maxCharsPerLine * 2)
                    if (full.length > maxCharsPerLine * 2) {
                      // truncate with ellipsis
                      line2 = line2.slice(0, Math.max(0, maxCharsPerLine - 1)) + '…'
                    }
                  }
                  const linesToRender = line2 ? [line1, line2] : [line1]
                  return (
                    <g>
                      <rect
                        x={-halfW}
                        y={-halfH}
                        width={cardW}
                        height={cardH}
                        rx={12}
                        fill={bg}
                        stroke={borderColor}
                        strokeWidth={isHighlighted ? 2.2 : 1.4}
                        opacity={opacityVal}
                        style={{ cursor: 'pointer' }}
                      />
                      {/* alive status tag */}
                      {(() => {
                        const isPort = node.category === "port"
                        const statusVal = String(node.status || "").toLowerCase()
                        const portIsOpen = statusVal === "open"
                        const aliveColor = isPort
                          ? (portIsOpen ? "#22c55e" : "#ef4444")
                          : (node.alive === true ? "#22c55e" : (node.alive === false ? "#ef4444" : "#94a3b8"))
                        const tagSize = 10
                        const tagX = halfW - tagSize - 8
                        const tagY = -halfH + 8
                        return (
                          <rect
                            x={tagX}
                            y={tagY}
                            width={tagSize}
                            height={tagSize}
                            rx={3}
                            fill={aliveColor}
                            stroke="#0b1220"
                            strokeWidth={1}
                            opacity={opacityVal}
                          />
                        )
                      })()}
                      {/* label text (up to two lines), centered inside card */}
                      {showLabel && (
                        <text x={0} y={linesToRender.length === 2 ? -6 : 0} fontSize={16} fill={isHighlighted ? '#fff' : '#e6eef6'} textAnchor='middle' style={{ fontFamily: globalFontFamily, pointerEvents: 'none' }}>
                          {linesToRender.map((ln, i) => (
                            <tspan key={i} x={0} dy={i === 0 ? 0 : 18}>{ln}</tspan>
                          ))}
                        </text>
                      )}
                    </g>
                  )
                })()}
                <title>
                  {displayLabel} — {node.category}
                  {node.alive !== null ? ` — alive: ${node.alive}` : ""}
                </title>
              </g>
            )
          })}
          {/* Screenshot modal omitted from inside SVG; it will be rendered outside the SVG element for reliability. */}
          {/* Hover tooltip (in world coords) */}
          {hoveredNodeId && (() => {
            try {
              const p = posMap[hoveredNodeId]
              const node = positioned.nodesById && positioned.nodesById[hoveredNodeId]
              if (!p || !node) return null
              // ensure numeric positions
              if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null

              const lines = []
              if (node.category === "domain" || node.category === "subdomain") {
                if (node.label) lines.push(String(node.label))
              } else if (node.category === "ip") {
                if (node.label) lines.push(`IP: ${String(node.label)}`)
              } else if (node.category === "port") {
                if (node.label) lines.push(String(node.label))
                if (node.number !== undefined && node.number !== null) lines.push(`Port: ${String(node.number)}`)
                if (node.service) lines.push(`Service: ${String(node.service)}`)
              } else {
                if (node.label) lines.push(String(node.label))
              }
              if (node.alive !== undefined && node.alive !== null) lines.push(`Alive: ${String(node.alive)}`)
              if (node.status) lines.push(`Status: ${String(node.status)}`)

              if (lines.length === 0) return null

              const boxW = 220
              const boxH = 12 + lines.length * 18 + 8
              // place tooltip slightly below and to the right of node
              let tx = p.x + 12
              let ty = p.y + 16
              if (!Number.isFinite(tx) || !Number.isFinite(ty)) return null

              // clamp tooltip to a reasonable world coordinate range
              tx = Math.max(-10000, Math.min(10000, tx))
              ty = Math.max(-10000, Math.min(10000, ty))

              return (
                <g key={`tt-${hoveredNodeId}`} transform={`translate(${tx}, ${ty})`} pointerEvents="none">
                  <rect x={0} y={0} width={boxW} height={boxH} rx={8} fill="#0b1220" stroke="#233047" />
                  {lines.map((ln, i) => (
                    <text key={i} x={8} y={16 + i * 18} fontSize={13} fill="#e6eef6">{ln}</text>
                  ))}
                </g>
              )
            } catch (err) {
              // don't let tooltip errors crash the whole canvas
              console.warn('tooltip render error', err)
              return null
            }
          })()}
        </g>
      </svg>
      {/* Render combined screenshot + details modal for domain/subdomain */}
      {screenshotUrl && selectedNode && selectedIsScreenshotNode && (
        <ScreenshotDetailModal
          url={screenshotUrl}
          error={screenshotError}
          onClose={() => { setScreenshotUrl(null); setScreenshotError(null) }}
          onError={() => setScreenshotError(true)}
          title={previewTitle}
          node={selectedNode}
          related={getRelatedForSelected()}
        />
      )}
      {/* Docked Node inspector similar to Neo4j's side panel */}
      {selectedNode && !selectedIsScreenshotNode && (
        <DraggableWindow
          initialPosition={inspectorInitialPos}
          style={{ width: 360, maxHeight: "80vh", overflow: "auto", background: "rgba(3,7,18,0.95)", color: "#e6eef6", borderRadius: 8, boxShadow: "0 8px 30px rgba(0,0,0,0.6)", border: "1px solid #233047" }}
          headerStyle={{ padding: "8px 10px", borderBottom: "1px solid #233047", background: "rgba(3,7,18,0.98)", borderTopLeftRadius: 8, borderTopRightRadius: 8 }}
          bodyStyle={{ padding: 12 }}
          header={(
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{selectedNode.label || selectedNodeId}</div>
              <div>
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setSelectedNodeId(null)}
                  style={{ marginLeft: 8, padding: "6px 10px", borderRadius: 6, background: "#111827", color: "#fff", border: "none" }}
                >
                  Close
                </button>
              </div>
            </div>
          )}
        >
          <div style={{ marginTop: 8 }}>
            {/* gather related nodes and edges to pass into NodeCard */}
            {(() => {
              const { relNodes, relEdges } = getRelatedForSelected()
              return <NodeCard node={selectedNode} relatedNodes={relNodes} relatedEdges={relEdges} />
            })()}
          </div>
        </DraggableWindow>
      )}
    </div>
  )
}

// Render screenshot + details modal using internal state
// Note: this relies on the exported ScreenshotModal component above
// but we render it here via portal-like inclusion
// (React will mount it as part of the same component tree)
// No changes needed outside this file.
// The actual modal is rendered by returning it as an adjacent element.
// (Because we can't return two siblings from the function directly, we rely on the caller to render modal via export.)

// Render screenshot modal via a small helper component below to avoid SVG foreignObject issues
export function ScreenshotDetailModal({ url, error, onClose, onError, title, node, related }) {
  if (!url) return null
  const initialPos = (() => {
    if (typeof window === "undefined") return { x: 60, y: 60 }
    const w = window.innerWidth || 0
    const h = window.innerHeight || 0
    return { x: Math.max(20, Math.round(w * 0.5 - 320)), y: Math.max(20, Math.round(h * 0.5 - 240)) }
  })()
  const relNodes = (related && related.relNodes) || []
  const relEdges = (related && related.relEdges) || []
  return (
    <div role="dialog" aria-modal="true" style={{ position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2147483646, pointerEvents: 'auto' }} onKeyDown={(e) => { if (e.key === 'Escape') onClose() }} tabIndex={-1}>
      <DraggableWindow
        initialPosition={initialPos}
        style={{ background: "rgba(2,6,23,0.9)", borderRadius: 8, boxShadow: "0 8px 30px rgba(0,0,0,0.6)", maxWidth: "92vw", maxHeight: "90vh" }}
        headerStyle={{ padding: "8px 10px", borderBottom: "1px solid #233047", background: "rgba(2,6,23,0.98)", borderTopLeftRadius: 8, borderTopRightRadius: 8 }}
        bodyStyle={{ padding: 12 }}
        zIndex={2147483647}
        header={(
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ color: "#e6eef6", fontWeight: 600 }}>{title || "Preview"}</div>
            <div>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={onClose}
                style={{ marginLeft: 8, padding: "6px 10px", borderRadius: 6, background: "#111827", color: "#fff", border: "none" }}
              >
                Close
              </button>
            </div>
          </div>
        )}
      >
        <div style={{ display: "flex", gap: 12, width: "100%", maxHeight: "78vh" }}>
          <div style={{ flex: 1, minWidth: 360, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {!error ? (
              <img src={url} alt="screenshot" style={{ maxWidth: "54vw", maxHeight: "78vh", borderRadius: 6, border: "1px solid #233047" }} onError={() => onError && onError()} />
            ) : (
              <div style={{ color: "#e5e7eb", padding: 18 }}>No screenshot for this domain or subdomain.</div>
            )}
          </div>
          <div style={{ width: 360, maxHeight: "78vh", overflow: "auto", background: "rgba(3,7,18,0.95)", color: "#e6eef6", borderRadius: 8, border: "1px solid #233047", padding: 12 }}>
            <NodeCard node={node} relatedNodes={relNodes} relatedEdges={relEdges} />
          </div>
        </div>
      </DraggableWindow>
    </div>
  )
}
