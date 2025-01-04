import { createHead } from '@unhead/vue'
import { createApp } from 'vue'

import { createRouter, createWebHistory } from 'vue-router'

import { routes } from 'vue-router/auto-routes'
import App from './App.vue'
import '@unocss/reset/tailwind.css'

import './styles/main.css'

import 'uno.css'
import './scripts/monaco'
import './scripts/cytoscape'

createApp(App)
  .use(createRouter({
    routes,
    history: createWebHistory(import.meta.env.BASE_URL),
  }))
  .use(createHead())
  .mount('#app')
