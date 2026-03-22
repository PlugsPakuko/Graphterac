import React, { useMemo, useState, useCallback, useEffect } from "react"
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
} from "reactflow"
import "reactflow/dist/style.css"

import GraphNode, { CATEGORY_COLORS, CATEGORY_SIZES } from "./GraphNode"
import GraphEdge from "./GraphEdge"
import NodeCard from "./NodeCard"
import DraggableWindow from "./DraggableWindow"
import Button from "./ui/Button"
import "../styles/ui.css"

const nodeTypes = { graphNode: GraphNode }
const edgeTypes = { graphEdge: GraphEdge }

// ── Layout algorithm (hierarchical tree) ────────────────────────────

function computeLayout(data) {
  const { nodes = [], edges = [] } = data || {}
  const nodesById = nodes.reduce((m, n) => ((m[n.id] = n), m), {})
  const positions = {}

  const childMap = {}
  const parentMap = {}
  edges.forEach((e) => {
    if (!e || !e.source || !e.target) return
    const lab = String(e.label || "").toUpperCase()
    if (!["HAS_SUBDOMAIN", "RESOLVES_TO", "HAS_PORT"].includes(lab)) return
    childMap[e.source] = childMap[e.source] || []
    childMap[e.source].push(e.target)
    parentMap[e.target] = parentMap[e.target] || []
    parentMap[e.target].push(e.source)
  })

  const sizeFor = (id) => {
    const n = nodesById[id]
    return CATEGORY_SIZES[(n && n.category)] || { width: 180, height: 60 }
  }

  const gapX = 40
  const gapY = 100
  const pad = 60

  // Memoized subtree width
  const widthMemo = new Map()
  const visiting = new Set()
  const subtreeWidth = (id) => {
    if (widthMemo.has(id)) return widthMemo.get(id)
    if (visiting.has(id)) {
      const w = sizeFor(id).width + gapX
      widthMemo.set(id, w)
      return w
    }
    visiting.add(id)
    const kids = (childMap[id] || []).filter((c) => nodesById[c])
    const w = kids.length === 0
      ? sizeFor(id).width + gapX
      : kids.reduce((sum, c) => sum + subtreeWidth(c), 0)
    widthMemo.set(id, w)
    visiting.delete(id)
    return w
  }

  // Leaf ordering for deterministic sort
  const leavesMemo = new Map()
  const leavesVisiting = new Set()
  const subtreeLeaves = (id) => {
    if (leavesMemo.has(id)) return leavesMemo.get(id)
    if (leavesVisiting.has(id)) return []
    leavesVisiting.add(id)
    const kids = (childMap[id] || []).filter((c) => nodesById[c])
    const out = kids.length === 0
      ? [id]
      : Array.from(new Set(kids.flatMap((c) => subtreeLeaves(c)))).sort()
    leavesMemo.set(id, out)
    leavesVisiting.delete(id)
    return out
  }

  const allIds = nodes.map((n) => n.id)
  const roots = allIds.filter((id) => !(parentMap[id] && parentMap[id].length))
  const effectiveRoots = roots.length ? roots : allIds.slice()

  let cursorX = pad
  let maxDepth = 0
  const levelHeights = {}

  const placeSubtree = (id, depth = 0) => {
    maxDepth = Math.max(maxDepth, depth)
    let kids = (childMap[id] || []).filter((c) => nodesById[c])
    kids = kids.slice().sort((a, b) => {
      const la = subtreeLeaves(a).join(",")
      const lb = subtreeLeaves(b).join(",")
      return la < lb ? -1 : la > lb ? 1 : a < b ? -1 : a > b ? 1 : 0
    })

    const size = sizeFor(id)
    levelHeights[depth] = Math.max(levelHeights[depth] || 0, size.height)

    if (!kids.length) {
      const x = cursorX
      const y = pad + depth * (Math.max(...Object.values(levelHeights)) + gapY)
      positions[id] = { x, y }
      cursorX += size.width + gapX
      return
    }

    const startX = cursorX
    kids.forEach((c) => placeSubtree(c, depth + 1))
    const childXs = kids.map((c) => positions[c].x + sizeFor(c).width / 2)
    const center = (Math.min(...childXs) + Math.max(...childXs)) / 2
    const x = center - size.width / 2
    const y = pad + depth * (Math.max(...Object.values(levelHeights)) + gapY)
    positions[id] = { x, y }
    const totalKidsWidth = kids.reduce((s, c) => s + subtreeWidth(c), 0)
    cursorX = Math.max(cursorX, startX + totalKidsWidth)
  }

  effectiveRoots.forEach((r) => {
    if (!nodesById[r]) return
    placeSubtree(r, 0)
    cursorX += gapX
  })

  // Place unplaced nodes
  const unplaced = allIds.filter((id) => !positions[id])
  if (unplaced.length) {
    const rowY = pad + (maxDepth + 1) * (Math.max(...Object.values(levelHeights || { 0: 120 })) + gapY) + 60
    unplaced.forEach((id) => {
      const size = sizeFor(id)
      positions[id] = { x: cursorX, y: rowY }
      cursorX += size.width + gapX
    })
  }

  // Center shared nodes under their parents
  const shared = allIds.filter((id) => (parentMap[id] || []).length > 1)
  shared.forEach((id) => {
    const parents = (parentMap[id] || []).filter((p) => positions[p])
    if (!parents.length) return
    const avg = parents.reduce((s, p) => s + positions[p].x + sizeFor(p).width / 2, 0) / parents.length
    const curX = positions[id].x + sizeFor(id).width / 2
    const dx = avg - curX
    if (Math.abs(dx) < 1) return
    // shift this subtree
    const shifted = new Set()
    const stack = [id]
    while (stack.length) {
      const cur = stack.pop()
      if (shifted.has(cur) || !positions[cur]) continue
      positions[cur].x += dx
      shifted.add(cur)
      ;(childMap[cur] || []).forEach((c) => stack.push(c))
    }
  })

  return { positions, nodesById }
}

// ── Convert data to React Flow format ───────────────────────────────

function buildFlowElements(data, highlightedSet, selectedComponentIds, selectedEdgeIds) {
  const { nodes: rawNodes = [], edges: rawEdges = [] } = data || {}
  const layout = computeLayout(data)
  const { positions, nodesById } = layout

  const hasHighlight = highlightedSet.size > 0
  const hasSelection = selectedComponentIds.size > 0

  const flowNodes = rawNodes.map((n) => {
    const pos = positions[n.id] || { x: 0, y: 0 }
    const size = CATEGORY_SIZES[n.category] || { width: 180, height: 60 }

    let highlighted = false
    let dimmed = false
    if (hasSelection) {
      highlighted = selectedComponentIds.has(n.id)
      dimmed = !highlighted
    } else if (hasHighlight) {
      highlighted = highlightedSet.has(n.id)
      dimmed = !highlighted
    }

    return {
      id: n.id,
      type: "graphNode",
      position: pos,
      data: {
        ...n,
        highlighted,
        dimmed,
      },
      style: { width: size.width, height: size.height },
      draggable: true,
    }
  })

  const flowEdges = rawEdges.map((e, idx) => {
    const sNode = nodesById[e.source]
    const tNode = nodesById[e.target]
    if (!sNode || !tNode) return null
    if (!positions[e.source] || !positions[e.target]) return null

    let dimmed = false
    if (hasSelection) {
      dimmed = !selectedEdgeIds.has(idx)
    } else if (hasHighlight) {
      dimmed = true
    }

    return {
      id: `e-${idx}-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      type: "graphEdge",
      data: { label: e.label || "", dimmed, edgeIndex: idx },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "#9ca3af",
        width: 16,
        height: 16,
      },
    }
  }).filter(Boolean)

  return { flowNodes, flowEdges, nodesById }
}

// ── Connected component BFS ─────────────────────────────────────────

function computeConnectedComponent(selectedId, edges) {
  if (!selectedId) return { nodeIds: new Set(), edgeIds: new Set() }

  const forwardAdj = {}
  const backwardAdj = {}
  edges.forEach((e, idx) => {
    forwardAdj[e.source] = forwardAdj[e.source] || []
    forwardAdj[e.source].push({ idx, to: e.target })
    backwardAdj[e.target] = backwardAdj[e.target] || []
    backwardAdj[e.target].push({ idx, from: e.source })
  })

  const nodeIds = new Set([selectedId])
  const edgeIds = new Set()

  // backward (ancestors)
  const bq = [selectedId]
  while (bq.length) {
    const cur = bq.shift()
    for (const it of backwardAdj[cur] || []) {
      if (!nodeIds.has(it.from)) {
        nodeIds.add(it.from)
        bq.push(it.from)
      }
      edgeIds.add(it.idx)
    }
  }

  // forward (descendants)
  const fq = [selectedId]
  while (fq.length) {
    const cur = fq.shift()
    for (const it of forwardAdj[cur] || []) {
      if (!nodeIds.has(it.to)) {
        nodeIds.add(it.to)
        fq.push(it.to)
      }
      edgeIds.add(it.idx)
    }
  }

  return { nodeIds, edgeIds }
}

// ── Main component ──────────────────────────────────────────────────

export default function GraphCanvas({
  data,
  highlightIds = [],
  screenshotDomain = "",
  clearSelectionFlag = 0,
}) {
  const [selectedNodeId, setSelectedNodeId] = useState(null)
  const [selectedComponentIds, setSelectedComponentIds] = useState(new Set())
  const [selectedEdgeIds, setSelectedEdgeIds] = useState(new Set())
  const [screenshotUrl, setScreenshotUrl] = useState(null)
  const [screenshotError, setScreenshotError] = useState(null)
  const [previewTitle, setPreviewTitle] = useState(null)

  const highlightedSet = useMemo(() => new Set(highlightIds || []), [highlightIds])
  const edges = useMemo(() => (data && data.edges) || [], [data])

  // Clear selection on parent request
  useEffect(() => {
    if (!clearSelectionFlag) return
    setSelectedNodeId(null)
    setSelectedComponentIds(new Set())
    setSelectedEdgeIds(new Set())
    setScreenshotUrl(null)
    setScreenshotError(null)
  }, [clearSelectionFlag])

  // Compute connected component when selection changes
  useEffect(() => {
    if (!selectedNodeId) {
      setSelectedComponentIds(new Set())
      setSelectedEdgeIds(new Set())
      return
    }
    const { nodeIds, edgeIds } = computeConnectedComponent(selectedNodeId, edges)
    setSelectedComponentIds(nodeIds)
    setSelectedEdgeIds(edgeIds)
  }, [selectedNodeId, edges])

  // Build React Flow elements
  const { flowNodes, flowEdges, nodesById } = useMemo(
    () => buildFlowElements(data, highlightedSet, selectedComponentIds, selectedEdgeIds),
    [data, highlightedSet, selectedComponentIds, selectedEdgeIds]
  )

  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes)
  const [rfEdges, setEdges, onEdgesChange] = useEdgesState(flowEdges)

  // Sync when flow elements change from data/selection updates
  useEffect(() => {
    setNodes(flowNodes)
    setEdges(flowEdges)
  }, [flowNodes, flowEdges, setNodes, setEdges])

  const buildScreenshotUrl = useCallback((label) => {
    const fname = String(label || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") + ".png"
    if (!screenshotDomain) return null
    return `/backend/projects/${encodeURIComponent(screenshotDomain)}/screenshot/${fname}`
  }, [screenshotDomain])

  const openScreenshotForNode = useCallback((node) => {
    const label = (node && (node.label || node.id)) || ""
    const url = buildScreenshotUrl(label)
    setScreenshotError(null)
    setPreviewTitle(label)
    if (!url) {
      setScreenshotError(true)
      setScreenshotUrl(null)
      return
    }
    setScreenshotUrl(url)
  }, [buildScreenshotUrl])

  const onNodeClick = useCallback((_event, node) => {
    setSelectedNodeId(node.id)
    const nodeData = node.data
    if (nodeData && (nodeData.category === "domain" || nodeData.category === "subdomain")) {
      openScreenshotForNode(nodeData)
    }
  }, [openScreenshotForNode])

  const onNodeDoubleClick = useCallback((_event, node) => {
    if (node.data && node.data.category === "subdomain") {
      openScreenshotForNode(node.data)
    }
  }, [openScreenshotForNode])

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null)
    setScreenshotUrl(null)
    setScreenshotError(null)
  }, [])

  // Inspector panel
  const selectedNode = selectedNodeId && nodesById ? nodesById[selectedNodeId] : null
  const selectedIsScreenshotNode = selectedNode && (selectedNode.category === "domain" || selectedNode.category === "subdomain")

  const inspectorInitialPos = useMemo(() => {
    if (typeof window === "undefined") return { x: 12, y: 80 }
    const panelW = 360
    const pad = 12
    const x = Math.max(pad, (window.innerWidth || 0) - panelW - pad)
    return { x, y: 80 }
  }, [])

  const getRelatedForSelected = useCallback(() => {
    const relNodes = []
    const relEdges = []
    if (selectedComponentIds.size && nodesById) {
      for (const nid of selectedComponentIds) {
        if (nodesById[nid]) relNodes.push(nodesById[nid])
      }
    }
    if (selectedEdgeIds.size) {
      selectedEdgeIds.forEach((eid) => {
        if (edges[eid]) relEdges.push(edges[eid])
      })
    }
    return { relNodes, relEdges }
  }, [selectedComponentIds, selectedEdgeIds, nodesById, edges])

  const miniMapNodeColor = useCallback((node) => {
    return CATEGORY_COLORS[node.data?.category] || "#94a3b8"
  }, [])

  const nodesCount = (data && data.nodes && data.nodes.length) || 0

  return (
    <div style={{ width: "100%", height: "100vh", position: "relative" }}>
      <ReactFlow
        nodes={nodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={4}
        defaultEdgeOptions={{ type: "graphEdge" }}
        proOptions={{ hideAttribution: true }}
        style={{ background: "#071024" }}
      >
        <Background color="#1e293b" gap={40} size={1} />
        <Controls
          showInteractive={false}
          style={{
            background: "#0b1220",
            border: "1px solid #233047",
            borderRadius: 8,
          }}
        />
        <MiniMap
          nodeColor={miniMapNodeColor}
          maskColor="rgba(7, 16, 36, 0.85)"
          style={{
            background: "#0b1220",
            border: "1px solid #233047",
            borderRadius: 8,
          }}
        />
      </ReactFlow>

      {/* Empty state */}
      {nodesCount === 0 && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            color: "#94a3b8",
            fontSize: 18,
            pointerEvents: "none",
            fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          }}
        >
          No nodes to display — run a scan or load data
        </div>
      )}

      {/* Screenshot + details modal for domain/subdomain */}
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

      {/* Node inspector panel for non-screenshot nodes */}
      {selectedNode && !selectedIsScreenshotNode && (
        <DraggableWindow
          initialPosition={inspectorInitialPos}
          style={{
            width: 360,
            maxHeight: "80vh",
            overflow: "auto",
            background: "rgba(3,7,18,0.95)",
            color: "#e6eef6",
            borderRadius: 8,
            boxShadow: "0 8px 30px rgba(0,0,0,0.6)",
            border: "1px solid #233047",
          }}
          headerStyle={{
            padding: "8px 10px",
            borderBottom: "1px solid #233047",
            background: "rgba(3,7,18,0.98)",
            borderTopLeftRadius: 8,
            borderTopRightRadius: 8,
          }}
          bodyStyle={{ padding: 12 }}
          header={
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{selectedNode.label || selectedNodeId}</div>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setSelectedNodeId(null)}
                style={{
                  marginLeft: 8,
                  padding: "6px 10px",
                  borderRadius: 6,
                  background: "#111827",
                  color: "#fff",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          }
        >
          <div style={{ marginTop: 8 }}>
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

// ── Screenshot detail modal ─────────────────────────────────────────

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
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        left: 0, top: 0, right: 0, bottom: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2147483646,
        pointerEvents: "auto",
      }}
      onKeyDown={(e) => { if (e.key === "Escape") onClose() }}
      tabIndex={-1}
    >
      <DraggableWindow
        initialPosition={initialPos}
        style={{
          background: "rgba(2,6,23,0.9)",
          borderRadius: 8,
          boxShadow: "0 8px 30px rgba(0,0,0,0.6)",
          maxWidth: "92vw",
          maxHeight: "90vh",
        }}
        headerStyle={{
          padding: "8px 10px",
          borderBottom: "1px solid #233047",
          background: "rgba(2,6,23,0.98)",
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8,
        }}
        bodyStyle={{ padding: 12 }}
        zIndex={2147483647}
        header={
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ color: "#e6eef6", fontWeight: 600 }}>{title || "Preview"}</div>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onClose}
              style={{
                marginLeft: 8,
                padding: "6px 10px",
                borderRadius: 6,
                background: "#111827",
                color: "#fff",
                border: "none",
                cursor: "pointer",
              }}
            >
              Close
            </button>
          </div>
        }
      >
        <div style={{ display: "flex", gap: 12, width: "100%", maxHeight: "78vh" }}>
          <div style={{ flex: 1, minWidth: 360, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {!error ? (
              <img
                src={url}
                alt="screenshot"
                style={{ maxWidth: "54vw", maxHeight: "78vh", borderRadius: 6, border: "1px solid #233047" }}
                onError={() => onError && onError()}
              />
            ) : (
              <div style={{ color: "#e5e7eb", padding: 18 }}>No screenshot for this domain or subdomain.</div>
            )}
          </div>
          <div style={{
            width: 360,
            maxHeight: "78vh",
            overflow: "auto",
            background: "rgba(3,7,18,0.95)",
            color: "#e6eef6",
            borderRadius: 8,
            border: "1px solid #233047",
            padding: 12,
          }}>
            <NodeCard node={node} relatedNodes={relNodes} relatedEdges={relEdges} />
          </div>
        </div>
      </DraggableWindow>
    </div>
  )
}
