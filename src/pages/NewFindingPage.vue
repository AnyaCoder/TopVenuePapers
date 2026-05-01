<script setup lang="ts">
import type {
  DiscoveryTracePayload,
  DiscoveryEvidenceCard,
  DiscoveryTimelineItem,
  FeedLoadError,
  GitHubWorkflowRun,
} from '../types/app'
import type {
  UnofficialPaperEntry,
  UnofficialPaperStorePayload,
} from '../types/paper'
import {
  discoveryTone,
  formatDateTime,
  formatRelativeTime,
  humanizePlatform,
  humanizeWorkflowStatus,
  topEvidence,
  workflowTone,
} from '../utils/display'

defineProps<{
  latestWorkflowRun: GitHubWorkflowRun | null
  workflowRuns: GitHubWorkflowRun[]
  workflowLoading: boolean
  workflowError: FeedLoadError | null
  discoveryTrace: DiscoveryTracePayload | null
  traceLoading: boolean
  traceError: FeedLoadError | null
  unofficialStore: UnofficialPaperStorePayload | null
  unofficialLoading: boolean
  unofficialError: FeedLoadError | null
  unofficialPapers: UnofficialPaperEntry[]
  unofficialAcceptedCount: number
  unofficialCandidateCount: number
  unofficialPlatformBreakdown: Array<{ platform: string; count: number }>
  discoveryTimeline: DiscoveryTimelineItem[]
  latestEvidenceCards: DiscoveryEvidenceCard[]
  dataBaseUrl: string
}>()

function tracePromptPreview(prompt: string) {
  return prompt.length > 1400 ? `${prompt.slice(0, 1400)}\n...` : prompt
}
</script>

<template>
  <section class="page-shell">
    <header class="page-hero page-hero--dashboard">
      <div class="page-hero__content">
        <p class="page-hero__eyebrow">Daily Social Discovery</p>
        <h1>New Finding</h1>
        <p>
          Track the scheduled Zhipu-based discovery job that scans X, Xiaohongshu,
          and personal homepages for fresh 2026 paper announcements.
        </p>
      </div>
      <div class="page-hero__meta-grid">
        <article class="hero-stat-card" :data-tone="workflowTone(latestWorkflowRun)">
          <span>Workflow</span>
          <strong>{{ humanizeWorkflowStatus(latestWorkflowRun) }}</strong>
          <small>
            {{ latestWorkflowRun ? formatDateTime(latestWorkflowRun.updated_at) : 'Waiting for the first run.' }}
          </small>
        </article>
        <article class="hero-stat-card" data-tone="good">
          <span>Unofficial Queue</span>
          <strong>{{ unofficialPapers.length }}</strong>
          <small>{{ unofficialAcceptedCount }} accepted-signal, {{ unofficialCandidateCount }} candidate</small>
        </article>
        <article class="hero-stat-card" data-tone="active">
          <span>Schedule</span>
          <strong>09:15 CST daily</strong>
          <small>GitHub Actions workflow with concurrency protection.</small>
        </article>
      </div>
    </header>

    <section class="page-grid page-grid--dashboard">
      <article class="page-card">
        <div class="page-card__head">
          <h2>Pipeline Status</h2>
          <a
            class="text-link"
            href="https://github.com/AnyaCoder/TopVenuePapers/actions/workflows/discover-unofficial.yml"
            target="_blank"
            rel="noreferrer"
          >
            Open Actions
          </a>
        </div>

        <div v-if="workflowLoading" class="empty-state">
          Loading workflow status...
        </div>
        <div v-else-if="workflowError" class="error-diagnostic">
          <div class="error-diagnostic__head">
            <strong>{{ workflowError.message }}</strong>
            <span v-if="workflowError.status">{{ workflowError.status }} {{ workflowError.statusText }}</span>
          </div>
          <p v-if="workflowError.hint">{{ workflowError.hint }}</p>
          <dl>
            <div v-if="workflowError.url">
              <dt>Request URL</dt>
              <dd>{{ workflowError.url }}</dd>
            </div>
            <div v-if="workflowError.body">
              <dt>Response body</dt>
              <dd><code>{{ workflowError.body }}</code></dd>
            </div>
          </dl>
          <a
            href="https://github.com/AnyaCoder/TopVenuePapers/actions/workflows/discover-unofficial.yml"
            target="_blank"
            rel="noreferrer"
          >
            Open Actions directly
          </a>
        </div>
        <div v-else class="run-list">
          <article
            v-for="run in workflowRuns"
            :key="run.id"
            class="run-card"
            :data-tone="workflowTone(run)"
          >
            <div class="run-card__top">
              <strong>{{ run.display_title }}</strong>
              <span class="status-pill" :data-tone="workflowTone(run)">
                {{ humanizeWorkflowStatus(run) }}
              </span>
            </div>
            <p>
              Run #{{ run.run_number }} / {{ run.event }} / Updated {{ formatDateTime(run.updated_at) }}
            </p>
            <a :href="run.html_url" target="_blank" rel="noreferrer">Open run</a>
          </article>
        </div>
      </article>

      <article class="page-card">
        <div class="page-card__head">
          <h2>Source Breakdown</h2>
          <a
            class="text-link"
            :href="`${dataBaseUrl}data/unofficial/unofficial-papers.json`"
            target="_blank"
            rel="noreferrer"
          >
            Raw JSON
          </a>
        </div>

        <div v-if="unofficialLoading" class="empty-state">
          Loading unofficial discovery queue...
        </div>
        <div v-else-if="unofficialError" class="error-diagnostic">
          <div class="error-diagnostic__head">
            <strong>{{ unofficialError.message }}</strong>
            <span v-if="unofficialError.status">{{ unofficialError.status }} {{ unofficialError.statusText }}</span>
          </div>
          <dl>
            <div v-if="unofficialError.url">
              <dt>Request URL</dt>
              <dd>{{ unofficialError.url }}</dd>
            </div>
            <div v-if="unofficialError.body">
              <dt>Response body</dt>
              <dd><code>{{ unofficialError.body }}</code></dd>
            </div>
          </dl>
        </div>
        <div v-else class="source-breakdown">
          <div class="feed-summary__row">
            <span>Last generated</span>
            <strong>{{ formatDateTime(unofficialStore?.generatedAt) }}</strong>
          </div>
          <div class="feed-summary__row">
            <span>Platform spread</span>
            <div class="tag-row">
              <span
                v-for="item in unofficialPlatformBreakdown"
                :key="item.platform"
                class="tag"
              >
                {{ item.platform }} / {{ item.count }}
              </span>
              <span v-if="unofficialPlatformBreakdown.length === 0" class="tag">No platform hits yet</span>
            </div>
          </div>
          <div v-if="unofficialPlatformBreakdown.length > 0" class="source-breakdown__list">
            <article
              v-for="item in unofficialPlatformBreakdown"
              :key="`breakdown:${item.platform}`"
              class="source-breakdown__item"
            >
              <div class="source-breakdown__head">
                <strong>{{ item.platform }}</strong>
                <span>{{ item.count }}</span>
              </div>
              <div class="source-breakdown__bar" aria-hidden="true">
                <div
                  class="source-breakdown__fill"
                  :style="{ width: `${(item.count / (unofficialPlatformBreakdown[0]?.count || 1)) * 100}%` }"
                />
              </div>
            </article>
          </div>
          <div class="feed-summary__row">
            <span>Notes</span>
            <ul class="notes-list">
              <li v-for="note in unofficialStore?.notes ?? []" :key="note">{{ note }}</li>
            </ul>
          </div>
        </div>
      </article>

      <article class="page-card page-card--wide">
        <div class="page-card__head">
          <h2>Zhipu Discovery Trace</h2>
          <a
            class="text-link"
            :href="`${dataBaseUrl}data/unofficial/discovery-trace.json`"
            target="_blank"
            rel="noreferrer"
          >
            Raw trace
          </a>
        </div>

        <div v-if="traceLoading" class="empty-state">
          Loading discovery trace...
        </div>
        <div v-else-if="traceError" class="error-diagnostic">
          <div class="error-diagnostic__head">
            <strong>{{ traceError.message }}</strong>
            <span v-if="traceError.status">{{ traceError.status }} {{ traceError.statusText }}</span>
          </div>
          <dl>
            <div v-if="traceError.url">
              <dt>Request URL</dt>
              <dd>{{ traceError.url }}</dd>
            </div>
            <div v-if="traceError.body">
              <dt>Response body</dt>
              <dd><code>{{ traceError.body }}</code></dd>
            </div>
          </dl>
        </div>
        <div v-else-if="!discoveryTrace" class="empty-state">
          No trace file has been published yet. It will appear after the next successful discovery run.
        </div>
        <div v-else class="trace-board">
          <div class="trace-summary">
            <article>
              <span>Model</span>
              <strong>{{ discoveryTrace.model }}</strong>
              <small>{{ discoveryTrace.searchTool }} / {{ discoveryTrace.readerTool }}</small>
            </article>
            <article>
              <span>Search Evidence</span>
              <strong>{{ discoveryTrace.summary.searchEvidenceCollected }}</strong>
              <small>{{ discoveryTrace.queries.length }} queries</small>
            </article>
            <article>
              <span>Reader Pass</span>
              <strong>{{ discoveryTrace.summary.readerEnrichedEvidence }}</strong>
              <small>{{ discoveryTrace.readers.length }} recorded links</small>
            </article>
            <article>
              <span>Candidates</span>
              <strong>{{ discoveryTrace.summary.extractedCandidates }}</strong>
              <small>{{ discoveryTrace.summary.added }} added / {{ discoveryTrace.summary.updated }} updated</small>
            </article>
          </div>

          <div v-if="discoveryTrace.errors.length" class="error-diagnostic">
            <div class="error-diagnostic__head">
              <strong>Discovery run warnings</strong>
              <span>{{ discoveryTrace.errors.length }}</span>
            </div>
            <ul class="notes-list">
              <li v-for="error in discoveryTrace.errors" :key="error">{{ error }}</li>
            </ul>
          </div>

          <section class="trace-section">
            <h3>Search Queries</h3>
            <div class="trace-list">
              <article
                v-for="item in discoveryTrace.queries"
                :key="item.query"
                class="trace-card"
              >
                <div class="trace-card__head">
                  <strong>{{ item.query }}</strong>
                  <span>{{ item.resultCount }} hits</span>
                </div>
                <p v-if="item.error" class="trace-error">{{ item.error }}</p>
                <ul>
                  <li v-for="result in item.results.slice(0, 4)" :key="result.url">
                    <a :href="result.url" target="_blank" rel="noreferrer">
                      {{ result.title || result.url }}
                    </a>
                    <span>{{ humanizePlatform(result.platform) }}</span>
                  </li>
                </ul>
              </article>
            </div>
          </section>

          <section class="trace-section">
            <h3>Reader Pass</h3>
            <div class="trace-list">
              <article
                v-for="item in discoveryTrace.readers.slice(0, 8)"
                :key="item.url"
                class="trace-card"
              >
                <div class="trace-card__head">
                  <strong>{{ item.readerTitle || item.title || item.url }}</strong>
                  <span>{{ humanizePlatform(item.platform) }}</span>
                </div>
                <p v-if="item.readerError" class="trace-error">{{ item.readerError }}</p>
                <p v-else>{{ item.readerExcerpt || item.snippet || 'No reader excerpt.' }}</p>
                <a :href="item.url" target="_blank" rel="noreferrer">Open source</a>
              </article>
            </div>
          </section>

          <section class="trace-section">
            <h3>Extraction Prompts & Model Output</h3>
            <p class="muted-copy">
              This records the prompt and visible model response returned by the API. Hidden model reasoning is not exposed by the API and is not stored here.
            </p>
            <div class="trace-list">
              <article
                v-for="batch in discoveryTrace.extractionBatches"
                :key="batch.index"
                class="trace-card trace-card--wide"
              >
                <div class="trace-card__head">
                  <strong>Batch {{ batch.index + 1 }} / {{ batch.evidenceCount }} evidence items</strong>
                  <span>{{ batch.parsedCount }} parsed</span>
                </div>
                <p v-if="batch.error" class="trace-error">{{ batch.error }}</p>
                <details>
                  <summary>System prompt</summary>
                  <pre>{{ batch.systemPrompt }}</pre>
                </details>
                <details>
                  <summary>User prompt</summary>
                  <pre>{{ tracePromptPreview(batch.prompt) }}</pre>
                </details>
                <details open>
                  <summary>Model visible output</summary>
                  <pre>{{ batch.responseText || 'No model output captured.' }}</pre>
                </details>
              </article>
            </div>
          </section>
        </div>
      </article>

      <article class="page-card page-card--wide">
        <div class="page-card__head">
          <h2>Discovered Papers</h2>
          <span>{{ unofficialPapers.length }} items</span>
        </div>

        <div v-if="!unofficialLoading && unofficialPapers.length === 0" class="empty-state">
          No unofficial papers are waiting in the queue right now.
        </div>
        <div v-else class="discovery-list">
          <article
            v-for="entry in unofficialPapers"
            :key="entry.id"
            class="discovery-card"
          >
            <div class="discovery-card__top">
              <div>
                <div class="discovery-card__badges">
                  <span class="status-pill" :data-tone="discoveryTone(entry)">
                    {{ entry.status === 'accepted' ? 'Accepted signal' : 'Candidate signal' }}
                  </span>
                  <span class="status-pill" data-tone="muted">
                    {{ entry.acceptedVenue || 'Unclassified' }}
                  </span>
                  <span class="status-pill" data-tone="muted">
                    {{ entry.confidence ? `${Math.round(entry.confidence * 100)}% confidence` : 'No confidence score' }}
                  </span>
                </div>
                <h3>{{ entry.title }}</h3>
                <p v-if="entry.titleZh" class="muted-copy">{{ entry.titleZh }}</p>
              </div>
              <a :href="entry.primaryUrl" target="_blank" rel="noreferrer">Open source</a>
            </div>

            <p class="discovery-card__summary">
              {{ entry.summary || entry.reason || 'No summary yet.' }}
            </p>

            <div class="tag-row">
              <span v-for="platform in entry.platforms ?? []" :key="platform" class="tag">
                {{ humanizePlatform(platform) }}
              </span>
              <span v-for="keyword in (entry.keywords ?? []).slice(0, 5)" :key="keyword" class="tag">
                {{ keyword }}
              </span>
            </div>

            <div class="discovery-card__foot">
              <span>Discovered {{ formatDateTime(entry.discoveredAt) }}</span>
              <span v-if="topEvidence(entry)">
                Evidence: {{ topEvidence(entry)?.title || topEvidence(entry)?.readerTitle || humanizePlatform(topEvidence(entry)?.platform || 'web') }}
              </span>
            </div>
          </article>
        </div>
      </article>

      <article class="page-card page-card--wide">
        <div class="page-card__head">
          <h2>Live Timeline</h2>
          <span>{{ discoveryTimeline.length }} events</span>
        </div>

        <div v-if="discoveryTimeline.length === 0" class="empty-state">
          Timeline events will appear here after the crawler starts producing snapshots.
        </div>
        <div v-else class="timeline-list">
          <article
            v-for="item in discoveryTimeline"
            :key="item.id"
            class="timeline-card"
            :data-tone="item.tone"
          >
            <div class="timeline-card__dot" aria-hidden="true" />
            <div class="timeline-card__body">
              <div class="timeline-card__head">
                <strong>{{ item.title }}</strong>
                <span>{{ formatRelativeTime(item.timestamp) }}</span>
              </div>
              <p>{{ item.detail }}</p>
              <div class="timeline-card__meta">
                <span>{{ formatDateTime(item.timestamp) }}</span>
                <a v-if="item.href" :href="item.href" target="_blank" rel="noreferrer">
                  Open
                </a>
              </div>
            </div>
          </article>
        </div>
      </article>

      <article class="page-card page-card--wide">
        <div class="page-card__head">
          <h2>Latest Evidence</h2>
          <span>{{ latestEvidenceCards.length }} cards</span>
        </div>

        <div v-if="latestEvidenceCards.length === 0" class="empty-state">
          Evidence cards will show the strongest snippets from X, Xiaohongshu, or homepages once discovered.
        </div>
        <div v-else class="evidence-list">
          <article
            v-for="card in latestEvidenceCards"
            :key="card.id"
            class="evidence-card"
            :data-tone="card.tone"
          >
            <div class="evidence-card__head">
              <span class="status-pill" :data-tone="card.tone">{{ card.platform }}</span>
              <span>{{ formatRelativeTime(card.timestamp) }}</span>
            </div>
            <h3>{{ card.title }}</h3>
            <p class="muted-copy">{{ card.paperTitle }}</p>
            <p class="evidence-card__snippet">{{ card.snippet }}</p>
            <a :href="card.href" target="_blank" rel="noreferrer">Open evidence</a>
          </article>
        </div>
      </article>
    </section>
  </section>
</template>
