function NodeCard({ node, relatedNodes = [], relatedEdges = [] }) {
  if (!node) return null

  // helper: title-case simple words
  const title = (s) => {
    if (!s) return s
    return String(s)
      .replace(/[-_]/g, ' ')
      .split(' ')
      .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
      .join(' ')
  }

  // map id -> node label for nicer relation rendering
  const idToLabel = {}
  relatedNodes.forEach((n) => {
    idToLabel[n.id] = n.label || n.id
  })
  // ensure current node is known
  idToLabel[node.id] = node.label || node.id

  // show port only when category indicates a port and a number exists
  const showPort = node.category && String(node.category).toLowerCase().includes('port') && node.number !== undefined

  // filter relations: only include those that reference this node
  const filteredEdges = (relatedEdges || []).filter((e) => e && (e.source === node.id || e.target === node.id))

  const humanizeRelation = (label) => {
    if (!label) return 'relation'
    return title(label.replace(/^HAS_|^RESOLVES_TO_|^TO_/, ''))
  }

  const renderEndpoint = (id) => {
    const label = idToLabel[id] || id
    const isSelf = id === node.id
    // color for this node's type: prefer explicit node.color, fallback to category mapping
    const getColorForCategory = (cat) => {
      if (!cat) return '#e2e8f0'
      const c = String(cat).toLowerCase()
      const map = {
        domain: '#f97316', // orange
        subdomain: '#60a5fa', // blue
        ip: '#7c3aed', // purple
        port: '#34d399', // green
        default: '#94a3b8',
      }
      // simple contains checks to be forgiving
      if (c.includes('domain')) return map.domain
      if (c.includes('subdomain')) return map.subdomain
      if (c.includes('ip')) return map.ip
      if (c.includes('port')) return map.port
      if (c.includes('service')) return map.service
      return map.default
    }

    const highlightColor = node && node.color ? node.color : getColorForCategory(node && node.category)

    return (
      <span style={{ color: isSelf ? highlightColor : '#94a3b8', fontWeight: isSelf ? 700 : 400 }}>
        {isSelf ? (<strong>{label}</strong>) : label}
      </span>
    )
  }

  return (
    <div className="panel" style={{ padding: 12 }}>
      <h3 style={{ margin: 0 }}>{node.label}</h3>
      <div style={{ marginTop: 8, color: '#e6eef6' }}>
        {node.ip && <div><strong>IP:</strong> {node.ip}</div>}
        {showPort && <div><strong>Port:</strong> {node.number}</div>}
        {node.service && <div><strong>Service:</strong> {title(node.service)}</div>}
        {node.category && <div><strong>Category:</strong> {title(node.category)}</div>}
        {node.status && <div><strong>Status:</strong> {title(node.status)}</div>}
      </div>

      {node.screenshot && (
        <div style={{ marginTop: 10 }}>
          <img src={node.screenshot} alt="service screenshot" width="300" style={{ borderRadius: 6 }} />
        </div>
      )}

      {relatedNodes && relatedNodes.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <strong>Related nodes</strong>
          <ul>
            {relatedNodes.map((n) => (
              <li key={n.id}>
                {n.label || n.id} <small style={{ color: '#94a3b8' }}>({title(n.category)})</small>
              </li>
            ))}
          </ul>
        </div>
      )}

      {filteredEdges && filteredEdges.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <strong>Relations</strong>
          <ul>
            {filteredEdges.map((e, i) => (
              <li key={i}>
                {humanizeRelation(e.label)}: <small style={{ color: '#94a3b8' }}>{renderEndpoint(e.source)} {' → '} {renderEndpoint(e.target)}</small>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default NodeCard
