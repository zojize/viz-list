import { createHead } from '@unhead/vue/client'
import { createApp } from 'vue'

import App from './App.vue'
import '@unocss/reset/tailwind.css'

import './styles/main.css'

import 'uno.css'
import './scripts/monaco'

createApp(App)
  .use(createHead())
  .mount('#app')
