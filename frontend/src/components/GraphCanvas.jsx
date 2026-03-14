import React, { useMemo, useState, useRef, useEffect } from "react"
import Button from "./ui/Button"
import "../styles/ui.css"
import NodeCard from "./NodeCard"
import DraggableWindow from "./DraggableWindow"
import { GLOBAL_FONT_FAMILY, computeLayout } from "./GraphCanvas.helpers"
import { NoNodesOverlay, EdgesLayer, NodesLayer, HoverTooltip } from "./GraphCanvas.layers"

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
  const globalFontFamily = GLOBAL_FONT_FAMILY
  const highlightedSet = useMemo(() => new Set(highlightIds || []), [highlightIds])
  // Hierarchical, parent-centered layout similar to Neo4j
  const positioned = useMemo(() => computeLayout(data, padding), [data, padding])

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
    // Merge newly computed layout positions with any existing user-modified positions.
    // Previously we overwrote positionsState whenever `data` changed which discarded
    // manual drags. Instead, keep prior positions (if any) and only fill in missing
    // entries from the computed layout so Clear/filter actions don't reset user
    // adjustments.
    setPositionsState((prev) => {
      const base = positioned.positions || {}
      if (!prev || Object.keys(prev).length === 0) return base
      // prefer previously stored (user) positions and add base for new nodes
      return { ...base, ...prev }
    })
  }, [positioned.positions])

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
  const nodesById = positioned.nodesById || {}

  const handleNodePointerEnter = (id) => setHoveredNodeId(id)
  const handleNodePointerLeave = (id) => setHoveredNodeId((cur) => (cur === id ? null : cur))
  const handleNodeDoubleClick = (id, node) => {
    if (node && node.category === "subdomain") {
      openScreenshotForNode(node, id)
    }
  }
  const handleNodeClick = (e, id, node) => {
    if (e && e.detail === 2 && node && node.category === "subdomain") {
      openScreenshotForNode(node, id)
      return
    }
    if (e && e.detail === 1) {
      setSelectedNodeId(id)
    }
  }
  const handleNodePointerDown = (ev, id, p) => {
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
  }

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
    // Recenter on the root domain node.
    const svg = svgRef.current
    const container = svg && svg.parentElement
    const rect = container ? container.getBoundingClientRect() : null
    const viewportW = rect && rect.width ? rect.width : (typeof window !== "undefined" ? window.innerWidth : layoutWidth)
    const viewportH = rect && rect.height ? rect.height : (typeof window !== "undefined" ? window.innerHeight : layoutHeight)

    const domainNode = (nodes || []).find((n) => n.category === "domain")
    const domainPos = domainNode && posMap[domainNode.id]
    const nextScale = 1

    let nextPan = { x: 0, y: 0 }
    if (domainPos) {
      nextPan = {
        x: viewportW / (2 * nextScale) - domainPos.x,
        y: viewportH / (2 * nextScale) - domainPos.y,
      }
    }

    setPan(nextPan)
    setScale(nextScale)
    setPositionsState(positioned.positions || {})
    panRef.current = nextPan
    scaleRef.current = nextScale
    panTargetRef.current = nextPan
    scaleTargetRef.current = nextScale
  }

  return (
    <div style={{ width: "100%", height: "100vh", position: "relative" }}>
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
          {nodesCount === 0 && <NoNodesOverlay layoutWidth={layoutWidth} layoutHeight={layoutHeight} globalFontFamily={globalFontFamily} />}
          <EdgesLayer
            edges={edges}
            posMap={posMap}
            nodesById={nodesById}
            selectedComponentIds={selectedComponentIds}
            selectedEdgeIds={selectedEdgeIds}
            hasHighlights={hasHighlights}
            globalFontFamily={globalFontFamily}
          />
          <NodesLayer
            posMap={posMap}
            nodesById={nodesById}
            highlightedSet={highlightedSet}
            selectedComponentIds={selectedComponentIds}
            selectedEdgeIds={selectedEdgeIds}
            onNodePointerEnter={handleNodePointerEnter}
            onNodePointerLeave={handleNodePointerLeave}
            onNodeDoubleClick={handleNodeDoubleClick}
            onNodeClick={handleNodeClick}
            onNodePointerDown={handleNodePointerDown}
            globalFontFamily={globalFontFamily}
          />
          <HoverTooltip hoveredNodeId={hoveredNodeId} posMap={posMap} nodesById={nodesById} />
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
