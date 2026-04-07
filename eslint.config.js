import antfu from '@antfu/eslint-config'

export default antfu(
  {
    unocss: true,
    formatters: true,
    ignores: [
      'docs/**',
      'plan.md',
    ],
    rules: {
      'style/yield-star-spacing': ['error', 'after'],
      'style/generator-star-spacing': ['error', { before: false, after: true }],
    },
  },
)
