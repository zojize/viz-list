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
   For each pointer-typed field pointing to another live struct, record a `PointerEdge`
   carrying `direction`, `color`, `style`, and `fallbackStyle` from `context.structFieldMeta`.
   If the target cell is dead, record a `DanglingEdge` instead.

3. **Tree detection** via in-degree + DFS:
   - Left-direction edges (`@arrow-position left`) are excluded from in-degree calculation
     and DFS traversal (they're back-links, e.g. `prev` pointers)
   - Nodes with forward in-degree 0 = tree roots
   - DFS from each root detects cycles (back-edges stored in `cycleEdges`)
   - Cycle back-edges are excluded from the tree validation check
   - If no natural roots exist (fully cyclic structures), BFS finds connected
     components and picks the lowest forward in-degree node as root

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

**`placeNew(key, w, h)`** --- For new items (standalone variables, tree roots).
Finds empty space in the visible viewport via `findEmptySpace`. Returns early if the
item already has a position (idempotent across re-renders).

**`placeRelative(key, parentKey, w, h, childIndex, siblingHeights, direction, gapOverride?)`**
--- For tree children. Computes ideal position relative to the parent:

- `direction = 'right'`: X = parent.x + parent.w + gap, to the right
- `direction = 'left'`: X = parent.x - w - gap, to the left
- Y = centered among siblings relative to parent's vertical center
- `gapOverride` overrides the default arrow gap (60px), used by `@arrow-size` annotation
- Returns early if already positioned (respects user drags and prior placement)

**`findEmptySpace(w, h, occupied, container)`** --- Two-pass scan:

1. Try to fit within visible viewport (candidate Y rows x sliding X)
2. Wide items that exceed viewport width: place at origin X, find clear Y row
3. Fallback: place below all existing items

**`displaceAndPlace(key, x, y, w, h)`** --- Conflict resolution. Removes overlapping
items, places the target, then re-places displaced items via `findEmptySpace`.

**`evictOverlapping(protectedKeys)`** --- Removes positions of any items that overlap
with the protected set. Returns evicted keys so they can be re-placed in a later step.
Used after tree placement to prevent standalone items from overlapping newly-placed
tree children.

### Collision detection

`rectsOverlap(a, b)` checks axis-aligned overlap with a `gap` margin (default 16px)
on all sides. This ensures items never touch --- there's always visual breathing room.

### User drag tracking

- `markUserDragged(key)` --- called by `onDragEnd` callback
- Items in `userDragged` keep their position through re-renders
- `clearUserDragged()` --- called by auto-layout to reset everything

### Auto-layout

**`clearPositions()`** --- Clears positions and user-drag state but keeps sizes.
Used by `autoLayout()` so that `measureAndPlace()` can run synchronously in the same
tick, placing items directly at their final positions (no flash at origin).

**`clear()`** --- Wipes positions, sizes, and user-drag state. Used for full reset.

## Canvas Arrows (`CanvasArrow.vue`)

SVG arrows rendered inside the panned `contentRef` container, so they move with pan
automatically. Positioned AFTER items in DOM order with `z-10` to paint on top.

### Rendering modes

**Direction** (from `@arrow-position`):

- `right`: Start from parent's right edge, end at child's left edge
- `left`: Start from parent's left edge, end at child's right edge
- `dynamic`: Use nearest border points on both sides

**Style** (from `@arrow-style`):

- `bezier` (default): Cubic bezier curve bowing in the arrow direction
- `straight`: Direct line from start to end
- `horizontal`: Straight horizontal line (start Y = end Y)
- `orthogonal`: H-V-H step line through midpoint

**Fallback** (from `@arrow-fallback-style`): When `horizontal` style can't connect
(start Y is outside the target rect), falls back to the specified style.

**Anchor** (from `@arrow-anchor` on struct): Controls where arrows land on the target:

- `center` (default): Center of the receiving border
- `closest`: Nearest point on the border to the source, clamped 6px from corners

**Special cases**:

- **Cycle edges**: Always rendered as dashed amber bezier (hardcoded, ignoring annotations)
- **Dangling edges**: Dashed red stub with X mark and stale address label

The SVG uses `h-[1px] w-[1px] overflow-visible` instead of `h-0 w-0` because browsers
skip painting zero-area SVG elements even with overflow:visible.

### Arrow start position

Each arrow starts at the exact Y position of the AddressLink field it stems from,
not the center of the parent card. This is achieved by:

1. `DSValue.vue` adds `data-field-addr` attributes to struct field rows
2. `DataStructureView.measureFieldY()` queries the DOM for the field element,
   computes its vertical center offset relative to the parent card
3. The Y offset is passed to `CanvasArrow` as `fromFieldY`

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
4. **Descendants** of any invalidated node are recursively invalidated via BFS
   through the new parent-to-children map

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
        4. Place tree children via placeRelative (with @arrow-size gap override)
        5. Evict non-tree items that overlap with tree items (evictOverlapping)
        6. Place remaining standalone items via placeNew (idempotent)
        7. retainOnly active keys (cleanup dead items)
      -> animateEnterLeave()
        - Detect new keys vs prevActiveKeys → fade-in via Web Animations API
        - Detect removed keys → clone ghost at last position, fade-out
      -> autoPanToContent() if content bounds changed and items overflow
      -> clampPan() to keep content visible
  -> arrowEdges computed reacts to placement.version
    -> CanvasArrow components render with positions from placement engine
```

## Item animations

Enter/leave animations are handled manually (not Vue TransitionGroup, which conflicts
with inline `transform` styles by applying its own move transforms).

**Enter (fade-in)**: When a new key appears in `animateEnterLeave()`, its DOM element
gets `el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150 })`. The key is
added to `settlingKeys` which suppresses the movement transition, and cleaned up via
double-`requestAnimationFrame` to persist through the re-render cycle.

**Leave (fade-out)**: When a key disappears, a ghost `<div>` is cloned at the item's
last position and faded out via Web Animations API (`duration: 200, fill: 'forwards'`),
then removed from the DOM.

**Movement**: Items have `transition: transform 100ms ease-out` for smooth re-placement.
Disabled during: active drag (`getActiveDragKey()`), settling new items (`settlingKeys`),
or before first position is assigned (`visibility: hidden`).

## Drag flow

```
pointerdown on [data-drag-key] element
  -> track start position, prepare drag state
  -> skip buttons/links (so auto-layout button click works)
pointermove (4px threshold crossed)
  -> set activeKey, capture pointer
  -> activeDelta updated continuously (transient visual offset)
  -> getItemStyle() combines committed position + activeDelta -> GPU transform
  -> ALL items have transition: none during any active drag
pointerup
  -> onDragEnd callback fires
    -> placement.setPosition(key, pos + delta)
    -> placement.markUserDragged(key)
  -> activeDelta reset to {0, 0}
```

User-dragged items are excluded from automatic re-placement. Auto-layout clears
all drag state so everything returns to computed tree positions.

## Auto-layout

`autoLayout()` uses `clearPositions()` (not `clear()`) to keep measured sizes,
then calls `measureAndPlace()` synchronously in the same tick. This means items
transition directly from their current positions to the computed layout (via the
100ms transform transition) instead of flashing at (0,0).

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

## Current-expression highlighting

DS view items receive `statementLhsAddresses` and `statementRhsAddresses` props from
`useStatementAddresses`. Items involved in the current expression get a background tint:

- **LHS** (write target): `bg-blue-500/10`
- **RHS** (read source): `bg-green-500/10`
- **Hover boost**: When hovering an item that also has a code highlight, the tint
  intensifies to `bg-blue-500/20`
