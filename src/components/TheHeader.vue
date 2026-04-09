<script setup lang="ts">
import { toggleDark } from '~/composables/dark'
</script>

<template>
  <nav class="flex items-center justify-between border-b border-gray-200 px-4 py-1.5 dark:border-gray-800">
    <div class="flex items-center gap-3">
      <h1 class="text-base font-semibold tracking-tight">
        <span class="text-vitesse">viz</span><span class="opacity-60">list</span>
      </h1>
    </div>

    <div class="flex items-center gap-1">
      <button class="icon-btn" title="Toggle theme" @click="toggleDark()">
        <div class="i-carbon-sun dark:i-carbon-moon" />
      </button>
      <a
        class="icon-btn"
        rel="noreferrer"
        href="https://github.com/zojize/viz-list"
        target="_blank"
        title="GitHub"
      >
        <div class="i-carbon-logo-github" />
      </a>
    </div>
  </nav>
</template>
