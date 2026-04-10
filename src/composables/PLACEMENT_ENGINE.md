# Tree-Aware Placement Engine

Technical documentation for the data structure canvas layout system.

## Architecture Overview

The DS canvas uses three composables working together:

```
usePointerGraph (graph analysis)
        |
        v
usePlacementEngine (position management)
        |
        v
usePannableCanvas (viewport + drag)
```

Orchestrated by `DataStructureView.vue`, which renders items and arrows.

## Pointer Graph Analysis (`usePointerGraph.ts`)

Runs as a `computed` reactive to `context.memory.version`. On each interpreter step:

1. **Scan**: Find all live struct header cells (any region). A header cell is where
   `cell.address === value.base` for struct values.

2. **Edge building**: For each struct, look up its definition in `context.structs`.
   For each pointer-typed field pointing to another live struct, record a `PointerEdge`.
   If the target cell is dead, record a `DanglingEdge` instead.

3. **Tree detection** via in-degree + DFS:
   - Nodes with in-degree 0 from other structs = tree roots
   - Nodes with in-degree 1 = potential tree children
   - Nodes with in-degree > 1 = shared (excluded from tree layout)
   - DFS from each root detects cycles (back-edges)
   - A valid tree: every non-root has exactly 1 in-edge from within the tree

4. **Output**: `{ nodes, trees, standalone, danglingEdges }`

The graph is **generic** --- it works with any struct that has pointer fields to other
structs (BST, AVL, trie, linked list, etc.). No struct names are hardcoded.

## Placement Engine (`usePlacementEngine.ts`)

Manages absolute `{x, y}` positions for canvas items. Positions persist across renders
and are only recalculated when items first appear or auto-layout is triggered.

### Key state

- `positions: Map<key, {x, y}>` --- committed positions
- `sizes: Map<key, {w, h}>` --- measured DOM dimensions
- `userDragged: Set<key>` --- items manually repositioned by user

### Placement strategies

**`placeNew(key, w, h)`** --- For new items (chains, standalone variables, tree roots).
Finds empty space in the visible viewport via `findEmptySpace`. Returns early if the
item already has a position (idempotent across re-renders).

**`placeRelative(key, parentKey, w, h, childIndex, siblingHeights)`** --- For tree
children. Computes ideal position to the right of the parent:

- X = parent.x + parent.w + arrowGap (60px default)
- Y = centered among siblings relative to parent's vertical center
- Returns early if already positioned (respects user drags and prior placement)

**`findEmptySpace(w, h, occupied, container)`** --- Two-pass scan:

1. Try to fit within visible viewport (candidate Y rows x sliding X)
2. Wide items (chains) that exceed viewport width: place at origin X, find clear Y row
3. Fallback: place below all existing items

**`displaceAndPlace(key, x, y, w, h)`** --- Conflict resolution. Removes overlapping
items, places the target, then re-places displaced items via `findEmptySpace`.

### Collision detection

`rectsOverlap(a, b)` checks axis-aligned overlap with a `gap` margin (default 16px)
on all sides. This ensures items never touch --- there's always visual breathing room.

### User drag tracking

- `markUserDragged(key)` --- called by `onDragEnd` callback
- Items in `userDragged` keep their position through re-renders
- `clearUserDragged()` --- called by auto-layout to reset everything

### Auto-layout (`clear()`)

Wipes all positions, sizes, and user-drag state. The next `onUpdated` cycle re-measures
all DOM elements and re-places everything from scratch with tree-aware layout.

## Canvas Arrows (`CanvasArrow.vue`)

SVG arrows rendered inside the panned `contentRef` container, so they move with pan
automatically. Positioned AFTER items in DOM order with `z-10` to paint on top.

### Rendering

- **Normal edges**: Solid blue cubic bezier from parent's right edge to
  child's left edge center. Triangle arrowhead at the end.
- **Cycle edges**: Dashed amber line with back-arrow icon.
- **Dangling edges**: Dashed red stub with X mark and stale address label.

The SVG uses `h-[1px] w-[1px] overflow-visible` instead of `h-0 w-0` because browsers
skip painting zero-area SVG elements even with overflow:visible.

### Arrow start position

Each arrow starts at the exact Y position of the AddressLink field it stems from,
not the center of the parent card. This is achieved by:

1. `DSValue.vue` adds `data-field-addr` attributes to struct field rows
2. `DataStructureView.measureFieldY()` queries the DOM for the field element,
   computes its vertical center offset relative to the parent card
3. The Y offset is passed to `CanvasArrow` as `fromFieldY`

This means the arrow from `left: 0xff8` visually stems from the `left` row,
and the arrow from `right: 0xff4` stems from the `right` row.

### Hover interaction

Invisible 12px-wide stroke hit area over each arrow. On hover, emits `hoverField`
with the pointer field's memory address, which propagates to MemoryMap for
field highlighting. Color brightens on hover via reactive `strokeColor` computed.

## Tree structure change detection

`DataStructureView` tracks two maps across render cycles:

- `prevChildToParent: Map<childKey, parentKey>` --- which parent each child belongs to
- `prevParentToChildren: Map<parentKey, Set<childKey>>` --- sibling groups

On each `measureAndPlace`, the current maps are diffed against the previous ones.
Positions are invalidated (removed) when:

1. A node's **parent changed** (reassigned to a different parent)
2. A node **entered a tree** (was standalone, now has a tree parent)
3. A node's **sibling group changed** (a sibling was added or removed) ---
   ALL siblings of the affected parent are invalidated so `placeRelative`
   recalculates the entire group as a centered unit

User-dragged items are never invalidated. This ensures manual positioning is
preserved while the rest of the tree adapts around it.

## Data flow per render cycle

```
Interpreter step
  -> context.memory.version++
  -> usePointerGraph recomputes (trees, edges, dangling)
  -> DataStructureView re-renders items
  -> onUpdated fires
    -> nextTick
      -> measureAndPlace()
        1. Measure all [data-place-key] elements via offsetWidth/offsetHeight
        2. Diff tree parent + sibling maps, invalidate stale positions
        3. Place tree roots via placeNew (idempotent)
        4. Place tree children via placeRelative (idempotent)
        5. Place remaining items via placeNew (idempotent)
        6. retainOnly active keys (cleanup dead items)
      -> autoPanToContent() if content bounds changed and items overflow
      -> clampPan() to keep content visible
  -> arrowEdges computed reacts to placement.version
    -> CanvasArrow components render with positions from placement engine
```

## Drag flow

```
pointerdown on [data-drag-key] element
  -> track start position, prepare drag state
pointermove (4px threshold crossed)
  -> set activeKey, capture pointer
  -> activeDelta updated continuously (transient visual offset)
  -> getItemStyle() combines committed position + activeDelta -> GPU transform
pointerup
  -> onDragEnd callback fires
    -> placement.setPosition(key, pos + delta)
    -> placement.markUserDragged(key)
  -> activeDelta reset to {0, 0}
```

User-dragged items are excluded from automatic re-placement. Auto-layout clears
all drag state so everything returns to computed tree positions.

## Auto-pan

After each `measureAndPlace`, if the content bounds changed (serialized bounds key differs
from previous), the viewport is checked for overflow. If any edge of the content extends
past the visible viewport, `autoPanToContent()` fires:

- If content fits in the viewport: center it
- If content overflows: align top-left with a 16px margin

This handles both new items appearing off-screen and tree re-placement shifting items
into negative coordinates.

## Pan clamping

Canvas pan is bounded so content stays partially visible. Margin = max(maxItemSize/2, 50px).
Re-clamps on: pan gesture, wheel scroll, canvas resize (splitpane drag), and after placement.

## Direction extensibility

`placeRelative` accepts a `direction` parameter (default `'right'`). Currently only `'right'`
is implemented (children placed to the right of parent). Adding `'down'` or `'up'` requires
swapping X/Y logic in the position calculation. See TODO comment in the function.
