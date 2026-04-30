<script setup lang="ts">
import PaperCard from './PaperCard.vue'
import type { PaperMatchMeta } from '../composables/usePaperSearch'
import type { CategoryMeta, PaperRecord } from '../types/paper'

defineProps<{
  category: CategoryMeta & { anchorId: string }
  papers: PaperRecord[]
  hasQuery: boolean
  matchMetaMap: Record<string, PaperMatchMeta>
}>()

const emit = defineEmits<{
  open: [paper: PaperRecord]
}>()
</script>

<template>
  <section class="category-block">
    <header class="category-block__header">
      <div>
        <p class="category-block__index">
          {{ String(category.index).padStart(2, '0') }}
        </p>
        <h2 class="category-block__title">{{ category.name }}</h2>
      </div>
      <p class="category-block__description">{{ category.description }}</p>
    </header>

    <div v-if="papers.length > 0" class="paper-grid">
      <PaperCard
        v-for="paper in papers"
        :key="paper.id"
        :paper="paper"
        :match-meta="matchMetaMap[paper.id]"
        @open="emit('open', $event)"
      />
    </div>

    <article v-else class="empty-track">
      <p class="empty-track__title">这一栏还没补齐真实条目</p>
      <p class="empty-track__copy">
        {{ hasQuery ? '当前搜索没有命中这个方向。' : '分类和页面骨架已经就位，后续可以继续按同一 schema 增量加论文。' }}
      </p>
    </article>
  </section>
</template>
