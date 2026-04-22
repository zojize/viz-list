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

/**
 * Absolute zoom bounds. Below MIN_ZOOM items collapse into unreadable dots;
 *  above MAX_ZOOM fonts alias badly and interactions feel unresponsive.
 */
const MIN_ZOOM = 0.25
const MAX_ZOOM = 4

export function usePannableCanvas(options: UsePannableCanvasOptions) {
  const { canvasRef, hasContent } = options

  const panOffset = reactive<PanState>({ x: 0, y: 0 })
  /**
   * Content scale. Applied on contentRef as `scale(zoom)` after the
   *  `translate(pan)` — so `pan` stays in screen pixels regardless of zoom
   *  and existing drag/pan math stays in screen space.
   */
  const zoom = shallowRef(1)
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

  /**
   * Returns the transient drag offset for an item (non-zero only while dragging that item).
   *  Stored in screen pixels but divided by zoom before use — children live in content
   *  coordinates, so at zoom 2x a 100px screen drag translates to 50 content px.
   */
  function getDragDelta(key: string): PanState {
    if (activeKey.value === key) {
      const z = zoom.value
      return { x: activeDelta.value.x / z, y: activeDelta.value.y / z }
    }
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
      // Descale: delta is stored in screen pixels but consumers treat the
      // committed offset as content-space coordinates.
      const z = zoom.value
      options.onDragEnd?.(activeKey.value, delta.x / z, delta.y / z)
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

  /**
   * Clamp panOffset so content stays partially visible.
   *
   *  Math reminder: the child render transform is `translate(pan) scale(z)`,
   *  applied right-to-left. A content-space point `p` renders at
   *  `pan + p*z` in screen pixels. So bounds in content space are multiplied
   *  by zoom when compared with screen-space pan and viewport dimensions.
   */
  function clampPan() {
    const bounds = options.contentBounds?.()
    const canvas = canvasRef.value
    if (!bounds || !canvas)
      return
    const z = zoom.value
    const cw = canvas.clientWidth
    const ch = canvas.clientHeight
    // Margin also lives in content space — scale along with bounds so the
    // same-looking cushion is preserved across zoom levels.
    const marginX = Math.max(bounds.maxItemW / 2, 50) * z
    const marginY = Math.max(bounds.maxItemH / 2, 50) * z

    const minPanX = marginX - bounds.maxX * z
    const maxPanX = cw - marginX - bounds.minX * z
    const minPanY = marginY - bounds.maxY * z
    const maxPanY = ch - marginY - bounds.minY * z

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

  /**
   * Change zoom while keeping a screen-space focal point anchored to the
   *  same content-space point. Without this, zooming drifts content away
   *  from the pointer and feels like a pan+scale combo.
   *
   *  Derivation: content point `c` renders at `pan + c*z`. To keep `c`
   *  under focal point `f` across a zoom change (z → z'), we need
   *  `f = pan' + c*z'`. Substituting `c = (f - pan)/z` and solving:
   *  `pan' = f - (f - pan) * (z'/z)`.
   */
  function setZoom(next: number, focalScreenX?: number, focalScreenY?: number) {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next))
    if (clamped === zoom.value)
      return
    const canvas = canvasRef.value
    let fx: number
    let fy: number
    if (focalScreenX != null && focalScreenY != null && canvas) {
      const rect = canvas.getBoundingClientRect()
      fx = focalScreenX - rect.left
      fy = focalScreenY - rect.top
    }
    else if (canvas) {
      fx = canvas.clientWidth / 2
      fy = canvas.clientHeight / 2
    }
    else {
      fx = 0
      fy = 0
    }
    const ratio = clamped / zoom.value
    panOffset.x = fx - (fx - panOffset.x) * ratio
    panOffset.y = fy - (fy - panOffset.y) * ratio
    zoom.value = clamped
    clampPan()
  }

  /**
   * One-step zoom for buttons / keyboard. 1.25x feels responsive but not
   *  jumpy; matches the step Figma uses for `+`/`-`.
   */
  const ZOOM_STEP = 1.25
  function zoomIn(focalScreenX?: number, focalScreenY?: number) {
    setZoom(zoom.value * ZOOM_STEP, focalScreenX, focalScreenY)
  }
  function zoomOut(focalScreenX?: number, focalScreenY?: number) {
    setZoom(zoom.value / ZOOM_STEP, focalScreenX, focalScreenY)
  }
  function resetZoom() {
    setZoom(1)
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault()
    // Modifier-held wheel = zoom. Browser trackpad pinch also fires wheel
    // events with ctrlKey=true on every platform, so this handles both the
    // Cmd/Ctrl+scroll mouse gesture and native pinch. Plain scroll stays as
    // pan — we don't want to repurpose the main navigation gesture.
    if (e.ctrlKey || e.metaKey) {
      // Exponential mapping so constant wheel delta gives constant visual
      // zoom rate (additive zoom feels slow at high zoom, fast at low).
      // 0.0015 ≈ ~1.08x per notch on a typical mouse wheel, matching
      // common canvas apps.
      const factor = Math.exp(-e.deltaY * 0.0015)
      setZoom(zoom.value * factor, e.clientX, e.clientY)
      return
    }
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
    zoom: readonly(zoom),
    isPanning: readonly(isPanning),
    didDrag: readonly(didDrag),
    getDragDelta,
    panToElement,
    resetPan,
    clampPan,
    cancelDrag,
    getActiveDragKey,
    setZoom,
    zoomIn,
    zoomOut,
    resetZoom,
  }
}
