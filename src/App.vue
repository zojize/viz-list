<script setup lang="ts">
import TheHeader from '~/components/TheHeader.vue'
import IndexPage from '~/pages/index.vue'
</script>

<template>
  <div class="h-screen w-screen flex flex-col">
    <TheHeader />
    <main class="min-h-0 flex-1 overflow-hidden">
      <IndexPage />
    </main>
  </div>
</template>
