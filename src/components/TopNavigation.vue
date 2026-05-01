<script setup lang="ts">
import type { AppPage, PageTab } from '../types/app'

defineProps<{
  activePage: AppPage
  tabs: PageTab[]
}>()

defineEmits<{
  navigate: [page: AppPage]
}>()
</script>

<template>
  <header class="topbar">
    <div class="topbar__inner">
      <nav class="topbar__nav" aria-label="Primary">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          class="topbar__tab"
          :class="{ 'is-active': activePage === tab.key }"
          @click="$emit('navigate', tab.key)"
        >
          <span>{{ tab.label }}</span>
          <small>{{ tab.blurb }}</small>
        </button>
      </nav>
    </div>
  </header>
</template>
