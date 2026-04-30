<script setup lang="ts">
import type { CategoryKey } from '../types/paper'

defineProps<{
  items: {
    key: CategoryKey
    name: string
    index: number
    anchorId: string
    count: number
  }[]
  activeId: string
  hasQuery: boolean
}>()

const emit = defineEmits<{
  jump: [anchorId: string]
}>()
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar__inner">
      <p class="sidebar__eyebrow">Taxonomy</p>
      <h2 class="sidebar__title">
        {{ hasQuery ? '命中方向' : '18 个子领域' }}
      </h2>

      <nav class="sidebar__nav" aria-label="category navigation">
        <button
          v-for="item in items"
          :key="item.key"
          class="sidebar__item"
          :class="{ 'is-active': activeId === item.anchorId }"
          type="button"
          @click="emit('jump', item.anchorId)"
        >
          <span class="sidebar__index">{{ String(item.index).padStart(2, '0') }}</span>
          <span class="sidebar__name">{{ item.name }}</span>
          <span class="sidebar__count">{{ item.count }}</span>
        </button>
      </nav>
    </div>
  </aside>
</template>
