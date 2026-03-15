import React from "react"
import { buildTextLines, cardSizeFor, colorFor, getDisplayLabel, getTooltipLines, mixHex } from "./GraphCanvas.helpers"

function NoNodesOverlay({ layoutWidth, layoutHeight, globalFontFamily }) {
  return (
    <g>
      <rect x={0} y={0} width={layoutWidth} height={layoutHeight} fill="rgba(7,16,36,0.0)" />
      <text x={layoutWidth / 2} y={layoutHeight / 2} textAnchor="middle" fontSize={18} fill="#94a3b8" style={{ fontFamily: globalFontFamily }}>
        {"No nodes to display — run a scan or load data"}
      </text>
    </g>
  )
}

function EdgesLayer({ edges, posMap, nodesById, selectedComponentIds, selectedEdgeIds, hasHighlights, globalFontFamily }) {
  const selectionActive = selectedComponentIds && selectedComponentIds.size
  if (hasHighlights && !selectionActive) return null
  return (
    <g stroke="#374151" strokeWidth="1">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto" markerUnits="strokeWidth">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#9ca3af" />
        </marker>
      </defs>
      {edges.map((e, idx) => {
        const s = posMap[e.source]
        const t = posMap[e.target]
        // only draw edges when both endpoints have positional data
        if (!s || !t) return null
        const sNode = nodesById[e.source]
        const tNode = nodesById[e.target]
        // only draw edges when both node objects exist in the current dataset
        if (!sNode || !tNode) return null
        if (sNode.category === "port" && tNode.category === "port") return null
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
              const lbl = String(e.label || "")
              const fontSize = 12
              const approxCharWidth = 7
              const padX = 8
              const padY = 6
              const textWidth = Math.max(24, lbl.length * approxCharWidth)
              const boxW = textWidth + padX * 2
              const boxH = fontSize + padY * 2
              let angleDeg = angle
              if (angleDeg > 90 || angleDeg < -90) {
                angleDeg = angleDeg + 180
              }
              return (
                <g transform={`translate(${mx}, ${my}) rotate(${angleDeg})`} pointerEvents="none">
                  <rect x={-boxW / 2} y={-boxH / 2} width={boxW} height={boxH} rx={6} fill="#0b1220" stroke="#233047" strokeWidth={1} />
                  <text x={0} y={0} fontSize={fontSize} fontWeight={800} fill="#f1f5f9" textAnchor="middle" dominantBaseline="middle" style={{ fontFamily: globalFontFamily }}>{lbl}</text>
                </g>
              )
            })()}
          </g>
        )
      })}
    </g>
  )
}

function NodeCardSVG({ node, displayLabel, isHighlighted, globalFontFamily }) {
  const card = cardSizeFor(node.category)
  const cardW = card.w
  const cardH = card.h
  const halfW = cardW / 2
  const halfH = cardH / 2
  const borderColor = colorFor(node.category)
  const bg = mixHex(borderColor, "#0b1220", 0.25)
  const textWidth = cardW - 24
  const approxCharWidth = 7
  const maxCharsPerLine = Math.max(6, Math.floor(textWidth / approxCharWidth))
  const linesToRender = buildTextLines(displayLabel, maxCharsPerLine)
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
        opacity={1}
        style={{ cursor: "pointer" }}
      />
      <rect
        x={tagX}
        y={tagY}
        width={tagSize}
        height={tagSize}
        rx={3}
        fill={aliveColor}
        stroke="#0b1220"
        strokeWidth={1}
        opacity={1}
      />
      <text x={0} y={linesToRender.length === 2 ? -6 : 0} fontSize={16} fill={isHighlighted ? "#fff" : "#e6eef6"} textAnchor="middle" style={{ fontFamily: globalFontFamily, pointerEvents: "none" }}>
        {linesToRender.map((ln, i) => (
          <tspan key={i} x={0} dy={i === 0 ? 0 : 18}>{ln}</tspan>
        ))}
      </text>
    </g>
  )
}

function NodesLayer({
  posMap,
  nodesById,
  highlightedSet,
  selectedComponentIds,
  selectedEdgeIds,
  onNodePointerEnter,
  onNodePointerLeave,
  onNodeDoubleClick,
  onNodeClick,
  onNodePointerDown,
  globalFontFamily,
}) {
  return (
    <g>
      {Object.entries(nodesById).map(([id, node]) => {
        const p = posMap[id]
        // only render nodes that have an available position
        if (!p) return null
        const displayLabel = getDisplayLabel(node)
        // Determine whether a selection (component) or a highlight (search) is active.
        const selectionActive = selectedComponentIds && selectedComponentIds.size
        const highlightActive = highlightedSet && highlightedSet.size
        let isHighlighted = false
        if (selectionActive) {
          // when a node component is selected, highlight its component members
          isHighlighted = selectedComponentIds.has(id)
        } else if (highlightActive) {
          // when search/find highlights are present, use them
          isHighlighted = highlightedSet.has(id)
        } else {
          isHighlighted = false
        }

        // If either selection or highlight is active, dim non-matching nodes
        const nodeOpacity = selectionActive || highlightActive ? (isHighlighted ? 1 : 0.08) : 1

        return (
          <g
            key={id}
            transform={`translate(${p.x}, ${p.y})`}
            style={{ cursor: "pointer" }}
            onPointerEnter={() => onNodePointerEnter(id)}
            onPointerLeave={() => onNodePointerLeave(id)}
            onDoubleClick={() => onNodeDoubleClick(id, node)}
            onClick={(e) => onNodeClick(e, id, node)}
            onPointerDown={(ev) => onNodePointerDown(ev, id, p)}
            opacity={nodeOpacity}
          >
            <NodeCardSVG node={node} displayLabel={displayLabel} isHighlighted={isHighlighted} globalFontFamily={globalFontFamily} />
            <title>
              {displayLabel} — {node.category}
              {node.alive !== null ? ` — alive: ${node.alive}` : ""}
            </title>
          </g>
        )
      })}
    </g>
  )
}

function HoverTooltip({ hoveredNodeId, posMap, nodesById }) {
  if (!hoveredNodeId) return null
  try {
    const p = posMap[hoveredNodeId]
    const node = nodesById && nodesById[hoveredNodeId]
    if (!p || !node) return null
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null

    const lines = getTooltipLines(node)
    if (lines.length === 0) return null

    const boxW = 220
    const boxH = 12 + lines.length * 18 + 8
    let tx = p.x + 12
    let ty = p.y + 16
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return null

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
    console.warn("tooltip render error", err)
    return null
  }
}

export {
  NoNodesOverlay,
  EdgesLayer,
  NodesLayer,
  HoverTooltip,
}
