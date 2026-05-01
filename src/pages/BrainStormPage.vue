<script setup lang="ts">
import type {
  BrainstormRelatedPaper,
  BrainstormStatus,
} from '../types/app'
import type {
  BrainstormDraft,
  BrainstormPlan,
} from '../utils/brainstorm'
import type { BrainstormEnhancement } from '../utils/brainstormApi'
import type {
  PaperCatalogIndexRecord,
  PaperRecord,
} from '../types/paper'
import { clampNumber } from '../utils/display'
import { getVenueBadge } from '../utils/venue'

defineProps<{
  semanticModel: string
  semanticPaperCount: number
  paperCount: number
  brainstormDraft: BrainstormDraft
  brainstormStatus: BrainstormStatus
  brainstormError: string
  brainstormResults: BrainstormRelatedPaper[]
  brainstormPlan: BrainstormPlan | null
  brainstormEnhancement: BrainstormEnhancement | null
  brainstormBackendAvailable: boolean
  brainstormBackendMessage: string
  brainstormEnhancementStateLabel: string
  brainstormModelLabel: string
  requestedModel: string
  brainstormEnhancing: boolean
  getPaperDetail: (paper: PaperCatalogIndexRecord) => PaperCatalogIndexRecord | PaperRecord
}>()

const emit = defineEmits<{
  refreshBackend: []
  reset: []
  search: []
  enhance: []
  'update:requestedModel': [value: string]
}>()

function updateRequestedModel(event: Event) {
  emit('update:requestedModel', (event.target as HTMLInputElement | null)?.value ?? '')
}
</script>

<template>
  <section class="page-shell">
    <header class="page-hero page-hero--idea">
      <div class="page-hero__content">
        <p class="page-hero__eyebrow">Semantic Ideation Copilot</p>
        <h1>Brain Storm</h1>
        <p>
          Write the background, the rough idea, and your constraints. The page pulls
          hybrid semantic and acronym-aware related papers first, then can refine the research plan with Zhipu.
        </p>
      </div>
      <div class="page-hero__meta-grid">
        <article class="hero-stat-card" data-tone="good">
          <span>Semantic Engine</span>
          <strong>{{ semanticModel }}</strong>
          <small>{{ semanticPaperCount || paperCount }} indexed papers</small>
        </article>
        <article class="hero-stat-card" data-tone="active">
          <span>Max Related Papers</span>
          <strong>{{ clampNumber(brainstormDraft.maxPapers, 1, 20) }}</strong>
          <small>Adjust how many references guide the idea.</small>
        </article>
        <article class="hero-stat-card" data-tone="muted">
          <span>Secure AI Refinement</span>
          <strong>{{ brainstormEnhancementStateLabel }}</strong>
          <small>{{ brainstormBackendAvailable ? brainstormModelLabel : 'Backend not enabled on this deployment.' }}</small>
        </article>
      </div>
    </header>

    <section class="page-grid page-grid--idea">
      <article class="page-card page-card--sticky">
        <div class="page-card__head">
          <h2>Idea Input</h2>
          <div class="header-actions">
            <button type="button" class="quiet-button" @click="emit('refreshBackend')">
              Refresh backend
            </button>
            <button type="button" class="quiet-button" @click="emit('reset')">
              Reset
            </button>
          </div>
        </div>

        <div class="form-stack">
          <label class="field-block">
            <span>Problem background</span>
            <textarea
              v-model="brainstormDraft.background"
              rows="5"
              placeholder="What setting, failure case, or user need are you trying to address?"
            />
          </label>

          <label class="field-block">
            <span>Core idea</span>
            <textarea
              v-model="brainstormDraft.idea"
              rows="6"
              placeholder="Describe the method intuition, architecture sketch, or hypothesis."
            />
          </label>

          <label class="field-block">
            <span>Constraints / desired properties</span>
            <textarea
              v-model="brainstormDraft.constraints"
              rows="4"
              placeholder="Latency, data limits, benchmark preference, interpretability, deployment, and so on."
            />
          </label>

          <label class="field-block">
            <span>Maximum related papers</span>
            <input v-model.number="brainstormDraft.maxPapers" type="number" min="1" max="20" />
          </label>

          <div class="action-row">
            <button
              type="button"
              class="primary-action"
              :disabled="brainstormStatus === 'searching'"
              @click="emit('search')"
            >
              {{ brainstormStatus === 'searching' ? 'Scanning papers...' : 'Find related papers' }}
            </button>
          </div>

          <div class="brainstorm-enhance">
            <div class="brainstorm-enhance__head">
              <h3>Secure AI Refinement</h3>
              <span>{{ brainstormEnhancementStateLabel }}</span>
            </div>
            <p class="muted-copy">
              {{ brainstormBackendMessage }}
            </p>
            <label class="field-block">
              <span>Preferred model (optional)</span>
              <input
                :value="requestedModel"
                type="text"
                placeholder="glm-4.5-flash"
                @input="updateRequestedModel"
              />
            </label>
            <button
              type="button"
              class="secondary-action"
              :disabled="brainstormEnhancing || !brainstormBackendAvailable"
              @click="emit('enhance')"
            >
              {{ brainstormEnhancing ? 'Enhancing...' : 'Refine with Zhipu' }}
            </button>
          </div>
        </div>
      </article>

      <section class="idea-output">
        <article class="page-card">
          <div class="page-card__head">
            <h2>Drafted Research Plan</h2>
            <span>{{ brainstormResults.length }} related papers</span>
          </div>

          <div v-if="brainstormStatus === 'idle'" class="empty-state">
            Start with a background and idea sketch. The page will run hybrid retrieval first.
          </div>
          <div v-else-if="brainstormStatus === 'error'" class="empty-state empty-state--error">
            {{ brainstormError }}
          </div>
          <div v-else-if="brainstormPlan" class="plan-grid">
            <article class="plan-card">
              <h3>Positioning</h3>
              <ul>
                <li v-for="item in brainstormPlan.positioning" :key="item">{{ item }}</li>
              </ul>
            </article>

            <article class="plan-card">
              <h3>Method Blueprint</h3>
              <ul>
                <li v-for="item in brainstormPlan.methodBlueprint" :key="item">{{ item }}</li>
              </ul>
            </article>

            <article class="plan-card">
              <h3>Evaluation Plan</h3>
              <ul>
                <li v-for="item in brainstormPlan.evaluationPlan" :key="item">{{ item }}</li>
              </ul>
            </article>

            <article class="plan-card">
              <h3>Novelty Angles</h3>
              <ul>
                <li v-for="item in brainstormPlan.noveltyAngles" :key="item">{{ item }}</li>
              </ul>
            </article>
          </div>
        </article>

        <article v-if="brainstormEnhancement" class="page-card">
          <div class="page-card__head">
            <h2>Zhipu Refined Outline</h2>
            <span>{{ brainstormModelLabel }}</span>
          </div>

          <div class="plan-grid">
            <article class="plan-card plan-card--wide">
              <h3>Refined Problem</h3>
              <p>{{ brainstormEnhancement.refinedProblem }}</p>
            </article>
            <article class="plan-card">
              <h3>Method Modules</h3>
              <ul>
                <li v-for="item in brainstormEnhancement.methodModules" :key="item">{{ item }}</li>
              </ul>
            </article>
            <article class="plan-card">
              <h3>Experiment Plan</h3>
              <ul>
                <li v-for="item in brainstormEnhancement.experimentPlan" :key="item">{{ item }}</li>
              </ul>
            </article>
            <article class="plan-card">
              <h3>Novelty Angles</h3>
              <ul>
                <li v-for="item in brainstormEnhancement.noveltyAngles" :key="item">{{ item }}</li>
              </ul>
            </article>
            <article class="plan-card">
              <h3>Risks</h3>
              <ul>
                <li v-for="item in brainstormEnhancement.risks" :key="item">{{ item }}</li>
              </ul>
            </article>
          </div>
        </article>

        <article class="page-card">
          <div class="page-card__head">
            <h2>Related Papers</h2>
            <span>{{ brainstormResults.length }} matches</span>
          </div>

          <div v-if="brainstormResults.length === 0" class="empty-state">
            Related papers will appear here after hybrid retrieval.
          </div>
          <div v-else class="brainstorm-paper-list">
            <article
              v-for="item in brainstormResults"
              :key="item.paper.id"
              class="brainstorm-paper-card"
            >
              <div class="brainstorm-paper-card__top">
                <span class="venue-chip">{{ getVenueBadge(item.paper) }}</span>
                <div>
                  <h3>{{ item.paper.title }}</h3>
                  <p class="muted-copy">
                    {{ item.paper.authors.join(', ') }}
                  </p>
                </div>
                <span v-if="item.score !== undefined" class="score-chip">
                  H{{ item.score.toFixed(4) }}
                </span>
              </div>
              <div
                v-if="item.semanticScore !== undefined || item.lexicalScore !== undefined"
                class="score-breakdown"
              >
                <span v-if="item.semanticScore !== undefined">
                  Semantic {{ item.semanticScore.toFixed(4) }}
                </span>
                <span v-if="item.lexicalScore !== undefined">
                  Lexical {{ Math.round(item.lexicalScore) }}
                </span>
              </div>
              <p class="brainstorm-paper-card__abstract">
                {{ getPaperDetail(item.paper).abstract || item.paper.hookZh || 'Abstract will load on demand.' }}
              </p>
              <div v-if="item.signals?.length" class="tag-row tag-row--signals">
                <span
                  v-for="signal in item.signals.slice(0, 4)"
                  :key="signal"
                  class="tag tag--signal"
                >
                  {{ signal }}
                </span>
              </div>
              <div class="tag-row">
                <span
                  v-for="keyword in item.paper.keywords.slice(0, 6)"
                  :key="keyword"
                  class="tag"
                >
                  {{ keyword }}
                </span>
              </div>
              <a :href="item.paper.openreviewUrl" target="_blank" rel="noreferrer">
                Open paper
              </a>
            </article>
          </div>
        </article>
      </section>
    </section>
  </section>
</template>
