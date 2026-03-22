import React, { memo } from "react"
import { Handle, Position } from "reactflow"

const CATEGORY_COLORS = {
  domain: "#f59e0b",
  subdomain: "#3b82f6",
  ip: "#a855f7",
  port: "#14b8a6",
}

const CATEGORY_SIZES = {
  domain: { width: 220, height: 72 },
  subdomain: { width: 190, height: 64 },
  ip: { width: 160, height: 56 },
  port: { width: 140, height: 50 },
}

function mixHex(hexA, hexB, weightA = 0.25) {
  const norm = (h) => h.replace("#", "")
  const a = norm(hexA)
  const b = norm(hexB)
  const toInt = (v) => parseInt(v, 16)
  const clamp = (n) => Math.max(0, Math.min(255, n))
  const mix = (i) => {
    const av = toInt(a.slice(i, i + 2))
    const bv = toInt(b.slice(i, i + 2))
    return clamp(Math.round(av * weightA + bv * (1 - weightA)))
  }
  const r = mix(0).toString(16).padStart(2, "0")
  const g = mix(2).toString(16).padStart(2, "0")
  const bch = mix(4).toString(16).padStart(2, "0")
  return `#${r}${g}${bch}`
}

function getDisplayLabel(node) {
  if (!node) return ""
  if (node.category === "port" && node.service) {
    return `${node.number || node.label}${node.service ? ", " + node.service : ""}`
  }
  return node.label || ""
}

function getAliveColor(node) {
  if (node.category === "port") {
    const st = String(node.status || "").toLowerCase()
    return st === "open" ? "#22c55e" : "#ef4444"
  }
  if (node.alive === true) return "#22c55e"
  if (node.alive === false) return "#ef4444"
  return "#94a3b8"
}

function GraphNode({ data }) {
  const { category, highlighted, dimmed, onDoubleClick } = data
  const borderColor = CATEGORY_COLORS[category] || "#94a3b8"
  const bg = mixHex(borderColor, "#0b1220", 0.25)
  const size = CATEGORY_SIZES[category] || { width: 180, height: 60 }
  const label = getDisplayLabel(data)
  const aliveColor = getAliveColor(data)

  const handleStyle = {
    background: "transparent",
    border: "none",
    width: 8,
    height: 8,
  }

  return (
    <div
      onDoubleClick={onDoubleClick}
      style={{
        width: size.width,
        height: size.height,
        background: bg,
        border: `${highlighted ? 2.5 : 1.5}px solid ${highlighted ? "#fff" : borderColor}`,
        borderRadius: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        opacity: dimmed ? 0.08 : 1,
        cursor: "pointer",
        transition: "opacity 0.2s, border-color 0.2s",
        boxShadow: highlighted
          ? `0 0 16px ${borderColor}40`
          : "0 2px 8px rgba(0,0,0,0.3)",
      }}
    >
      <Handle type="target" position={Position.Top} style={handleStyle} />

      {/* Alive/Open status dot */}
      <div
        style={{
          position: "absolute",
          top: 8,
          right: 10,
          width: 10,
          height: 10,
          borderRadius: 3,
          background: aliveColor,
          border: "1px solid #0b1220",
        }}
      />

      {/* Category badge */}
      <div
        style={{
          position: "absolute",
          top: 6,
          left: 10,
          fontSize: 9,
          fontWeight: 700,
          color: borderColor,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          opacity: 0.8,
        }}
      >
        {category}
      </div>

      {/* Label */}
      <div
        style={{
          color: highlighted ? "#fff" : "#e6eef6",
          fontSize: category === "domain" ? 15 : 13,
          fontWeight: category === "domain" ? 700 : 600,
          textAlign: "center",
          padding: "0 12px",
          marginTop: 6,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: size.width - 24,
          fontFamily:
            "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
        title={label}
      >
        {label}
      </div>

      <Handle type="source" position={Position.Bottom} style={handleStyle} />
    </div>
  )
}

export default memo(GraphNode)
export { CATEGORY_COLORS, CATEGORY_SIZES, getDisplayLabel }
