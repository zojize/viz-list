<template>
  <nav class="flex justify-between px-4 py-2">
    <h1 class="text-lg font-bold">
      Viz List
    </h1>

    <div class="flex items-center gap-2">
      <button class="icon-btn" @click="toggleDark()">
        <div class="i-carbon-sun dark:i-carbon-moon" />
      </button>

      <a
        class="i-carbon-logo-github icon-btn"
        rel="noreferrer"
        href="https://github.com/zojize/viz-list"
        target="_blank"
        title="GitHub"
      />
    </div>
  </nav>
</template>
