import axios from "axios"

export const API_BASE = "http://127.0.0.1:8000"

export async function startScan(domain) {
  const res = await axios.post(`${API_BASE}/api/scan`, {
    domain: domain
  })

  return res
}

export function connectWebSocket(onMessage) {
  const ws = new WebSocket("ws://127.0.0.1:8000/ws")

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data)
    onMessage(data)
  }

  return ws
}
