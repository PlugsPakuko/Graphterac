function NodeCard({ node, relatedNodes = [], relatedEdges = [] }) {
  if (!node) return null

  return (
    <div className="node-card">
      <h3 style={{ margin: 0 }}>{node.label}</h3>
      <div style={{ marginTop: 8 }}>
        {node.ip && <div><strong>IP:</strong> {node.ip}</div>}
        {node.number !== undefined && <div><strong>Port:</strong> {node.number}</div>}
        {node.service && <div><strong>Service:</strong> {node.service}</div>}
        {node.category && <div><strong>Category:</strong> {node.category}</div>}
        {node.status && <div><strong>Status:</strong> {node.status}</div>}
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
              <li key={n.id}>{n.label || n.id} <small style={{ color: '#94a3b8' }}>({n.category})</small></li>
            ))}
          </ul>
        </div>
      )}

      {relatedEdges && relatedEdges.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <strong>Relations</strong>
          <ul>
            {relatedEdges.map((e, i) => (
              <li key={i}>{e.label || 'relation'} — <small style={{ color: '#94a3b8' }}>{e.source} → {e.target}</small></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default NodeCard
