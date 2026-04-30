<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import IntroDimensionGrid from './IntroDimensionGrid.vue'
import type { PaperMatchMeta } from '../composables/usePaperSearch'
import type { PaperRecord } from '../types/paper'

const props = defineProps<{
  paper: PaperRecord | null
  matchMeta?: PaperMatchMeta
}>()

const emit = defineEmits<{
  close: []
}>()

watch(
  () => props.paper,
  (paper) => {
    document.body.style.overflow = paper ? 'hidden' : ''
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="paper"
      class="drawer-shell"
      role="dialog"
      aria-modal="true"
      @click.self="emit('close')"
    >
      <aside class="drawer-panel">
        <button class="drawer-panel__close" type="button" @click="emit('close')">
          关闭
        </button>

        <p class="drawer-panel__venue">{{ paper.venue }}</p>
        <h2 class="drawer-panel__title">{{ paper.title }}</h2>
        <p v-if="paper.titleZh" class="drawer-panel__title-zh">{{ paper.titleZh }}</p>
        <p class="drawer-panel__authors">{{ paper.authors.join(' · ') }}</p>

        <div v-if="matchMeta?.matchedSignals?.length" class="drawer-panel__signals">
          <span
            v-for="signal in matchMeta.matchedSignals"
            :key="signal"
            class="signal-chip"
          >
            {{ signal }}
          </span>
        </div>

        <div class="drawer-panel__links">
          <a
            class="primary-link"
            :href="paper.openreviewUrl"
            target="_blank"
            rel="noreferrer"
          >
            打开 OpenReview 原文
          </a>
          <a
            v-if="paper.pdfUrl"
            class="primary-link primary-link--secondary"
            :href="paper.pdfUrl"
            target="_blank"
            rel="noreferrer"
          >
            PDF
          </a>
        </div>

        <section class="drawer-section">
          <p class="drawer-section__label">TL;DR</p>
          <p class="drawer-section__copy">{{ paper.tldr }}</p>
        </section>

        <section class="drawer-section">
          <p class="drawer-section__label">Abstract</p>
          <p class="drawer-section__copy drawer-section__copy--serif">
            {{ paper.abstract }}
          </p>
        </section>

        <section class="drawer-section">
          <p class="drawer-section__label">中文六维导读</p>
          <IntroDimensionGrid v-if="paper.introZh" :intro="paper.introZh" />
          <p v-else class="drawer-section__copy">
            这篇论文已收录元数据，六维中文导读待后续生成。
          </p>
        </section>
      </aside>
    </div>
  </Teleport>
</template>
