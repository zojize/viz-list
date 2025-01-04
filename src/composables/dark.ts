import { useDark, useToggle } from '@vueuse/core'
import * as monaco from 'monaco-editor'
import VitesseDark from '~/vitesse/vitesse-dark.json'
import VitesseLight from '~/vitesse/vitesse-light.json'

export const dark = useDark()
export const toggleDark = useToggle(dark)

monaco.editor.defineTheme('vitesse', VitesseLight as any)
monaco.editor.defineTheme('vitesse-dark', VitesseDark as any)

watch(dark, dark => monaco.editor.setTheme(dark ? 'vitesse-dark' : 'vitesse'))
monaco.editor.onDidCreateEditor(() => monaco.editor.setTheme(dark.value ? 'vitesse-dark' : 'vitesse'))
