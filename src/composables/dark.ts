import { useDark } from '@vueuse/core'
import * as monaco from 'monaco-editor'
import { nextTick, watch } from 'vue'
import VitesseDark from '~/vitesse/vitesse-dark.json'
import VitesseLight from '~/vitesse/vitesse-light.json'

const dark = useDark()

/**
 * Toggle the theme with a circular reveal centered on the click point.
 *  Uses the View Transitions API when available (and the user hasn't asked
 *  for reduced motion), otherwise falls back to an instant swap. Adapted
 *  from antfu.me — see https://github.com/antfu/antfu.me/blob/main/src/logics/index.ts
 */
export function toggleDark(event?: MouseEvent) {
  const supportsVT = typeof document !== 'undefined'
    && 'startViewTransition' in document
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (!supportsVT || !event) {
    dark.value = !dark.value
    return
  }

  const x = event.clientX
  const y = event.clientY
  // Circle must reach the corner farthest from the click so the reveal
  // covers the whole viewport; `Math.hypot(maxDx, maxDy)` is that corner's
  // distance from (x, y).
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  )

  const transition = (document as Document & {
    startViewTransition: (cb: () => Promise<void>) => {
      ready: Promise<void>
    }
  }).startViewTransition(async () => {
    dark.value = !dark.value
    await nextTick()
  })

  transition.ready.then(() => {
    const clipPath = [
      `circle(0px at ${x}px ${y}px)`,
      `circle(${endRadius}px at ${x}px ${y}px)`,
    ]
    document.documentElement.animate(
      {
        // When going to dark: animate the OLD (previous light) layer,
        // shrinking away to reveal dark underneath. When going to light:
        // animate the NEW (incoming light) layer, expanding over old dark.
        clipPath: dark.value ? [...clipPath].reverse() : clipPath,
      },
      {
        duration: 400,
        easing: 'ease-out',
        // `fill: 'both'` pins the pseudo-element to the animation's first
        // keyframe as soon as .animate() is called — without it, there's a
        // frame where the browser has rendered the new snapshot but the
        // animation hasn't applied its starting clip yet, which shows up
        // as a flash of the new theme on top before the reveal plays.
        fill: 'both',
        pseudoElement: dark.value
          ? '::view-transition-old(root)'
          : '::view-transition-new(root)',
      },
    )
  })
}

monaco.editor.defineTheme('vitesse', VitesseLight as any)
monaco.editor.defineTheme('vitesse-dark', VitesseDark as any)

watch(dark, dark => monaco.editor.setTheme(dark ? 'vitesse-dark' : 'vitesse'))
monaco.editor.onDidCreateEditor(() => monaco.editor.setTheme(dark.value ? 'vitesse-dark' : 'vitesse'))
