import { useCallback, useEffect, useRef, useState } from "react"

import '../styles/ui.css'

export default function DraggableWindow({
  header,
  children,
  initialPosition = { x: 40, y: 40 },
  boundsPadding = 8,
  style = {},
  headerStyle = {},
  bodyStyle = {},
  zIndex = 2147483647,
  className = '',
}) {
  const [pos, setPos] = useState(initialPosition)
  const dragRef = useRef(null)
  const wrapperRef = useRef(null)

  const onPointerMove = useCallback((e) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    const rawX = drag.startPos.x + dx
    const rawY = drag.startPos.y + dy

    const vw = window.innerWidth || 0
    const vh = window.innerHeight || 0
    const maxX = Math.max(boundsPadding, vw - drag.width - boundsPadding)
    const maxY = Math.max(boundsPadding, vh - drag.height - boundsPadding)
    const nextX = Math.min(Math.max(boundsPadding, rawX), maxX)
    const nextY = Math.min(Math.max(boundsPadding, rawY), maxY)

    setPos({ x: nextX, y: nextY })
  }, [boundsPadding])

  const onPointerUp = useCallback(() => {
    dragRef.current = null
    window.removeEventListener("pointermove", onPointerMove)
    window.removeEventListener("pointerup", onPointerUp)
  }, [onPointerMove])

  const onPointerDown = useCallback((e) => {
    if (e.button !== 0) return
    e.preventDefault()
    const rect = wrapperRef.current ? wrapperRef.current.getBoundingClientRect() : { width: 0, height: 0 }
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPos: pos,
      width: rect.width,
      height: rect.height,
    }
    window.addEventListener("pointermove", onPointerMove)
    window.addEventListener("pointerup", onPointerUp)
  }, [onPointerMove, onPointerUp, pos])

  useEffect(() => () => {
    window.removeEventListener("pointermove", onPointerMove)
    window.removeEventListener("pointerup", onPointerUp)
  }, [onPointerMove, onPointerUp])

  return (
    <div ref={wrapperRef} style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex, ...style }} className={className}>
      <div
        onPointerDown={onPointerDown}
        style={{ cursor: 'move', touchAction: 'none', userSelect: 'none', ...headerStyle }}
        className="panel"
      >
        {header}
      </div>
      <div style={bodyStyle}>
        {children}
      </div>
    </div>
  )
}
