<script setup lang="ts">
defineProps<{
  paperCount: number
  coveredCategoryCount: number
  totalCategoryCount: number
}>()
</script>

<template>
  <header class="hero-panel">
    <div class="hero-panel__copy">
      <p class="eyebrow">CCF-A / ICLR 2026 Paper Explorer</p>
      <h1>读论文终于不用先和英文 abstract 硬碰硬。</h1>
      <p class="hero-panel__lede">
        这是一版偏学术阅读工作台的前端底座。支持按 18 个子领域浏览，按标题精确查，也能按研究问题做轻量语义检索。
      </p>
    </div>

    <div class="hero-panel__meta">
      <div class="stat-block">
        <span class="stat-block__value">{{ paperCount }}</span>
        <span class="stat-block__label">starter papers</span>
      </div>
      <div class="stat-block">
        <span class="stat-block__value">{{ coveredCategoryCount }}</span>
        <span class="stat-block__label">active tracks</span>
      </div>
      <div class="stat-block">
        <span class="stat-block__value">{{ totalCategoryCount }}</span>
        <span class="stat-block__label">taxonomy slots</span>
      </div>
    </div>
  </header>
</template>
