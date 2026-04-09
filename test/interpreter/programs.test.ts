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
})
