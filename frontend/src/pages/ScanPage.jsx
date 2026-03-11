import { useState, useMemo } from "react"
import GraphCanvas from "../components/GraphCanvas"
import { startScan } from "../api/api"
import DraggableWindow from "../components/DraggableWindow"
import Button from "../components/ui/Button"
import Input from "../components/ui/Input"
import "../styles/flowsint.css"
import "../styles/ui.css"

export default function ScanPage() {
  const [domain, setDomain] = useState("")
  const [scannedDomain, setScannedDomain] = useState("")
  const [controlsOpen, setControlsOpen] = useState(true)
  const [data, setData] = useState({ nodes: [], edges: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState("")
  const [highlightIds, setHighlightIds] = useState([])
  const [clearSelectionFlag, setClearSelectionFlag] = useState(0)
  const [filters, setFilters] = useState({ domain: true, subdomain: true, ip: true, port: true })
  // toggle to show only alive nodes when true
  const [aliveOnly, setAliveOnly] = useState(false)

  const toggleFilter = (key) => setFilters((s) => ({ ...s, [key]: !s[key] }))

  const filteredData = useMemo(() => {
    const nodes = (data.nodes || []).filter((n) => {
      if (!n || !n.category) return true
      // first, respect category filters
      if (n.category === "domain" && !filters.domain) return false
      if (n.category === "subdomain" && !filters.subdomain) return false
      if (n.category === "ip" && !filters.ip) return false
      if (n.category === "port" && !filters.port) return false
      // then, if aliveOnly is enabled, require alive === true for all nodes
      if (aliveOnly) return n.alive === true
      return true
    })

    const nodeIds = new Set(nodes.map((n) => n.id))
    const edges = (data.edges || []).filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    return { nodes, edges }
  }, [filters, data, aliveOnly])

  const handleSearch = () => {
    const q = (search || "").trim().toLowerCase()
    if (!q) {
      setHighlightIds([])
      return
    }
    const found = (data.nodes || []).find((n) => (n.label || "").toLowerCase().includes(q))
    if (found) {
      // find all nodes matching the query
      const matches = (data.nodes || []).filter((n) => (n.label || "").toLowerCase().includes(q))
      const ids = matches.map((m) => m.id)
      // ensure matching categories are visible
      const cats = matches.reduce((acc, m) => (acc.add(m.category), acc), new Set())
      setFilters((s) => {
        const copy = { ...s }
        cats.forEach((c) => (copy[c] = true))
        return copy
      })
      setHighlightIds(ids)
    } else {
      setHighlightIds([])
    }
  }

  const handleScan = async () => {
    const q = (domain || "").trim()
    if (!q) return
    setLoading(true)
    setError(null)
    try {
      const res = await startScan(q)
      // axios returns response object with .data
      const payload = res && res.data ? res.data : res
      setData({ nodes: payload.nodes || [], edges: payload.edges || [] })
      setScannedDomain(q)
      // clear highlight
      setHighlightIds([])
    } catch (err) {
      console.error(err)
      setError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ background: "#0b1020", minHeight: "100vh", padding: 20, color: "#e5e7eb" }}>

      {/* SilkGraph title fixed at top-center */}
      <div style={{ position: "fixed", left: 0, right: 0, top: 16, pointerEvents: "none", zIndex: 10001 }}>
        <div style={{ textAlign: "center", fontSize: 20, color: "#f8fafc", fontWeight: 600, textShadow: "0 1px 0 rgba(0,0,0,0.7)" }}>SilkGraph</div>
      </div>

      {/* Always-visible controls toggle */}
      <div style={{ position: 'fixed', right: 16, top: 16, zIndex: 2147483647, pointerEvents: 'auto' }}>
        <Button onClick={() => setControlsOpen((s) => !s)} className="btn-ghost">
          {controlsOpen ? "Hide controls" : "Show controls"}
        </Button>
      </div>

      {controlsOpen && (
        <DraggableWindow
          initialPosition={{ x: 16, y: 56 }}
          style={{ background: "rgba(7,16,36,0.95)", borderRadius: 8, boxShadow: "0 6px 18px rgba(0,0,0,0.6)", border: "1px solid #233047", pointerEvents: "auto" }}
          headerStyle={{ padding: "6px 10px", fontWeight: 600, color: "#e6eef6", borderBottom: "1px solid #233047", background: "rgba(7,16,36,0.98)", borderTopLeftRadius: 8, borderTopRightRadius: 8 }}
          bodyStyle={{ padding: 12 }}
          header={<div>Controls</div>}
        >
          {error && (
            <div style={{ marginBottom: 10 }} className="panel" >
              <div style={{ color: "#fecaca", background: "rgba(127,29,29,0.15)", padding: "8px", borderRadius: 6 }}>{error}</div>
            </div>
          )}
          <div className="controls-row">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="domain.example" />
              <Button onClick={handleScan} disabled={loading || !domain}>
                {loading ? 'Scanning…' : 'Scan'}
              </Button>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find node by name" />
              <Button onClick={handleSearch}>Find</Button>
              <Button onClick={() => { setSearch(''); setHighlightIds([]); setFilters({ domain: true, subdomain: true, ip: true, port: true }); setAliveOnly(false); setClearSelectionFlag((v) => v + 1) }} variant="ghost">Clear</Button>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: '#e5e7eb' }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={filters.domain} onChange={() => toggleFilter('domain')} /> Domain
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={filters.subdomain} onChange={() => toggleFilter('subdomain')} /> Subdomain
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={filters.ip} onChange={() => toggleFilter('ip')} /> IP
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={filters.port} onChange={() => toggleFilter('port')} /> PORT
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={aliveOnly} onChange={() => setAliveOnly((s) => !s)} /> Alive
              </label>
            </div>
          </div>
        </DraggableWindow>
      )}

      <div style={{ marginTop: 12 }}>
        <GraphCanvas data={filteredData} width={3000} height={2000} highlightIds={highlightIds} screenshotDomain={scannedDomain} clearSelectionFlag={clearSelectionFlag} />
      </div>
    </div>
  )
}
