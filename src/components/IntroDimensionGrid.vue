<script setup lang="ts">
import { computed } from 'vue'
import type { PaperIntroZh } from '../types/paper'

const props = defineProps<{
  intro: PaperIntroZh
  compact?: boolean
}>()

const sections = computed(() => [
  { label: '研究动机', value: props.intro.motivation },
  { label: '解决问题', value: props.intro.problem },
  { label: '现象分析', value: props.intro.analysis },
  { label: '主要方法', value: props.intro.method },
  { label: '数据与实验', value: props.intro.experiment },
  { label: '主要贡献', value: props.intro.contribution },
])
</script>

<template>
  <div class="intro-grid" :class="{ 'is-compact': compact }">
    <article
      v-for="section in sections"
      :key="section.label"
      class="intro-grid__card"
    >
      <p class="intro-grid__label">{{ section.label }}</p>
      <p class="intro-grid__value">{{ section.value }}</p>
    </article>
  </div>
</template>
