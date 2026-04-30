<script setup lang="ts">
import IntroDimensionGrid from './IntroDimensionGrid.vue'
import type { PaperMatchMeta } from '../composables/usePaperSearch'
import type { PaperRecord } from '../types/paper'

defineProps<{
  paper: PaperRecord
  matchMeta?: PaperMatchMeta
}>()

const emit = defineEmits<{
  open: [paper: PaperRecord]
}>()

function openPaper(paper: PaperRecord) {
  emit('open', paper)
}
</script>

<template>
  <article
    class="paper-card"
    tabindex="0"
    role="button"
    @click="openPaper(paper)"
    @keydown.enter.prevent="openPaper(paper)"
    @keydown.space.prevent="openPaper(paper)"
  >
    <div class="paper-card__topline">
      <span class="venue-badge">{{ paper.venue }}</span>
      <span v-if="matchMeta?.exactTitleMatch" class="match-badge">Exact</span>
    </div>

    <h3 class="paper-card__title">{{ paper.title }}</h3>
    <p v-if="paper.titleZh" class="paper-card__title-zh">{{ paper.titleZh }}</p>
    <p v-if="paper.hookZh" class="paper-card__hook">{{ paper.hookZh }}</p>

    <div class="paper-card__tags">
      <span
        v-for="keyword in paper.keywords.slice(0, 4)"
        :key="keyword"
        class="paper-tag"
      >
        {{ keyword }}
      </span>
    </div>

    <p class="paper-card__authors">{{ paper.authors.join(' · ') }}</p>

    <IntroDimensionGrid v-if="paper.introZh" :intro="paper.introZh" compact />
    <p v-else class="paper-card__guide-pending">中文六维导读待补充。</p>

    <div class="paper-card__footer">
      <p class="paper-card__tldr">
        <span class="paper-card__footer-label">TL;DR</span>
        {{ paper.tldr || '暂无 TL;DR，建议点开原文核对。' }}
      </p>

      <div
        v-if="matchMeta && matchMeta.matchedSignals.length > 0"
        class="paper-card__signals"
      >
        <span
          v-for="signal in matchMeta.matchedSignals.slice(0, 3)"
          :key="signal"
          class="mini-chip"
        >
          {{ signal }}
        </span>
      </div>
    </div>

    <div class="paper-card__actions">
      <button class="ghost-button" type="button">
        展开导读
      </button>
      <a
        class="ghost-link"
        :href="paper.openreviewUrl"
        target="_blank"
        rel="noreferrer"
        @click.stop
      >
        OpenReview
      </a>
    </div>
  </article>
</template>
