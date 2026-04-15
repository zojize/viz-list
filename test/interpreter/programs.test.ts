import type { InterpreterContext } from '../../src/composables/interpreter/types'
import { beforeAll, describe, expect, it } from 'vitest'
import { Language, Parser } from 'web-tree-sitter'
import { processDeclaration } from '../../src/composables/interpreter/declarations'
import { evaluate } from '../../src/composables/interpreter/evaluate'
import { asserts, getGeneratorReturn } from '../../src/composables/interpreter/helpers'
import { computeStructLayout } from '../../src/composables/interpreter/layout'
import { createAddressSpace } from '../../src/composables/interpreter/memory'
import { NULL_ADDRESS } from '../../src/composables/interpreter/types'

let parser: Parser

beforeAll(async () => {
  await Parser.init()
  const lang = await Language.load('public/tree-sitter-cpp.wasm')
  parser = new Parser()
  parser.setLanguage(lang)
})

function runProgram(code: string) {
  const tree = parser.parse(code)!
  const mem = createAddressSpace()

  const context: InterpreterContext = {
    structs: {},
    structLayouts: {},
    structFieldMeta: {},
    structMeta: {},
    functions: {},
    globalEnv: {},
    envStack: [],
    callStack: [],
    memory: mem,
    currentNode: undefined,
  }

  const { rootNode } = tree
  asserts(rootNode)

  for (const node of rootNode.namedChildren) {
    switch (node.type) {
      case 'struct_specifier': {
        const name = node.childForFieldName('name')!.text
        const fields: Record<string, import('../../src/composables/interpreter/types').CppType> = {}
        for (const field of node.childForFieldName('body')!.namedChildren) {
          const { type, name } = getGeneratorReturn(processDeclaration(
            field.childForFieldName('type')!,
            field.childForFieldName('declarator')!,
            context,
            mem,
          ))
          fields[name] = type
        }
        context.structs[name] = fields
        const layout = computeStructLayout(name, fields, depName => context.structLayouts[depName]!)
        context.structLayouts[name] = layout
        mem.registerStructLayout(name, layout)
        break
      }
      case 'function_definition': {
        const { type: returnType, name, params } = getGeneratorReturn(processDeclaration(
          node.childForFieldName('type')!,
          node.childForFieldName('declarator')!,
          context,
          mem,
        ))
        const body = node.childForFieldName('body')!
        context.functions[name] = {
          returnType,
          params: params!,
          body,
        }
        break
      }
      case 'declaration': {
        const typeNode = node.childForFieldName('type')!
        const declarators = node.namedChildren.filter(c => c.id !== typeNode.id)
        for (const declarator of declarators) {
          const { type, name, value } = getGeneratorReturn(processDeclaration(
            typeNode,
            declarator,
            context,
            mem,
          ))
          let address: number
          if (typeof value === 'object' && (value.type === 'struct' || value.type === 'array')) {
            address = value.base
          }
          else {
            address = mem.alloc(type, 'global', value!)
          }
          context.globalEnv[name] = { type, address }
        }
        break
      }
      case 'comment':
        break
      default:
        throw new Error(`Unsupported node type: ${node.type}`)
    }
  }

  asserts('main' in context.functions)
  const gen = evaluate(context.functions.main.body, context, mem)
  context.callStack.push({ env: [] })

  let result = gen.next()
  while (!result.done) {
    result = gen.next()
  }

  return { context, mem }
}

describe('interpreter integration tests', () => {
  it('creates a 3-node linked list', () => {
    const { mem } = runProgram(`
      struct Node { int data; Node *next; };
      struct LinkedList { Node *head; };
      void main() {
        LinkedList list;
        list.head = new Node();
        list.head->data = 1;
        list.head->next = new Node();
        list.head->next->data = 2;
        list.head->next->next = new Node();
        list.head->next->next->data = 3;
      }
    `)

    // Count live heap allocations that are Node structs
    const heapNodeAllocs = [...mem.space.allocations.values()].filter(
      a =>
        a.region === 'heap'
        && !a.dead
        && a.layout.kind === 'struct'
        && a.layout.structName === 'Node',
    )

    expect(heapNodeAllocs).toHaveLength(3)
  })

  it('null pointer has address 0', () => {
    const { mem } = runProgram(`
      struct Node { int data; Node *next; };
      void main() {
        Node *p = new Node();
        p->data = 42;
        p->next = nullptr;
      }
    `)

    // Find the heap Node struct allocation
    const nodeAlloc = [...mem.space.allocations.values()].find(
      a =>
        a.region === 'heap'
        && a.layout.kind === 'struct'
        && a.layout.structName === 'Node',
    )
    expect(nodeAlloc).toBeDefined()

    const nodeBase = nodeAlloc!.base
    const { address: dataAddr } = mem.fieldAddress(nodeBase, 'data')
    const { address: nextAddr } = mem.fieldAddress(nodeBase, 'next')

    expect(mem.readScalar(dataAddr, 'int')).toBe(42)
    expect(mem.readScalar(nextAddr, { type: 'pointer', to: { type: 'struct', name: 'Node' } })).toBe(NULL_ADDRESS)
  })

  it('short-circuits && correctly', () => {
    const { mem, context } = runProgram(`
      int x = 0;
      int y = 0;
      void main() {
        x = (0 && (y = 1));
      }
    `)

    const xAddr = context.globalEnv.x.address
    const yAddr = context.globalEnv.y.address

    // x should be 0 (false) because RHS of && was short-circuited
    const xVal = mem.readScalar(xAddr, 'int')
    expect(xVal === 0 || xVal === false).toBe(true)

    // y should remain 0 because the RHS was never evaluated
    expect(mem.readScalar(yAddr, 'int')).toBe(0)
  })

  it('new Node(val) initializes fields', () => {
    const { mem } = runProgram(`
      struct Node { int data; Node *next; };
      void main() {
        Node *p = new Node(99);
      }
    `)

    const nodeAlloc = [...mem.space.allocations.values()].find(
      a =>
        a.region === 'heap'
        && a.layout.kind === 'struct'
        && a.layout.structName === 'Node',
    )
    expect(nodeAlloc).toBeDefined()

    const nodeBase = nodeAlloc!.base
    const { address: dataAddr } = mem.fieldAddress(nodeBase, 'data')

    expect(mem.readScalar(dataAddr, 'int')).toBe(99)
  })

  it('delete marks cell as dead', () => {
    const { mem } = runProgram(`
      struct Node { int data; Node *next; };
      void main() {
        Node *p = new Node();
        p->data = 5;
        delete p;
      }
    `)

    // The heap Node allocation should be marked dead
    const nodeAlloc = [...mem.space.allocations.values()].find(
      a =>
        a.region === 'heap'
        && a.layout.kind === 'struct'
        && a.layout.structName === 'Node',
    )
    expect(nodeAlloc).toBeDefined()
    expect(nodeAlloc!.dead).toBe(true)
  })

  it('while loop iterates correctly', () => {
    const { mem, context } = runProgram(`
      struct Node { int data; Node *next; };
      int sum = 0;
      void main() {
        Node *a = new Node(1);
        Node *b = new Node(2);
        Node *c = new Node(3);
        a->next = b;
        b->next = c;
        Node *cur = a;
        while (cur != nullptr) {
          sum = sum + cur->data;
          cur = cur->next;
        }
      }
    `)

    const sumAddr = context.globalEnv.sum.address
    expect(mem.readScalar(sumAddr, 'int')).toBe(6)
  })

  it('constructs a B-tree with array fields', () => {
    const { mem } = runProgram(`
      struct BTreeNode {
        int numKeys;
        int keys[3];
        BTreeNode *children[4];
      };
      void main() {
        BTreeNode *root = new BTreeNode;
        root->numKeys = 2;
        root->keys[0] = 10;
        root->keys[1] = 20;
        root->keys[2] = 0;
        root->children[0] = nullptr;
        root->children[1] = nullptr;
        root->children[2] = nullptr;
        root->children[3] = nullptr;
      }
    `)

    // Find the BTreeNode struct allocation on the heap
    const rootAlloc = [...mem.space.allocations.values()].find(
      a => !a.dead && a.region === 'heap' && a.layout.kind === 'struct' && a.layout.structName === 'BTreeNode',
    )
    expect(rootAlloc).toBeDefined()
    const rootBase = rootAlloc!.base

    // BTreeNode byte layout (no header, all inline):
    //   int numKeys   — offset 0,  size 4
    //   int keys[3]   — offset 4,  size 12 (3 × 4)
    //   BTreeNode *children[4] — offset 16, size 16 (4 × 4)
    //   Total: 32 bytes

    // numKeys via fieldAddress
    const { address: numKeysAddr } = mem.fieldAddress(rootBase, 'numKeys')
    expect(mem.readScalar(numKeysAddr, 'int')).toBe(2)

    // keys[0..2] via fieldAddress for the array, then elementAddress
    const { address: keysBase } = mem.fieldAddress(rootBase, 'keys')
    expect(mem.readScalar(mem.elementAddress(keysBase, 0).address, 'int')).toBe(10)
    expect(mem.readScalar(mem.elementAddress(keysBase, 1).address, 'int')).toBe(20)
    expect(mem.readScalar(mem.elementAddress(keysBase, 2).address, 'int')).toBe(0)

    // children[0] is a null pointer
    const { address: childrenBase } = mem.fieldAddress(rootBase, 'children')
    const ptrType = { type: 'pointer' as const, to: { type: 'struct' as const, name: 'BTreeNode' } }
    expect(mem.readScalar(mem.elementAddress(childrenBase, 0).address, ptrType)).toBe(NULL_ADDRESS)

    // The whole allocation covers all 32 bytes in a single heap block
    expect(rootAlloc!.size).toBe(32)
  })
})

describe('scope cleanup', () => {
  it('marks function parameters dead on return', () => {
    const { context } = runProgram(`
      void foo(int x, int y) {}
      void main() {
        foo(10, 20);
      }
    `)
    const liveStackAllocs = [...context.memory.space.allocations.values()].filter(a => !a.dead && a.region === 'stack')
    expect(liveStackAllocs).toHaveLength(0)
  })

  it('marks struct field cells dead on delete', () => {
    const { context } = runProgram(`
      struct Node { int data; Node *next; };
      void main() {
        Node *n = new Node;
        n->data = 42;
        n->next = nullptr;
        delete n;
      }
    `)
    const liveHeapAllocs = [...context.memory.space.allocations.values()].filter(a => !a.dead && a.region === 'heap')
    expect(liveHeapAllocs).toHaveLength(0)
  })

  it('cleans up all locals after insertBack+freeAll', () => {
    const { context } = runProgram(`
      struct ListNode { int data; ListNode *next; };
      void insertBack(ListNode **head, int data) {
        ListNode *node = new ListNode;
        node->data = data;
        node->next = nullptr;
        if (*head == nullptr) { *head = node; return; }
        ListNode *cur = *head;
        while (cur->next != nullptr) { cur = cur->next; }
        cur->next = node;
      }
      void freeAll(ListNode **head) {
        ListNode *curr = *head;
        while (curr != nullptr) {
          ListNode *next = curr->next;
          delete curr;
          curr = next;
        }
        *head = nullptr;
      }
      void main() {
        ListNode *head = nullptr;
        insertBack(&head, 10);
        insertBack(&head, 20);
        insertBack(&head, 30);
        freeAll(&head);
      }
    `)
    const liveAllocs = [...context.memory.space.allocations.values()].filter(a => !a.dead && a.base !== 0)
    expect(liveAllocs).toHaveLength(0)
  })
})

describe('pointer arithmetic', () => {
  it('ptr + int offsets the address', () => {
    const { context, mem } = runProgram(`
      int sum = 0;
      void main() {
        int arr[3];
        arr[0] = 10;
        arr[1] = 20;
        arr[2] = 30;
        int *p = &arr[0];
        sum = *(p + 1);
      }
    `)
    expect(mem.readScalar(context.globalEnv.sum.address, 'int')).toBe(20)
  })

  it('ptr - int offsets the address backwards', () => {
    const { context, mem } = runProgram(`
      int result = 0;
      void main() {
        int arr[3];
        arr[0] = 100;
        arr[1] = 200;
        arr[2] = 300;
        int *p = &arr[2];
        result = *(p - 2);
      }
    `)
    expect(mem.readScalar(context.globalEnv.result.address, 'int')).toBe(100)
  })

  it('ptr - ptr gives integer difference', () => {
    const { context, mem } = runProgram(`
      int diff = 0;
      void main() {
        int arr[5];
        arr[0] = 0;
        arr[1] = 0;
        arr[2] = 0;
        arr[3] = 0;
        arr[4] = 0;
        int *p1 = &arr[1];
        int *p2 = &arr[4];
        diff = p2 - p1;
      }
    `)
    expect(mem.readScalar(context.globalEnv.diff.address, 'int')).toBe(3)
  })

  it('pointer comparison works', () => {
    const { context, mem } = runProgram(`
      int result = 0;
      void main() {
        int arr[3];
        arr[0] = 0;
        arr[1] = 0;
        arr[2] = 0;
        int *a = &arr[0];
        int *b = &arr[2];
        if (a < b) { result = 1; }
      }
    `)
    expect(mem.readScalar(context.globalEnv.result.address, 'int')).toBe(1)
  })

  it('pointer increment and decrement work', () => {
    const { context, mem } = runProgram(`
      int val = 0;
      void main() {
        int arr[3];
        arr[0] = 10;
        arr[1] = 20;
        arr[2] = 30;
        int *p = &arr[0];
        p++;
        p++;
        val = *p;
      }
    `)
    expect(mem.readScalar(context.globalEnv.val.address, 'int')).toBe(30)
  })

  it('iterates array with pointer loop', () => {
    const { context, mem } = runProgram(`
      int sum = 0;
      void main() {
        int arr[4];
        arr[0] = 1;
        arr[1] = 2;
        arr[2] = 3;
        arr[3] = 4;
        int *p = &arr[0];
        int *end = &arr[3] + 1;
        while (p < end) {
          sum = sum + *p;
          p++;
        }
      }
    `)
    expect(mem.readScalar(context.globalEnv.sum.address, 'int')).toBe(10)
  })
})

describe('multi-dim array and array-of-struct', () => {
  it('inner row pointer indexes correct elements in 2D array (bug: readValue wrong base/length)', () => {
    // Regression for: readValue returns outer alloc base/length for inner row
    // int a[3][4]; int* row = a[1]; row[2] should be 12 (a[1][2]).
    // Before fix: row aliased to a[0] so row[2] == a[0][2] == 2.
    const { context, mem } = runProgram(`
      int result = 0;
      void main() {
        int a[3][4];
        int i;
        int j;
        for (i = 0; i < 3; i++)
          for (j = 0; j < 4; j++)
            a[i][j] = i * 10 + j;
        int *row = a[1];
        result = row[2];
      }
    `)
    expect(mem.readScalar(context.globalEnv.result.address, 'int')).toBe(12)
  })

  it('field access on array-of-struct element (bug: findStructNodeAtOffset misses array nodes)', () => {
    // Regression for: fieldAddress on arr[1].x throws because the allocation
    // layout root is 'array' not 'struct', and findStructNodeAtOffset only
    // handles 'struct' roots.
    const { context, mem } = runProgram(`
      struct Pt { int x; int y; };
      int result = 0;
      void main() {
        Pt arr[3];
        arr[1].x = 42;
        arr[1].y = 7;
        result = arr[1].x + arr[1].y;
      }
    `)
    expect(mem.readScalar(context.globalEnv.result.address, 'int')).toBe(49)
  })
})
