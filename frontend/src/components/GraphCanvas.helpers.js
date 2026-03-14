const GLOBAL_FONT_FAMILY = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif"

const cardSizeFor = (category) => {
  if (category === "domain") return { w: 260, h: 120 }
  if (category === "subdomain") return { w: 220, h: 100 }
  if (category === "ip") return { w: 180, h: 80 }
  if (category === "port") return { w: 140, h: 64 }
  return { w: 200, h: 88 }
}

const colorFor = (category) => {
  if (category === "domain") return "#f59e0b" // amber
  if (category === "subdomain") return "#3b82f6" // blue
  if (category === "ip") return "#a855f7" // purple
  if (category === "port") return "#14b8a6" // teal
  return "#94a3b8" // slate
}

const mixHex = (hexA, hexB, weightA = 0.25) => {
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

const computeLayout = (data, padding) => {
  const { nodes = [], edges = [] } = data || {}
  const positions = {}
  const nodesById = nodes.reduce((m, n) => ((m[n.id] = n), m), {})

  const childMap = {}
  const parentMap = {}
  edges.forEach((e) => {
    if (!e || !e.source || !e.target) return
    const lab = String(e.label || "").toUpperCase()
    const isHier = ["HAS_SUBDOMAIN", "RESOLVES_TO", "HAS_PORT"].includes(lab)
    if (!isHier) return
    const src = e.source
    const tgt = e.target
    childMap[src] = childMap[src] || []
    childMap[src].push(tgt)
    parentMap[tgt] = parentMap[tgt] || []
    parentMap[tgt].push(src)
  })

  const cardForId = (id) => {
    const n = nodesById[id]
    return cardSizeFor(n && n.category)
  }

  const minGapX = 40
  const minGapY = 80
  const pad = padding

  const widthMemo = new Map()
  const visiting = new Set()
  const subtreeWidth = (id) => {
    if (widthMemo.has(id)) return widthMemo.get(id)
    if (visiting.has(id)) {
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
      if (la < lb) return -1
      if (la > lb) return 1
      if (a < b) return -1
      if (a > b) return 1
      return 0
    })
    const card = cardForId(id)
    const cardW = card.w
    const cardH = card.h
    levelHeights[depth] = Math.max(levelHeights[depth] || 0, cardH)

    if (!kids.length) {
      const x = cursorX + cardW / 2
      const y = pad + depth * (Math.max(...Object.values(levelHeights || { 0: cardH })) + minGapY) + cardH / 2
      positions[id] = { x, y }
      cursorX += cardW + minGapX
      return
    }

    const totalKidsWidth = kids.reduce((s, c) => s + subtreeWidth(c), 0)
    const startX = cursorX
    kids.forEach((c) => placeSubtree(c, depth + 1))
    const childXs = kids.map((c) => positions[c].x)
    const minChildX = Math.min(...childXs)
    const maxChildX = Math.max(...childXs)
    const x = (minChildX + maxChildX) / 2
    const y = pad + depth * (Math.max(...Object.values(levelHeights || { 0: cardH })) + minGapY) + cardH / 2
    positions[id] = { x, y }
    cursorX = Math.max(cursorX, startX + totalKidsWidth)
  }

  effectiveRoots.forEach((r) => {
    if (!nodesById[r]) return
    placeSubtree(r, 0)
    cursorX += minGapX
  })

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
  const layoutHeight = Math.max(700, pad * 2 + (maxDepth + 1) * (Math.max(...Object.values(levelHeights || { 0: 120 })) + minGapY) + 200)

  return { positions, nodesById, layoutWidth, layoutHeight }
}

const getDisplayLabel = (node) => {
  if (!node) return ""
  if (node.category === "port" && node.service) {
    return `${node.number || node.label}${node.service ? ", " + node.service : ""}`
  }
  return node.label || ""
}

const buildTextLines = (fullText, maxCharsPerLine) => {
  const full = String(fullText || "")
  let line1 = full.slice(0, maxCharsPerLine)
  let line2 = ""
  if (full.length > maxCharsPerLine) {
    line2 = full.slice(maxCharsPerLine, maxCharsPerLine * 2)
    if (full.length > maxCharsPerLine * 2) {
      line2 = line2.slice(0, Math.max(0, maxCharsPerLine - 1)) + "…"
    }
  }
  return line2 ? [line1, line2] : [line1]
}

const getTooltipLines = (node) => {
  const lines = []
  if (!node) return lines
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
  return lines
}

export {
  GLOBAL_FONT_FAMILY,
  cardSizeFor,
  colorFor,
  mixHex,
  computeLayout,
  getDisplayLabel,
  buildTextLines,
  getTooltipLines,
}
