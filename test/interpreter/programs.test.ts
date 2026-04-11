import type { InterpreterContext } from '../../src/composables/interpreter/types'
import { beforeAll, describe, expect, it } from 'vitest'
import { Language, Parser } from 'web-tree-sitter'
import { processDeclaration } from '../../src/composables/interpreter/declarations'
import { evaluate } from '../../src/composables/interpreter/evaluate'
import { asserts, getGeneratorReturn } from '../../src/composables/interpreter/helpers'
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
    structFieldMeta: {},
    structMeta: {},
    functions: {},
    globalEnv: {},
    envStack: [],
    callStack: [],
    memory: mem.space,
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
            address = mem.alloc(type, value!, 'global')
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

    // Count heap Node struct cells (header cells with region 'heap' and type struct Node)
    const heapNodeHeaders = [...mem.space.cells.values()].filter(
      cell =>
        cell.region === 'heap'
        && typeof cell.type === 'object'
        && cell.type.type === 'struct'
        && cell.type.name === 'Node'
        && !cell.dead,
    )

    expect(heapNodeHeaders).toHaveLength(3)
  })

  it('null pointer has address 0', () => {
    const { mem, context } = runProgram(`
      struct Node { int data; Node *next; };
      void main() {
        Node *p = new Node();
        p->data = 42;
        p->next = nullptr;
      }
    `)

    // Find the heap Node struct header
    const nodeHeader = [...mem.space.cells.values()].find(
      cell =>
        cell.region === 'heap'
        && typeof cell.type === 'object'
        && cell.type.type === 'struct'
        && cell.type.name === 'Node',
    )
    expect(nodeHeader).toBeDefined()

    const nodeBase = nodeHeader!.address
    const fieldDefs = context.structs.Node
    const [, dataAddr] = mem.readField(nodeBase, 'data', fieldDefs)
    const [, nextAddr] = mem.readField(nodeBase, 'next', fieldDefs)

    expect(mem.read(dataAddr).value).toBe(42)
    expect(mem.read(nextAddr).value).toEqual({ type: 'pointer', address: NULL_ADDRESS })
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
    const xVal = mem.read(xAddr).value
    expect(xVal === 0 || xVal === false).toBe(true)

    // y should remain 0 because the RHS was never evaluated
    expect(mem.read(yAddr).value).toBe(0)
  })

  it('new Node(val) initializes fields', () => {
    const { mem, context } = runProgram(`
      struct Node { int data; Node *next; };
      void main() {
        Node *p = new Node(99);
      }
    `)

    const nodeHeader = [...mem.space.cells.values()].find(
      cell =>
        cell.region === 'heap'
        && typeof cell.type === 'object'
        && cell.type.type === 'struct'
        && cell.type.name === 'Node',
    )
    expect(nodeHeader).toBeDefined()

    const nodeBase = nodeHeader!.address
    const fieldDefs = context.structs.Node
    const [, dataAddr] = mem.readField(nodeBase, 'data', fieldDefs)

    expect(mem.read(dataAddr).value).toBe(99)
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

    // The heap Node header cell should be marked dead
    const nodeHeader = [...mem.space.cells.values()].find(
      cell =>
        cell.region === 'heap'
        && typeof cell.type === 'object'
        && cell.type.type === 'struct'
        && cell.type.name === 'Node',
    )
    expect(nodeHeader).toBeDefined()
    expect(nodeHeader!.dead).toBe(true)
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
    expect(mem.read(sumAddr).value).toBe(6)
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

    // Find the BTreeNode struct on the heap
    const heapCells = [...mem.space.cells.values()].filter(c =>
      !c.dead && c.region === 'heap' && typeof c.value === 'object' && c.value.type === 'struct',
    )
    expect(heapCells.length).toBeGreaterThanOrEqual(1)
    const rootCell = heapCells[0]
    const rootBase = (rootCell.value as any).base

    // Verify inline memory layout:
    // BTreeNode { int numKeys; int keys[3]; BTreeNode *children[4]; }
    // Layout: [header] [numKeys] [keys_hdr] [k0] [k1] [k2] [children_hdr] [c0] [c1] [c2] [c3]
    // Offsets:  +0       +1       +2         +3   +4   +5   +6              +7   +8   +9   +10

    // numKeys at offset 1
    expect(mem.read(rootBase + 1).value).toBe(2)

    // keys array header at offset 2 (inline, base === rootBase + 2)
    const keysValue = mem.read(rootBase + 2).value
    expect(typeof keysValue).toBe('object')
    expect((keysValue as any).type).toBe('array')
    expect((keysValue as any).base).toBe(rootBase + 2) // inline: array base IS the field address

    // keys elements are contiguous after the header
    expect(mem.read(rootBase + 3).value).toBe(10) // keys[0]
    expect(mem.read(rootBase + 4).value).toBe(20) // keys[1]
    expect(mem.read(rootBase + 5).value).toBe(0) // keys[2]

    // children array header at offset 6
    const childrenValue = mem.read(rootBase + 6).value
    expect(typeof childrenValue).toBe('object')
    expect((childrenValue as any).type).toBe('array')
    expect((childrenValue as any).base).toBe(rootBase + 6)

    // children[0..3] are pointers at offsets 7..10
    const c0 = mem.read(rootBase + 7).value
    expect(typeof c0).toBe('object')
    expect((c0 as any).type).toBe('pointer')

    // Total struct size: 1 (header) + 1 (numKeys) + 4 (keys) + 5 (children) = 11 cells
    // All 11 cells should be in the same contiguous block
    for (let i = 0; i < 11; i++) {
      const cell = mem.space.cells.get(rootBase + i)
      expect(cell).toBeDefined()
      expect(cell!.region).toBe('heap')
    }
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
    const liveCells = [...context.memory.cells.values()].filter(c => !c.dead && c.region === 'stack')
    expect(liveCells).toHaveLength(0)
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
    const liveHeap = [...context.memory.cells.values()].filter(c => !c.dead && c.region === 'heap')
    expect(liveHeap).toHaveLength(0)
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
    const liveCells = [...context.memory.cells.values()].filter(c => !c.dead && c.address !== 0)
    expect(liveCells).toHaveLength(0)
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
    expect(mem.read(context.globalEnv.sum.address).value).toBe(20)
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
    expect(mem.read(context.globalEnv.result.address).value).toBe(100)
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
    expect(mem.read(context.globalEnv.diff.address).value).toBe(3)
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
    expect(mem.read(context.globalEnv.result.address).value).toBe(1)
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
    expect(mem.read(context.globalEnv.val.address).value).toBe(30)
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
    expect(mem.read(context.globalEnv.sum.address).value).toBe(10)
  })
})
