# StructViz

An interactive C++ data structure visualizer. Write C++ code, step through it statement by statement, and watch structs, pointers, and memory come alive.

> **Note:** StructViz interprets a subset of C++ — not the full language, but enough to visualize common data structures and algorithms.

## Features

- **Step-by-step execution** — run, pause, step, and reset with adjustable speed
- **Memory map** — side-by-side stack and heap view with real-time updates
- **Data structure canvas** — draggable cards with SVG arrows showing pointer relationships
- **Tree-aware layout** — automatic detection and placement of tree/graph structures via pointer analysis
- **Current-expression highlighting** — see which variables are being read/written at each step
- **Annotation system** — customize arrow rendering with JSDoc-like comments on struct fields

## Supported C++ Subset

- Primitive types: `int`, `float`, `double`, `char`, `bool`
- Structs with fields and pointer members
- Arrays (stack-allocated, fixed-size)
- Pointers, `new`/`delete`, `nullptr`
- Functions with parameters and return values
- Control flow: `if`/`else`, `while`, `for`
- Operators: arithmetic, comparison, logical, assignment, address-of (`&`), dereference (`*`)

## Annotations

Add JSDoc comments before struct definitions or fields to control visualization:

```cpp
/** @arrow-anchor closest @arrow-size 30 */
struct ListNode {
  int data;
  /** @arrow-position right @arrow-color #4ade80 @arrow-style horizontal */
  ListNode *next;
};
```

| Tag                     | Scope  | Values                                        | Description                               |
| ----------------------- | ------ | --------------------------------------------- | ----------------------------------------- |
| `@arrow-position`       | field  | `right` `left` `dynamic`                      | Arrow direction from this field           |
| `@arrow-style`          | field  | `bezier` `straight` `horizontal` `orthogonal` | Arrow path shape                          |
| `@arrow-fallback-style` | field  | `bezier` `straight` `orthogonal`              | Fallback when primary style can't connect |
| `@arrow-color`          | field  | any CSS color                                 | Custom arrow color                        |
| `@arrow-anchor`         | struct | `center` `closest`                            | Where arrows land on the target           |
| `@arrow-size`           | struct | number (px)                                   | Gap between connected items               |

## Development

```bash
bun install
bun run dev
```

### Commands

| Command             | Description            |
| ------------------- | ---------------------- |
| `bun run dev`       | Start dev server       |
| `bun run build`     | Production build       |
| `bun run typecheck` | Type checking          |
| `bun run lint`      | Lint                   |
| `bun run test`      | Unit tests             |
| `bun run test:e2e`  | E2E tests (Playwright) |

## Tech Stack

- [Vue 3](https://vuejs.org/) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vite.dev/)
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) for code editing
- [Tree-sitter](https://tree-sitter.github.io/) (WASM) for C++ parsing
- [UnoCSS](https://unocss.dev/) for styling

## Acknowledgements

- Theme and project scaffold inspired by [Vitesse](https://github.com/antfu-collective/vitesse) by [Anthony Fu](https://github.com/antfu)
