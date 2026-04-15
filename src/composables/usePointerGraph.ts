import type { ArrowStyle, FieldDirection, InterpreterContext } from '~/composables/interpreter/types'
import { computed } from 'vue'
import { NULL_ADDRESS } from '~/composables/interpreter/types'

interface PointerEdge {
  fromAddress: number
  fromFieldAddress: number
  fieldName: string
  toAddress: number
  direction: FieldDirection
  color?: string
  style?: ArrowStyle
  fallbackStyle?: ArrowStyle
}

type DanglingEdge = PointerEdge

interface GraphNode {
  address: number
  structName: string
  inEdges: PointerEdge[]
  outEdges: PointerEdge[]
}

interface TreeInfo {
  rootAddress: number
  nodes: Set<number>
  edges: PointerEdge[] // tree edges (non-cycle)
  cycleEdges: PointerEdge[] // back-edges (loops)
}

interface PointerGraph {
  nodes: Map<number, GraphNode>
  trees: TreeInfo[]
  standalone: Set<number>
  danglingEdges: DanglingEdge[]
}

/**
 * Analyze the interpreter's memory to build a pointer graph,
 * detect tree structures, and identify parent-child relationships.
 *
 * Works with any user-defined struct that has pointer fields to other structs.
 */
export function usePointerGraph(context: Readonly<InterpreterContext>) {
  return computed((): PointerGraph => {
    // eslint-disable-next-line ts/no-unused-expressions
    context.memory.space.version // reactive dependency

    const nodes = new Map<number, GraphNode>()
    const danglingEdges: DanglingEdge[] = []

    // Step 1: Find all live struct allocations and build graph nodes
    const structHeaders = new Map<number, { structName: string, base: number }>()

    for (const alloc of context.memory.space.allocations.values()) {
      if (alloc.dead)
        continue
      if (alloc.layout.kind !== 'struct')
        continue
      const structName = alloc.layout.structName
      const structDef = context.structs[structName]
      if (!structDef)
        continue

      structHeaders.set(alloc.base, { structName, base: alloc.base })
      nodes.set(alloc.base, {
        address: alloc.base,
        structName,
        inEdges: [],
        outEdges: [],
      })
    }

    // Step 2: Build edges from pointer fields
    for (const [base, info] of structHeaders) {
      const layout = context.memory.space.allocations.get(base)?.layout
      if (!layout || layout.kind !== 'struct')
        continue

      for (const field of layout.fields) {
        const fieldAddr = base + field.offset
        const meta = context.structFieldMeta[info.structName]?.[field.name]

        // Collect pointer-to-struct entries: either direct pointer or array of pointers
        interface PtrEntry { ptrAddr: number, fieldName: string }
        const ptrEntries: PtrEntry[] = []

        if (field.node.kind === 'scalar'
          && typeof field.node.type === 'object' && field.node.type.type === 'pointer'
          && typeof field.node.type.to === 'object' && field.node.type.to.type === 'struct') {
          ptrEntries.push({ ptrAddr: fieldAddr, fieldName: field.name })
        }
        else if (field.node.kind === 'array'
          && field.node.element.kind === 'scalar'
          && typeof field.node.element.type === 'object'
          && field.node.element.type.type === 'pointer'
          && typeof field.node.element.type.to === 'object'
          && field.node.element.type.to.type === 'struct') {
          // Array of pointers to structs — iterate elements
          for (let j = 0; j < field.node.length; j++)
            ptrEntries.push({ ptrAddr: fieldAddr + j * field.node.stride, fieldName: `${field.name}[${j}]` })
        }

        if (ptrEntries.length === 0)
          continue

        const direction: FieldDirection = meta?.direction ?? 'right'
        const color = meta?.color
        const style = meta?.style
        const fallbackStyle = meta?.fallbackStyle

        // Determine the scalar node carrying the pointer type:
        // - direct pointer field: field.node is the scalar
        // - array-of-pointers field: field.node.element is the scalar
        const scalarNode = field.node.kind === 'scalar'
          ? field.node
          : (field.node.kind === 'array' ? field.node.element : null)
        if (!scalarNode || scalarNode.kind !== 'scalar' || typeof scalarNode.type !== 'object' || scalarNode.type.type !== 'pointer')
          continue
        const ptrType = scalarNode.type

        for (const { ptrAddr, fieldName } of ptrEntries) {
          // Read the pointer value stored at ptrAddr
          const ptrAlloc = context.memory.findAllocation(ptrAddr)
          if (!ptrAlloc || ptrAlloc.dead)
            continue
          let targetAddr: number
          try {
            targetAddr = context.memory.readScalar(ptrAddr, ptrType) as number
          }
          catch {
            continue
          }

          if (targetAddr === NULL_ADDRESS)
            continue

          const targetAlloc = context.memory.findAllocation(targetAddr)
          if (!targetAlloc || targetAlloc.dead) {
            danglingEdges.push({ fromAddress: base, fromFieldAddress: ptrAddr, fieldName, toAddress: targetAddr, direction, color, style, fallbackStyle })
            continue
          }

          const targetBase = targetAlloc.base

          if (!nodes.has(targetBase))
            continue

          const edge: PointerEdge = {
            fromAddress: base,
            fromFieldAddress: ptrAddr,
            fieldName,
            toAddress: targetBase,
            direction,
            color,
            style,
            fallbackStyle,
          }

          nodes.get(base)!.outEdges.push(edge)
          nodes.get(targetBase)!.inEdges.push(edge)
        }
      }
    }

    // Step 3: Detect trees via in-degree analysis + DFS
    const trees: TreeInfo[] = []
    const claimed = new Set<number>() // addresses claimed by a tree

    // Find roots: nodes with in-degree 0 from forward edges (right/dynamic).
    // Left-direction edges are back-links (e.g. prev pointers in doubly linked lists)
    // and don't count toward tree structure — they're just rendered as arrows.
    const roots: number[] = []
    for (const [addr, node] of nodes) {
      const forwardInDegree = node.inEdges.filter(e => e.direction !== 'left').length
      if (forwardInDegree === 0)
        roots.push(addr)
    }

    // If no natural roots found (fully cyclic structures), pick the node with the
    // lowest forward in-degree from each connected component as an arbitrary root.
    if (roots.length === 0 && nodes.size > 0) {
      const visited = new Set<number>()
      for (const [addr] of nodes) {
        if (visited.has(addr))
          continue
        // BFS to find connected component
        const component: number[] = []
        const queue = [addr]
        for (let qi = 0; qi < queue.length; qi++) {
          const cur = queue[qi]
          if (visited.has(cur))
            continue
          visited.add(cur)
          component.push(cur)
          const node = nodes.get(cur)
          if (node) {
            for (const e of node.outEdges) {
              if (!visited.has(e.toAddress))
                queue.push(e.toAddress)
            }
            for (const e of node.inEdges) {
              if (!visited.has(e.fromAddress))
                queue.push(e.fromAddress)
            }
          }
        }
        // Pick the node with lowest forward in-degree as root
        let bestAddr = component[0]
        let bestDeg = Infinity
        for (const a of component) {
          const deg = nodes.get(a)!.inEdges.filter(e => e.direction !== 'left').length
          if (deg < bestDeg) {
            bestDeg = deg
            bestAddr = a
          }
        }
        roots.push(bestAddr)
      }
    }

    // Sort roots by tree size (descending) for stable ordering
    // Estimate size by counting reachable nodes
    const reachableCounts = new Map<number, number>()
    for (const root of roots) {
      let count = 0
      const visited = new Set<number>()
      const stack = [root]
      while (stack.length > 0) {
        const addr = stack.pop()!
        if (visited.has(addr))
          continue
        visited.add(addr)
        count++
        const node = nodes.get(addr)
        if (node) {
          for (const edge of node.outEdges) {
            if (!visited.has(edge.toAddress))
              stack.push(edge.toAddress)
          }
        }
      }
      reachableCounts.set(root, count)
    }
    roots.sort((a, b) => (reachableCounts.get(b) ?? 0) - (reachableCounts.get(a) ?? 0))

    for (const root of roots) {
      if (claimed.has(root))
        continue

      const treeNodes = new Set<number>()
      const treeEdges: PointerEdge[] = []
      const cycleEdges: PointerEdge[] = []
      let isValidTree = true

      // DFS with path tracking for cycle detection
      const dfsPath = new Set<number>()
      const visited = new Set<number>()

      function dfs(addr: number) {
        if (dfsPath.has(addr))
          return // cycle — handled at the edge level
        if (visited.has(addr))
          return
        if (claimed.has(addr)) {
          // Already claimed by another tree — this is a shared node
          isValidTree = false
          return
        }

        visited.add(addr)
        dfsPath.add(addr)
        treeNodes.add(addr)

        const node = nodes.get(addr)
        if (node) {
          for (const edge of node.outEdges) {
            // Left-direction edges are back-links (e.g. prev pointers) — skip
            // during DFS traversal but include as regular tree edges for rendering.
            if (edge.direction === 'left') {
              treeEdges.push(edge)
              continue
            }

            if (dfsPath.has(edge.toAddress)) {
              cycleEdges.push(edge)
            }
            else if (claimed.has(edge.toAddress)) {
              // Shared node: skip but don't mark invalid
            }
            else if (visited.has(edge.toAddress)) {
              isValidTree = false
            }
            else {
              treeEdges.push(edge)
              dfs(edge.toAddress)
            }
          }
        }

        dfsPath.delete(addr)
      }

      dfs(root)

      // Validate: every non-root in this tree should have exactly 1 tree in-edge
      // (cycle back-edges don't count — they're already separated into cycleEdges)
      const cycleTargets = new Set(cycleEdges.map(e => `${e.fromAddress}->${e.toAddress}`))
      if (isValidTree && treeNodes.size > 1) {
        for (const addr of treeNodes) {
          if (addr === root)
            continue
          const node = nodes.get(addr)
          if (!node)
            continue
          const forwardInEdgesFromTree = node.inEdges.filter(
            e => treeNodes.has(e.fromAddress) && e.direction !== 'left' && !cycleTargets.has(`${e.fromAddress}->${e.toAddress}`),
          )
          if (forwardInEdgesFromTree.length !== 1) {
            isValidTree = false
            break
          }
        }
      }

      if (isValidTree && treeNodes.size >= 1) {
        trees.push({
          rootAddress: root,
          nodes: treeNodes,
          edges: treeEdges,
          cycleEdges,
        })
        for (const addr of treeNodes)
          claimed.add(addr)
      }
    }

    // Step 4: Standalone nodes — not part of any tree
    const standalone = new Set<number>()
    for (const addr of nodes.keys()) {
      if (!claimed.has(addr))
        standalone.add(addr)
    }

    return { nodes, trees, standalone, danglingEdges }
  })
}
