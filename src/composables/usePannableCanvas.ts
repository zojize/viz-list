import type { ShallowRef } from 'vue'
import { refThrottled } from '@vueuse/core'
import { nextTick, reactive, readonly, shallowRef } from 'vue'

interface PanState {
  x: number
  y: number
}

interface DragState {
  key: string
  pointerId: number
}

interface UsePannableCanvasOptions {
  /** Ref to the canvas container element */
  canvasRef: ShallowRef<HTMLElement | null>
  /** Whether the canvas has content (disable pan when empty) */
  hasContent: () => boolean
}

export function usePannableCanvas(options: UsePannableCanvasOptions) {
  const { canvasRef, hasContent } = options

  const panOffset = reactive<PanState>({ x: 0, y: 0 })
  const isPanning = shallowRef(false)
  const panStart = reactive({ x: 0, y: 0, ox: 0, oy: 0 })

  // ---- Draggable items ----
  // Committed offsets are plain (non-reactive) — only read on mount or after drop.
  // The actively-dragging item's offset is tracked separately so only that item re-renders.

  const committedOffsets = new Map<string, PanState>()
  const activeKey = shallowRef<string | null>(null)
  const activeDelta = shallowRef<PanState>({ x: 0, y: 0 })
  const debouncedDelta = refThrottled(activeDelta, 50)
  const dragging = shallowRef<DragState | null>(null)
  const dragStart = reactive({ x: 0, y: 0, ox: 0, oy: 0 })
  const didDrag = shallowRef(false)
  /** Bumped on drop to trigger a one-time re-read of committed offsets */
  const offsetVersion = shallowRef(0)

  function getDragOffset(key: string): PanState {
    if (activeKey.value === key)
      return debouncedDelta.value
    // eslint-disable-next-line ts/no-unused-expressions
    offsetVersion.value // track dependency — re-read when version bumps on drop
    return committedOffsets.get(key) ?? { x: 0, y: 0 }
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
        const offset = committedOffsets.get(dragKey) ?? { x: 0, y: 0 }
        dragStart.x = e.clientX
        dragStart.y = e.clientY
        dragStart.ox = offset.x
        dragStart.oy = offset.y
        return
      }
    }

    // Middle-click anywhere, or left-click on empty canvas → pan
    if (e.button === 1 || e.button === 0) {
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
        // Only update activeDelta — only the dragging item re-renders
        activeDelta.value = { x: dragStart.ox + dx, y: dragStart.oy + dy }
      }
      return
    }
    if (isPanning.value) {
      panOffset.x = panStart.ox + (e.clientX - panStart.x)
      panOffset.y = panStart.oy + (e.clientY - panStart.y)
    }
  }

  function onPointerUp() {
    // Commit drag offset to the plain map
    if (activeKey.value) {
      committedOffsets.set(activeKey.value, { ...activeDelta.value })
      activeKey.value = null
      offsetVersion.value++
    }
    isPanning.value = false
    dragging.value = null
    nextTick(() => {
      didDrag.value = false
    })
  }

  /** Auto-pan to make a target element visible. Only moves if clipped. X-axis first, then Y. */
  function panToElement(selector: string) {
    if (!canvasRef.value)
      return
    nextTick(() => nextTick(() => {
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

      if (clippedLeft || clippedRight) {
        const nodeXInContent = node.left - container.left - panOffset.x
        panOffset.x = -(nodeXInContent - container.width / 2 + node.width / 2)
      }
      if (clippedTop || clippedBottom) {
        const nodeYInContent = node.top - container.top - panOffset.y
        panOffset.y = -(nodeYInContent - container.height / 2 + node.height / 2)
      }
    }))
  }

  return {
    panOffset,
    isPanning: readonly(isPanning),
    didDrag: readonly(didDrag),
    getDragOffset,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    panToElement,
  }
}
