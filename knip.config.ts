import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  vue: {
    entry: ['src/**/*.vue'],
  },
  entry: [
    'src/composables/index.ts', // barrel file for auto-import
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
    // Types for cytoscape
    '@types/cytoscape',
    // No tests yet, but needed when tests are added
    '@vue/test-utils',
  ],
}

export default config
