import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Language, Parser } from 'web-tree-sitter'

import { collectVariableIdentifiers, findEnclosingFunction } from '../../src/composables/useMonacoEditor'

// monaco-editor is a browser-only bundle that crashes in the Vitest/jsdom
// environment. Mock it before importing useMonacoEditor so the module can load.
vi.mock('monaco-editor', () => ({ default: {}, editor: {}, languages: {} }))
vi.mock('constrained-editor-plugin', () => ({ constrainedEditor: () => ({}) }))

let parser: Parser

beforeAll(async () => {
  await Parser.init()
  const lang = await Language.load('public/tree-sitter-cpp.wasm')
  parser = new Parser()
  parser.setLanguage(lang)
})

const STRUCT_DEFS = `
struct Node { int data; Node *next; };
struct LinkedList { Node *head; };
`

describe('collectVariableIdentifiers', () => {
  it('finds "data" parameter and its use, but NOT newNode->data field access', () => {
    const code = `${STRUCT_DEFS}
void insertBack(LinkedList *list, int data) {
  Node *newNode = new Node;
  newNode->data = data;
}
`
    const tree = parser.parse(code)!
    const root = tree.rootNode

    // Locate the function_definition node for insertBack
    const fnNode = root.namedChildren.find(n => n.type === 'function_definition')!
    expect(fnNode).toBeDefined()

    const ids = collectVariableIdentifiers(fnNode, 'data')
    // Should match: parameter declaration (`int data`) + the `= data` rhs reference
    // Should NOT match: `newNode->data` which is a field_identifier
    expect(ids).toHaveLength(2)
    for (const id of ids) {
      expect(id.type).toBe('identifier')
      expect(id.text).toBe('data')
    }
  })

  it('finds all "newNode" occurrences (declaration + arrow-left usages)', () => {
    const code = `${STRUCT_DEFS}
void insertBack(LinkedList *list, int data) {
  Node *newNode = new Node;
  newNode->data = data;
  newNode->next = nullptr;
}
`
    const tree = parser.parse(code)!
    const root = tree.rootNode

    const fnNode = root.namedChildren.find(n => n.type === 'function_definition')!
    expect(fnNode).toBeDefined()

    const ids = collectVariableIdentifiers(fnNode, 'newNode')
    // declaration: `Node *newNode`, plus two `newNode->...` usages = 3
    expect(ids).toHaveLength(3)
    for (const id of ids) {
      expect(id.type).toBe('identifier')
      expect(id.text).toBe('newNode')
    }
  })

  it('finds 0 "data" identifiers in a struct definition (fields are field_identifier)', () => {
    const code = `struct Node { int data; Node *next; };`
    const tree = parser.parse(code)!
    const root = tree.rootNode

    const ids = collectVariableIdentifiers(root, 'data')
    expect(ids).toHaveLength(0)
  })
})

describe('findEnclosingFunction', () => {
  it('returns the function_definition node when starting from a node inside a function body', () => {
    const code = `${STRUCT_DEFS}
void insertBack(LinkedList *list, int data) {
  int x = 0;
}
`
    const tree = parser.parse(code)!
    const root = tree.rootNode

    // Collect all identifiers named 'x' — the one inside the function body
    const ids = collectVariableIdentifiers(root, 'x')
    expect(ids.length).toBeGreaterThanOrEqual(1)

    const enclosing = findEnclosingFunction(ids[0])
    expect(enclosing.type).toBe('function_definition')
  })

  it('returns the root node when starting from a top-level node with no enclosing function', () => {
    const code = `struct Node { int data; Node *next; };`
    const tree = parser.parse(code)!
    const root = tree.rootNode

    // The struct specifier itself is a top-level node
    const structNode = root.namedChildren.find(n => n.type === 'struct_specifier')!
    expect(structNode).toBeDefined()

    const result = findEnclosingFunction(structNode)
    // web-tree-sitter creates a new wrapper object each time rootNode is
    // accessed, so reference equality fails; compare by type and position.
    expect(result.type).toBe(root.type)
    expect(result.startIndex).toBe(root.startIndex)
    expect(result.endIndex).toBe(root.endIndex)
  })
})

describe('same-named variables in different functions', () => {
  it('finds only the x identifiers within the searched function, not from a sibling function', () => {
    const code = `
void foo() {
  int x = 1;
  x = 2;
}
void bar() {
  int x = 10;
  x = 20;
  x = 30;
}
`
    const tree = parser.parse(code)!
    const root = tree.rootNode

    const functions = root.namedChildren.filter(n => n.type === 'function_definition')
    expect(functions).toHaveLength(2)

    const [fooFn, barFn] = functions

    const fooXIds = collectVariableIdentifiers(fooFn, 'x')
    expect(fooXIds).toHaveLength(2) // declaration + assignment

    const barXIds = collectVariableIdentifiers(barFn, 'x')
    expect(barXIds).toHaveLength(3) // declaration + two assignments

    // Searching within foo's enclosing function should not include bar's x
    const someXInFoo = fooXIds[0]
    const enclosing = findEnclosingFunction(someXInFoo)
    const idsFromEnclosing = collectVariableIdentifiers(enclosing, 'x')
    expect(idsFromEnclosing).toHaveLength(2)
  })
})
