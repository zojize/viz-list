import {
  defineConfig,
  presetIcons,
  presetUno,
  presetWebFonts,
} from 'unocss'

// Colors aligned with Vitesse theme (https://github.com/antfu/vscode-theme-vitesse)
export default defineConfig({
  content: {
    pipeline: {
      include: [
        /\.(vue|svelte|[jt]sx?|mdx?|astro|elm|php|phtml|html)($|\?)/,
      ],
    },
  },
  theme: {
    colors: {
      // Vitesse green — the primary accent
      vitesse: {
        DEFAULT: '#4d9375',
        light: '#1c6b48',
      },
      accent: {
        green: '#4d9375',
        amber: '#e0a569',
        rose: '#cb7676',
        blue: '#6394bf',
        cyan: '#5eaab5',
        purple: '#a78bfa',
      },
    },
  },
  // Prevent the extractor from misreading decrement operators (`i--`) as
  // icon classes — `i-` is the presetIcons prefix, so plain code tokens like
  // `i--` in `for (…; i--)` loops trip the icon loader and log warnings.
  blocklist: [/^i-+$/],
  shortcuts: [
    ['btn', 'px-4 py-1.5 rounded-lg inline-flex items-center gap-1.5 cursor-pointer transition-all duration-150 text-sm font-medium disabled:cursor-default disabled:opacity-40'],
    ['icon-btn', 'inline-flex items-center justify-center w-8 h-8 rounded-lg cursor-pointer select-none transition-all duration-150 text-gray-500 dark:text-gray-400 hover:text-vitesse hover:bg-vitesse/10 !outline-none disabled:cursor-default disabled:opacity-40'],
    ['toolbar-group', 'flex items-center gap-0.5 bg-gray-100 dark:bg-white/5 rounded-lg p-0.5'],
    ['panel-border', 'border border-gray-200 dark:border-gray-800 rounded-lg'],
    ['scrollbar-hidden', '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden'],
  ],
  presets: [
    presetUno(),
    presetIcons({
      autoInstall: true,
      scale: 1.2,
      warn: true,
    }),
    presetWebFonts({
      fonts: {
        sans: 'General Sans:400,500,600',
        mono: 'JetBrains Mono:400,500,600',
      },
    }),
  ],
})
