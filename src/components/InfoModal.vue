<script setup lang="ts">
// Info modal: documents the app's UI with inline button visuals so the
// reader can see exactly what to click for each action. Purely presentational
// — the buttons here don't trigger anything, they're visual placeholders
// styled identically to their toolbar counterparts so the docs stay in sync
// with the real UI via the `icon-btn` utility class.

defineProps<{
  open: boolean
}>()

defineEmits<{
  'update:open': [value: boolean]
}>()
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="opacity-0"
      leave-active-class="transition-all duration-150 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        @click.self="$emit('update:open', false)"
      >
        <div class="relative mx-4 max-h-[85vh] max-w-2xl w-full overflow-y-auto border border-gray-200 rounded-xl bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-900">
          <button
            class="absolute right-3 top-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            @click="$emit('update:open', false)"
          >
            <div class="i-carbon-close h-4 w-4" />
          </button>

          <h2 class="mb-4 text-base text-gray-800 font-semibold dark:text-gray-200">
            How to use
          </h2>

          <p class="mb-4 text-xs text-gray-500 dark:text-gray-500">
            Interprets a subset of C++ — enough to visualize common data structures and
            algorithms: structs, pointers, arrays, <code>new</code>/<code>delete</code>,
            functions, loops, conditionals. Runtime errors (null dereferences, use-after-free,
            out-of-bounds, etc.) surface as toasts with the offending line highlighted.
          </p>

          <div class="text-xs text-gray-600 leading-relaxed space-y-5 dark:text-gray-400">
            <section>
              <h3 class="mb-1.5 text-sm text-gray-700 font-medium dark:text-gray-300">
                Editor &amp; templates
              </h3>
              <ul class="list-disc pl-4 space-y-1">
                <li>Write or edit C++ in the left panel.</li>
                <li>Pick a template from the dropdown in the top-left to load example code.</li>
                <li>
                  <span class="inline-flex items-center gap-1 align-middle">
                    <span class="pointer-events-none icon-btn h-6! w-6!"><div class="i-carbon-share" /></span>
                  </span>
                  copies a share link (your code compressed into the URL).
                </li>
                <li>
                  <span class="inline-flex items-center gap-1 align-middle">
                    <span class="pointer-events-none icon-btn h-6! w-6! bg-gray-100! dark:bg-white/5!"><div class="i-carbon-information" /></span>
                  </span>
                  opens this help panel.
                </li>
              </ul>
            </section>

            <section>
              <h3 class="mb-1.5 text-sm text-gray-700 font-medium dark:text-gray-300">
                Playback
              </h3>
              <ul class="list-disc pl-4 space-y-1">
                <li>
                  <span class="inline-flex items-center align-middle">
                    <span class="toolbar-group">
                      <span class="pointer-events-none icon-btn"><div class="i-carbon-reset" /></span>
                    </span>
                  </span>
                  clears execution state and returns to editing.
                </li>
                <li>
                  <span class="inline-flex items-center align-middle">
                    <span class="toolbar-group">
                      <span class="pointer-events-none icon-btn"><div class="i-carbon-play-filled" /></span>
                    </span>
                  </span>
                  plays through continuously at the selected speed; while running it
                  turns into
                  <span class="inline-flex items-center align-middle">
                    <span class="toolbar-group">
                      <span class="pointer-events-none icon-btn"><div class="i-carbon-pause-filled text-vitesse" /></span>
                    </span>
                  </span>
                  to let you pause.
                </li>
                <li>
                  <span class="inline-flex items-center align-middle">
                    <span class="toolbar-group">
                      <span class="pointer-events-none icon-btn"><div class="i-carbon-skip-forward-filled" /></span>
                    </span>
                  </span>
                  executes one statement at a time.
                </li>
                <li>
                  The speed slider on the right of the playback bar controls how fast
                  <i>Run</i> steps (50&thinsp;ms &rarr; 1500&thinsp;ms between steps).
                </li>
                <li>
                  Code that calls <code>breakpoint()</code> pauses execution there —
                  every template ends with one so <i>Run</i> lands on a stable state.
                </li>
              </ul>
            </section>

            <section>
              <h3 class="mb-1.5 text-sm text-gray-700 font-medium dark:text-gray-300">
                Memory Map
              </h3>
              <ul class="list-disc pl-4 space-y-1">
                <li>
                  Two tabs:
                  <span class="inline-block rounded bg-gray-500/10 px-2 py-0.5 text-[0.7rem] font-semibold">Allocations</span>
                  shows one card per live allocation;
                  <span class="inline-block rounded bg-gray-500/10 px-2 py-0.5 text-[0.7rem]">Bytes</span>
                  shows a raw hex dump grouped by region.
                </li>
                <li>
                  Left-border color on allocation cards marks the current statement:
                  <b class="text-blue-500">blue</b> = write target,
                  <b class="text-green-500">green</b> = read source,
                  <b class="text-yellow-500">yellow</b> = changed this step.
                </li>
                <li>
                  <span class="inline-block border border-gray-500/25 rounded px-2 py-0.5 text-[0.7rem] tracking-wider font-mono">arrows</span>
                  (top-right) draws every live pointer as a soft green arrow at once.
                  Primary (violet/amber) arrows still render on top when you hover a
                  pointer or select one.
                </li>
                <li>
                  <span class="inline-block border border-gray-500/25 rounded px-2 py-0.5 text-[0.7rem] tracking-wider font-mono">LE</span>
                  in Bytes view byte-swaps every scalar between little- and big-endian.
                </li>
                <li>Hover a byte / card to cross-highlight the matching item in the DS view, and vice versa.</li>
                <li>Hover a variable name in the sidebar to highlight its declaration line in the editor.</li>
                <li>Click any cell to open a byte-level detail panel.</li>
              </ul>
            </section>

            <section>
              <h3 class="mb-1.5 text-sm text-gray-700 font-medium dark:text-gray-300">
                Data Structure view
              </h3>
              <ul class="list-disc pl-4 space-y-1">
                <li>Structs and standalone variables render as cards; arrows show pointer connections (tree edges, back-links, cycles, dangling pointers).</li>
                <li>Primitive pointers (e.g. <code>int *p = &amp;x;</code>) also get arrows — every live pointer in the program has one.</li>
                <li><b>Drag</b> a card to reposition it. Drops are one-shot: the next auto-layout trigger will re-lay the canvas.</li>
                <li><b>Scroll</b> / two-finger swipe to pan. <b>Cmd/Ctrl+scroll</b> (or trackpad pinch) to zoom around the cursor.</li>
                <li>
                  Zoom toolbar (top-right):
                  <span class="mx-0.5 inline-flex items-center gap-0.5 rounded bg-gray-200/80 p-0.5 align-middle shadow-sm dark:bg-gray-700/80">
                    <span class="rounded p-1"><div class="i-carbon-zoom-out h-3.5 w-3.5" /></span>
                    <span class="min-w-10 rounded px-1 text-center text-[10px] font-mono">100%</span>
                    <span class="rounded p-1"><div class="i-carbon-zoom-in h-3.5 w-3.5" /></span>
                    <span class="mx-0.5 h-4 w-px bg-gray-400/40" />
                    <span class="rounded p-1"><div class="i-carbon-flow h-3.5 w-3.5" /></span>
                  </span>
                  — zoom out / reset (click %) / zoom in / <i>Auto-layout</i>.
                </li>
                <li>After each step the canvas auto-compacts if content would overflow, then scales down to fit everything in view (capped at 1&times;, floored at 25%).</li>
                <li>Hover a pointer card or any arrow to see its primary (violet → amber) counterpart light up in the Memory Map.</li>
                <li>Click a card to open its detail panel.</li>
              </ul>
            </section>

            <section>
              <h3 class="mb-1.5 text-sm text-gray-700 font-medium dark:text-gray-300">
                Annotations
              </h3>
              <p>Add JSDoc comments before struct fields or the struct itself to customize arrow rendering:</p>
              <pre class="mt-1.5 rounded bg-gray-100 p-2 text-[10px] font-mono dark:bg-gray-800"><code>/** @arrow-anchor closest @arrow-size 30 */
struct ListNode {
  int data;
  /** @arrow-position right
    * @arrow-color #4ade80
    * @arrow-style horizontal
    * @arrow-fallback-style orthogonal */
  ListNode *next;
};</code></pre>
              <ul class="mt-2 list-disc pl-4 space-y-0.5">
                <li><b>@arrow-position</b> right | left | dynamic — which side of the struct the arrow leaves from.</li>
                <li><b>@arrow-style</b> bezier | straight | horizontal | orthogonal.</li>
                <li><b>@arrow-fallback-style</b> used when <i>horizontal</i> can't connect (Y-misaligned).</li>
                <li><b>@arrow-color</b> any CSS color.</li>
                <li><b>@arrow-anchor</b> center | closest — where incoming arrows land on the target border.</li>
                <li><b>@arrow-size</b> gap in px between parent and child cards; gives pointer cards room to sit in the gutter.</li>
              </ul>
            </section>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
