<script setup lang="ts">
import { guideLabels } from '../constants/appMetadata'
import type { SearchMode, SemanticStatus } from '../types/app'
import type {
  CategoryKey,
  PaperCatalogIndexRecord,
  PaperRecord,
} from '../types/paper'
import { getVenueBadge } from '../utils/venue'

const props = defineProps<{
  paperCount: number
  guidedPaperCount: number
  catalogUpdatedAt: string
  isLoadingPapers: boolean
  loadError: string
  draftQuery: string
  maxResults: number
  perPage: number
  searchMode: SearchMode
  semanticStatus: SemanticStatus
  semanticStatusLabel: string
  showSemanticProgress: boolean
  semanticProgressStageLabel: string
  semanticProgressPercent: number | null
  semanticProgressMessage: string
  activeFilterCount: number
  venueGroups: Array<{
    venue: string
    years: Array<{ value: number; count: number }>
  }>
  categoryOptions: Array<{ key: CategoryKey; label: string; count: number }>
  selectedVenueYears: Set<string>
  selectedCategories: Set<CategoryKey>
  hasSemanticRanking: boolean
  currentPage: number
  totalPages: number
  visiblePapers: PaperCatalogIndexRecord[]
  selectedYearCount: (venue: string, years: number[]) => number
  isSectionOpen: (paperId: string, section: string) => boolean
  getPaperDetail: (paper: PaperCatalogIndexRecord) => PaperCatalogIndexRecord | PaperRecord
  getAbstractCopy: (paper: PaperCatalogIndexRecord) => string
  formatAffinity: (paper: PaperCatalogIndexRecord) => string
  buildBibtexForView: (paper: PaperCatalogIndexRecord) => string
}>()

const emit = defineEmits<{
  'update:draftQuery': [value: string]
  'update:maxResults': [value: number]
  'update:perPage': [value: number]
  exportResults: []
  clearSearch: []
  runSearch: []
  setSearchMode: [mode: SearchMode]
  checkSemanticHealth: []
  toggleVenueGroup: [venue: string, years: number[]]
  clearVenueGroup: [venue: string, years: number[]]
  toggleVenueYear: [venue: string, year: number]
  toggleCategory: [category: CategoryKey]
  previousPage: []
  nextPage: []
  toggleSection: [paperId: string, section: string]
}>()

function updateText(event: Event) {
  emit('update:draftQuery', (event.target as HTMLTextAreaElement | null)?.value ?? '')
}

function updateNumber(event: Event, name: 'maxResults' | 'perPage') {
  const value = Number((event.target as HTMLInputElement | null)?.value)
  const nextValue = Number.isFinite(value) ? value : 0

  if (name === 'maxResults') {
    emit('update:maxResults', nextValue)
    return
  }

  emit('update:perPage', nextValue)
}

function getIntroZh(paper: PaperCatalogIndexRecord) {
  const detail = props.getPaperDetail(paper)
  return 'introZh' in detail ? detail.introZh : undefined
}
</script>

<template>
  <section class="finder-shell">
    <header class="finder-hero">
      <div class="finder-hero__cloud" aria-hidden="true">
        <span>ICLR</span>
        <span>CCF-A</span>
        <span>VLM</span>
        <span>Agent</span>
        <span>VLA</span>
        <span>Reasoning</span>
        <span>MLLM</span>
        <span>RAG</span>
      </div>

      <div class="finder-hero__content">
        <h1>AI Paper Finder</h1>
        <p>Discover relevant 2026 AI papers across selected top venues.</p>
        <div class="finder-hero__meta">
          <span>CCF-A Papers</span>
          <a href="https://openreview.net" target="_blank" rel="noreferrer">
            OpenReview
          </a>
          <span>{{ paperCount }} papers loaded.</span>
          <span>{{ guidedPaperCount }} with Chinese guides.</span>
          <span v-if="catalogUpdatedAt">Updated {{ catalogUpdatedAt.slice(0, 10) }}</span>
        </div>
      </div>
    </header>

    <section class="finder-workspace">
      <aside class="finder-panel finder-panel--search">
        <div class="panel-heading">
          <h2>Search</h2>
          <div class="panel-actions">
            <button type="button" @click="emit('exportResults')">Export Results</button>
            <button type="button" @click="emit('clearSearch')">Clear</button>
          </div>
        </div>

        <div class="filter-body">
          <div v-if="isLoadingPapers" class="catalog-status">
            Loading lazy paper catalog...
          </div>
          <div v-else-if="loadError" class="catalog-status catalog-status--error">
            Catalog failed to load: {{ loadError }}
          </div>

          <label class="field-block">
            <span>Query (best: paste an abstract)</span>
            <textarea
              :value="draftQuery"
              rows="5"
              placeholder="vlm, video, embodied agent, long-context reasoning..."
              @input="updateText"
              @keydown.ctrl.enter.prevent="emit('runSearch')"
            />
          </label>

          <div class="semantic-controls">
            <button
              type="button"
              :class="{ 'is-active': searchMode === 'semantic' }"
              @click="emit('setSearchMode', 'semantic')"
            >
              Semantic local
            </button>
            <button
              type="button"
              :class="{ 'is-active': searchMode === 'keyword' }"
              @click="emit('setSearchMode', 'keyword')"
            >
              Keyword / fuzzy
            </button>
            <button type="button" @click="emit('checkSemanticHealth')">
              Check model
            </button>
          </div>

          <p
            class="semantic-hint"
            :class="{ 'semantic-hint--error': semanticStatus === 'error' }"
          >
            {{ semanticStatusLabel }}
          </p>

          <div v-if="showSemanticProgress" class="semantic-progress-card">
            <div class="semantic-progress-card__top">
              <strong>{{ semanticProgressStageLabel }}</strong>
              <span v-if="semanticProgressPercent !== null">{{ semanticProgressPercent }}%</span>
            </div>
            <div class="semantic-progress-bar" aria-hidden="true">
              <div
                class="semantic-progress-bar__fill"
                :style="{ width: `${semanticProgressPercent ?? 12}%` }"
              />
            </div>
            <p class="semantic-progress-card__copy">
              {{ semanticProgressMessage }}
            </p>
          </div>

          <div class="compact-grid">
            <label class="field-block">
              <span>Number of results</span>
              <input
                :value="maxResults"
                type="number"
                min="1"
                @input="updateNumber($event, 'maxResults')"
              />
            </label>
            <label class="field-block">
              <span>Per page</span>
              <input
                :value="perPage"
                type="number"
                min="1"
                max="50"
                @input="updateNumber($event, 'perPage')"
              />
            </label>
            <button
              class="primary-action"
              type="button"
              :disabled="semanticStatus === 'searching'"
              @click="emit('runSearch')"
            >
              {{ semanticStatus === 'searching' ? 'Searching...' : 'Search' }}
            </button>
          </div>

          <div class="filter-section">
            <div class="filter-section__heading">
              <h3>Select Venues & Years</h3>
              <span>{{ activeFilterCount }} active</span>
            </div>

            <div class="venue-list">
              <article
                v-for="group in venueGroups"
                :key="group.venue"
                class="venue-row"
              >
                <div class="venue-row__top">
                  <strong>{{ group.venue }}</strong>
                  <span>
                    {{ selectedYearCount(group.venue, group.years.map((item) => item.value)) }}/{{
                      group.years.length
                    }}
                    selected
                  </span>
                  <button
                    type="button"
                    @click="emit('toggleVenueGroup', group.venue, group.years.map((item) => item.value))"
                  >
                    Select all years
                  </button>
                  <button
                    type="button"
                    @click="emit('clearVenueGroup', group.venue, group.years.map((item) => item.value))"
                  >
                    Clear
                  </button>
                </div>
                <div class="year-pills">
                  <button
                    v-for="year in group.years"
                    :key="year.value"
                    type="button"
                    :class="{
                      'is-active': selectedVenueYears.has(`${group.venue}:${year.value}`),
                    }"
                    @click="emit('toggleVenueYear', group.venue, year.value)"
                  >
                    {{ year.value }} ({{ year.count }})
                  </button>
                </div>
              </article>
            </div>
          </div>

          <div class="filter-section">
            <div class="filter-section__heading">
              <h3>Subfields</h3>
              <span>{{ selectedCategories.size }} selected</span>
            </div>
            <div class="category-filter-list">
              <button
                v-for="category in categoryOptions"
                :key="category.key"
                type="button"
                :class="{ 'is-active': selectedCategories.has(category.key) }"
                @click="emit('toggleCategory', category.key)"
              >
                <span>{{ category.label }}</span>
                <small>{{ category.count }}</small>
              </button>
            </div>
          </div>
        </div>
      </aside>

      <section class="finder-panel finder-panel--results">
        <div class="results-heading">
          <h2>
            Results
            <small>{{ hasSemanticRanking ? 'Hybrid semantic ranking' : 'Keyword ranking' }}</small>
          </h2>
          <div class="pager">
            <button
              type="button"
              :disabled="currentPage === 1"
              @click="emit('previousPage')"
            >
              Previous
            </button>
            <strong>Page {{ currentPage }} / {{ totalPages }}</strong>
            <button
              type="button"
              :disabled="currentPage === totalPages"
              @click="emit('nextPage')"
            >
              Next
            </button>
          </div>
        </div>

        <div class="results-list" aria-live="polite">
          <article
            v-for="paper in visiblePapers"
            :key="paper.id"
            class="result-card"
          >
            <div class="result-card__main">
              <div class="result-card__titleline">
                <span class="venue-chip">{{ getVenueBadge(paper) }}</span>
                <div class="result-card__titlegroup">
                  <h3>{{ paper.title }}</h3>
                  <p class="result-card__meta">
                    <span>{{ paper.venue }}</span>
                    <span v-if="paper.track">{{ paper.track }}</span>
                  </p>
                </div>
              </div>
              <p v-if="paper.titleZh" class="result-card__zh">
                {{ paper.titleZh }}
              </p>
              <p class="result-card__authors">
                <strong>Authors:</strong> {{ paper.authors.join(', ') }}
              </p>
              <p class="result-card__score">
                <strong>{{ hasSemanticRanking ? 'Hybrid Score:' : 'Affinity Score:' }}</strong>
                {{ formatAffinity(paper) }}
              </p>
              <p v-if="paper.hookZh" class="result-card__hook">{{ paper.hookZh }}</p>
              <p v-else class="result-card__hook">
                Metadata collected. Chinese guide is pending.
              </p>
            </div>

            <a
              class="open-link"
              :href="paper.openreviewUrl"
              target="_blank"
              rel="noreferrer"
            >
              Open
              <br />
              Link
            </a>

            <div class="result-card__details">
              <button type="button" @click="emit('toggleSection', paper.id, 'abstract')">
                <span>{{ isSectionOpen(paper.id, 'abstract') ? '▾' : '▸' }}</span>
                Show Abstract
              </button>
              <p v-if="isSectionOpen(paper.id, 'abstract')" class="detail-copy">
                {{ getAbstractCopy(paper) }}
              </p>

              <button type="button" @click="emit('toggleSection', paper.id, 'guide')">
                <span>{{ isSectionOpen(paper.id, 'guide') ? '▾' : '▸' }}</span>
                {{ paper.hasIntroZh ? 'Show Chinese Guide' : 'Chinese Guide Pending' }}
              </button>
              <div
                v-if="isSectionOpen(paper.id, 'guide') && getIntroZh(paper)"
                class="guide-grid"
              >
                <article
                  v-for="[key, label] in guideLabels"
                  :key="key"
                  class="guide-cell"
                >
                  <strong>{{ label }}</strong>
                  <p>{{ getIntroZh(paper)?.[key] }}</p>
                </article>
              </div>
              <p
                v-else-if="isSectionOpen(paper.id, 'guide')"
                class="detail-copy"
              >
                This paper is already indexed. The six-dimension Chinese guide can be generated later.
              </p>

              <button type="button" @click="emit('toggleSection', paper.id, 'bibtex')">
                <span>{{ isSectionOpen(paper.id, 'bibtex') ? '▾' : '▸' }}</span>
                Show BibTeX
              </button>
              <pre v-if="isSectionOpen(paper.id, 'bibtex')" class="bibtex">{{
                buildBibtexForView(paper)
              }}</pre>
            </div>
          </article>

          <article v-if="visiblePapers.length === 0" class="empty-results">
            <h3>No matching papers</h3>
            <p>Try a broader query, clear a venue filter, or remove a subfield.</p>
          </article>
        </div>
      </section>
    </section>
  </section>
</template>
