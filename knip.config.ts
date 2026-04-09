import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  vue: {
    entry: ['src/**/*.vue'],
  },
  entry: [
    'src/composables/dark.ts', // side-effect: Monaco theme registration
    'src/composables/interpreter/index.ts', // public API for interpreter
    'src/composables/interpreter/declarations.ts', // used by evaluate.ts
    'src/composables/interpreter/types.ts', // exports used by interpreter modules
  ],
  ignoreDependencies: [
    // UnoCSS icon sets used via presetIcons
    '@iconify-json/*',
    '@iconify/utils',
    // UnoCSS eslint integration used in eslint.config.js
    '@unocss/eslint-config',
    // Vue macros volar types for IDE
    '@vue-macros/volar',
    // Used in build script
    'tree-sitter-cpp',
    // Virtual module from UnoCSS
    'uno.css',
    // No tests yet, but needed when tests are added
    '@vue/test-utils',
  ],
}

export default config
