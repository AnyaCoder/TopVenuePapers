<script setup lang="ts">
import type {
  DiscoveryEvidenceCard,
  DiscoveryTimelineItem,
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
  workflowError: string
  unofficialStore: UnofficialPaperStorePayload | null
  unofficialLoading: boolean
  unofficialError: string
  unofficialPapers: UnofficialPaperEntry[]
  unofficialAcceptedCount: number
  unofficialCandidateCount: number
  unofficialPlatformBreakdown: Array<{ platform: string; count: number }>
  discoveryTimeline: DiscoveryTimelineItem[]
  latestEvidenceCards: DiscoveryEvidenceCard[]
  dataBaseUrl: string
}>()
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
        <div v-else-if="workflowError" class="empty-state empty-state--error">
          {{ workflowError }}
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
        <div v-else-if="unofficialError" class="empty-state empty-state--error">
          {{ unofficialError }}
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
