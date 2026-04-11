import type { ShallowRef } from 'vue'
import { useEventListener, useResizeObserver } from '@vueuse/core'
import { nextTick, reactive, readonly, shallowRef } from 'vue'

interface PanState {
  x: number
  y: number
}

interface DragState {
  key: string
  pointerId: number
}

interface ContentBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  maxItemW: number
  maxItemH: number
}

interface UsePannableCanvasOptions {
  /** Ref to the canvas container element */
  canvasRef: ShallowRef<HTMLElement | null>
  /** Whether the canvas has content (disable pan when empty) */
  hasContent: () => boolean
  /** Called when a drag ends. Receives the key and the total drag delta (dx, dy). */
  onDragEnd?: (key: string, dx: number, dy: number) => void
  /** Returns the bounding box of all content for pan clamping. Null = no content. */
  contentBounds?: () => ContentBounds | null
}

export function usePannableCanvas(options: UsePannableCanvasOptions) {
  const { canvasRef, hasContent } = options

  const panOffset = reactive<PanState>({ x: 0, y: 0 })
  const isPanning = shallowRef(false)
  const panStart = reactive({ x: 0, y: 0, ox: 0, oy: 0 })

  // ---- Draggable items ----
  // During drag, activeDelta tracks the visual offset from the item's base position.
  // On drop, the delta is reported via onDragEnd so the caller can commit it.

  const activeKey = shallowRef<string | null>(null)
  const activeDelta = shallowRef<PanState>({ x: 0, y: 0 })
  const dragging = shallowRef<DragState | null>(null)
  const dragStart = reactive({ x: 0, y: 0 })
  const didDrag = shallowRef(false)

  /** Returns the transient drag offset for an item (non-zero only while dragging that item). */
  function getDragDelta(key: string): PanState {
    if (activeKey.value === key)
      return activeDelta.value
    return { x: 0, y: 0 }
  }

  /** Find the drag key for an element via data-drag-key attribute */
  function getDragKey(el: HTMLElement): string | null {
    const container = el.closest('[data-drag-key]') as HTMLElement | null
    return container?.dataset.dragKey ?? null
  }

  function onPointerDown(e: PointerEvent) {
    if (!hasContent())
      return

    // Left-click on a draggable item → prepare drag
    if (e.button === 0) {
      const dragKey = getDragKey(e.target as HTMLElement)
      if (dragKey) {
        dragging.value = { key: dragKey, pointerId: e.pointerId }
        dragStart.x = e.clientX
        dragStart.y = e.clientY
        return
      }
    }

    // Middle-click anywhere, or left-click on empty canvas → pan
    // Skip interactive elements (buttons, links) so their click handlers work
    if (e.button === 1 || (e.button === 0 && !(e.target as HTMLElement).closest('button, a'))) {
      isPanning.value = true
      panStart.x = e.clientX
      panStart.y = e.clientY
      panStart.ox = panOffset.x
      panStart.oy = panOffset.y
      canvasRef.value?.setPointerCapture(e.pointerId)
      e.preventDefault()
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (dragging.value) {
      const dx = e.clientX - dragStart.x
      const dy = e.clientY - dragStart.y
      if (Math.abs(dx) >= 4 || Math.abs(dy) >= 4) {
        if (!didDrag.value) {
          didDrag.value = true
          activeKey.value = dragging.value.key
          canvasRef.value?.setPointerCapture(e.pointerId)
        }
        activeDelta.value = { x: dx, y: dy }
      }
      return
    }
    if (isPanning.value) {
      panOffset.x = panStart.ox + (e.clientX - panStart.x)
      panOffset.y = panStart.oy + (e.clientY - panStart.y)
      clampPan()
    }
  }

  function onPointerUp() {
    if (activeKey.value && didDrag.value) {
      const delta = activeDelta.value
      options.onDragEnd?.(activeKey.value, delta.x, delta.y)
    }
    activeKey.value = null
    activeDelta.value = { x: 0, y: 0 }
    isPanning.value = false
    dragging.value = null
    nextTick(() => {
      didDrag.value = false
    })
  }

  /**
   * Auto-pan to make a target element visible. Only moves if clipped. X-axis first, then Y.
   *  Waits for layout to settle (e.g. sibling splitpanes resizing) before measuring.
   */
  function panToElement(selector: string) {
    if (!canvasRef.value)
      return
    // Wait for Vue updates + browser layout (sibling panels may resize)
    nextTick(() => requestAnimationFrame(() => {
      const el = canvasRef.value?.querySelector(selector) as HTMLElement | null
      if (!el || !canvasRef.value)
        return
      const container = canvasRef.value.getBoundingClientRect()
      const node = el.getBoundingClientRect()

      const margin = 16
      const clippedLeft = node.left < container.left + margin
      const clippedRight = node.right > container.right - margin
      const clippedTop = node.top < container.top + margin
      const clippedBottom = node.bottom > container.bottom - margin

      if (!clippedLeft && !clippedRight && !clippedTop && !clippedBottom)
        return

      // Nudge just enough to bring the element within the margin
      if (clippedLeft)
        panOffset.x += (container.left + margin) - node.left
      else if (clippedRight)
        panOffset.x -= node.right - (container.right - margin)

      if (clippedTop)
        panOffset.y += (container.top + margin) - node.top
      else if (clippedBottom)
        panOffset.y -= node.bottom - (container.bottom - margin)
    }))
  }

  /** Clamp panOffset so content stays partially visible. */
  function clampPan() {
    const bounds = options.contentBounds?.()
    const canvas = canvasRef.value
    if (!bounds || !canvas)
      return
    const cw = canvas.clientWidth
    const ch = canvas.clientHeight
    const marginX = Math.max(bounds.maxItemW / 2, 50)
    const marginY = Math.max(bounds.maxItemH / 2, 50)

    const minPanX = marginX - bounds.maxX
    const maxPanX = cw - marginX - bounds.minX
    const minPanY = marginY - bounds.maxY
    const maxPanY = ch - marginY - bounds.minY

    if (minPanX <= maxPanX)
      panOffset.x = Math.max(minPanX, Math.min(maxPanX, panOffset.x))
    if (minPanY <= maxPanY)
      panOffset.y = Math.max(minPanY, Math.min(maxPanY, panOffset.y))
  }

  function resetPan() {
    panOffset.x = 0
    panOffset.y = 0
  }

  /** Cancel any active drag without committing the delta. */
  function cancelDrag() {
    activeKey.value = null
    activeDelta.value = { x: 0, y: 0 }
    dragging.value = null
    didDrag.value = false
  }

  /** Returns the key of the item currently being dragged, or null. */
  function getActiveDragKey(): string | null {
    return activeKey.value
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault()
    panOffset.x -= e.deltaX
    panOffset.y -= e.deltaY
    clampPan()
  }

  // Wire all events to the canvas element
  useEventListener(canvasRef, 'pointerdown', onPointerDown)
  useEventListener(canvasRef, 'pointermove', onPointerMove)
  useEventListener(canvasRef, 'pointerup', onPointerUp)
  useEventListener(canvasRef, 'pointercancel', onPointerUp)
  useEventListener(canvasRef, 'wheel', onWheel, { passive: false })

  // Re-clamp when the canvas resizes (splitpane drag, detail panel toggle)
  useResizeObserver(canvasRef, () => clampPan())

  return {
    panOffset,
    isPanning: readonly(isPanning),
    didDrag: readonly(didDrag),
    getDragDelta,
    panToElement,
    resetPan,
    clampPan,
    cancelDrag,
    getActiveDragKey,
  }
}
