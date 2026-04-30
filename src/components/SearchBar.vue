<script setup lang="ts">
const model = defineModel<string>({ default: '' })

defineProps<{
  exactMatchTitle?: string
  semanticSignals: string[]
}>()

function clear() {
  model.value = ''
}
</script>

<template>
  <div class="search-panel">
    <label class="search-shell">
      <span class="search-shell__label">Search</span>
      <input
        v-model="model"
        class="search-shell__input"
        type="search"
        placeholder="搜标题、关键词、研究问题，例如：具身、长上下文、video social reasoning"
      />
      <button
        v-if="model"
        class="search-shell__clear"
        type="button"
        @click="clear"
      >
        清空
      </button>
    </label>

    <div class="search-feedback">
      <p v-if="exactMatchTitle" class="search-feedback__line">
        精确标题命中：
        <span class="search-feedback__strong">{{ exactMatchTitle }}</span>
      </p>

      <div v-if="semanticSignals.length > 0" class="signal-list">
        <span class="signal-list__label">语义扩展</span>
        <span
          v-for="signal in semanticSignals"
          :key="signal"
          class="signal-chip"
        >
          {{ signal }}
        </span>
      </div>
    </div>
  </div>
</template>
