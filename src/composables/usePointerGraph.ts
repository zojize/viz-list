import type { FieldDirection, InterpreterContext } from '~/composables/interpreter/types'
import { computed } from 'vue'
import { NULL_ADDRESS } from '~/composables/interpreter/types'

interface PointerEdge {
  fromAddress: number // struct base that owns the pointer field
  fromFieldAddress: number // address of the field cell holding the pointer
  fieldName: string // e.g. "left", "right", "next"
  toAddress: number // target struct base address
  direction: FieldDirection // placement/arrow direction from @position annotation
}

interface DanglingEdge {
  fromAddress: number
  fromFieldAddress: number
  fieldName: string
  toAddress: number // stale address (cell is dead or missing)
  direction: FieldDirection
}

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
    context.memory.version // reactive dependency

    const nodes = new Map<number, GraphNode>()
    const danglingEdges: DanglingEdge[] = []

    // Step 1: Find all live struct header cells and build graph nodes
    const structHeaders = new Map<number, { structName: string, base: number }>()

    for (const cell of context.memory.cells.values()) {
      if (cell.dead)
        continue
      const v = cell.value
      if (typeof v !== 'object' || v.type !== 'struct')
        continue
      // Only process header cells (address matches the cell's own address or it's the base)
      // Header cell: cell.address is the base of the struct
      if (cell.address !== v.base)
        continue
      const structDef = context.structs[v.name]
      if (!structDef)
        continue

      structHeaders.set(v.base, { structName: v.name, base: v.base })
      nodes.set(v.base, {
        address: v.base,
        structName: v.name,
        inEdges: [],
        outEdges: [],
      })
    }

    // Step 2: Build edges from pointer fields
    for (const [base, info] of structHeaders) {
      const structDef = context.structs[info.structName]
      if (!structDef)
        continue

      const fieldNames = Object.keys(structDef)
      for (let i = 0; i < fieldNames.length; i++) {
        const fieldType = structDef[fieldNames[i]]
        // Only follow pointer fields that point to struct types
        if (typeof fieldType !== 'object' || fieldType.type !== 'pointer')
          continue
        if (typeof fieldType.to !== 'object' || fieldType.to.type !== 'struct')
          continue

        const fieldAddr = base + 1 + i
        const fieldCell = context.memory.cells.get(fieldAddr)
        if (!fieldCell)
          continue

        const val = fieldCell.value
        if (typeof val !== 'object' || val.type !== 'pointer' || val.address === NULL_ADDRESS)
          continue

        const targetAddr = val.address
        const direction: FieldDirection = context.structFieldMeta[info.structName]?.[fieldNames[i]]?.direction ?? 'right'

        // Resolve target to struct base
        const targetCell = context.memory.cells.get(targetAddr)
        if (!targetCell) {
          danglingEdges.push({ fromAddress: base, fromFieldAddress: fieldAddr, fieldName: fieldNames[i], toAddress: targetAddr, direction })
          continue
        }

        if (targetCell.dead) {
          danglingEdges.push({ fromAddress: base, fromFieldAddress: fieldAddr, fieldName: fieldNames[i], toAddress: targetAddr, direction })
          continue
        }

        // Resolve to struct base
        const targetBase = (typeof targetCell.value === 'object' && targetCell.value.type === 'struct')
          ? targetCell.value.base
          : targetAddr

        if (!nodes.has(targetBase))
          continue

        const edge: PointerEdge = {
          fromAddress: base,
          fromFieldAddress: fieldAddr,
          fieldName: fieldNames[i],
          toAddress: targetBase,
          direction,
        }

        nodes.get(base)!.outEdges.push(edge)
        nodes.get(targetBase)!.inEdges.push(edge)
      }
    }

    // Step 3: Detect trees via in-degree analysis + DFS
    const trees: TreeInfo[] = []
    const claimed = new Set<number>() // addresses claimed by a tree

    // Find roots: nodes with in-degree 0 (no other struct points to them)
    const roots: number[] = []
    for (const [addr, node] of nodes) {
      if (node.inEdges.length === 0)
        roots.push(addr)
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
            if (dfsPath.has(edge.toAddress)) {
              // Back-edge: cycle detected
              cycleEdges.push(edge)
            }
            else if (claimed.has(edge.toAddress)) {
              // Shared node: skip but don't mark invalid
              // The edge can still be drawn but the target stays in its own tree
            }
            else if (visited.has(edge.toAddress)) {
              // Already visited via another path within this DFS
              // Multiple parents within the same tree — node has in-degree > 1
              // This makes it not a tree
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

      // Validate: every non-root in this tree should have exactly 1 in-edge from within the tree
      if (isValidTree && treeNodes.size > 1) {
        for (const addr of treeNodes) {
          if (addr === root)
            continue
          const node = nodes.get(addr)
          if (!node)
            continue
          const inEdgesFromTree = node.inEdges.filter(e => treeNodes.has(e.fromAddress))
          if (inEdgesFromTree.length !== 1) {
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
