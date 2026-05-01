# TopVenuePapers Architecture

## Goals

- Keep the Vue app lightweight enough for GitHub Pages while still supporting 10k+ papers.
- Load catalog/detail/abstract/semantic assets lazily so the first paint stays fast.
- Make the social-media discovery workflow observable without exposing API keys in the browser.
- Keep page code readable by separating data orchestration from page presentation.

## Frontend Structure

- `src/App.vue` is now the orchestration shell. It owns catalog loading, filters, search state, semantic warmup, unofficial discovery refresh, and Brain Storm actions.
- `src/components/TopNavigation.vue` renders the topbar tabs only.
- `src/pages/FinderPage.vue` renders the main paper finder UI. It receives state and callbacks from `App.vue`, but does not fetch data itself.
- `src/pages/NewFindingPage.vue` renders the scheduled discovery dashboard from workflow runs and `unofficial-papers.json`.
- `src/pages/BrainStormPage.vue` renders the idea input, local plan, related papers, and secure Zhipu refinement controls.
- `src/composables/usePaperCatalogData.ts` owns catalog index loading, venue/year detail shard loading, abstract shard loading, and per-paper hydration.
- `src/composables/useDiscoveryFeed.ts` owns the unofficial discovery JSON fetch and GitHub Actions workflow polling.
- `src/constants/appMetadata.ts` centralizes page tabs, subfield labels, and six-dimension Chinese guide labels.
- `src/types/app.ts` contains app-level UI types such as `AppPage`, semantic status, workflow run, timeline card, and brainstorm related paper.
- `src/utils/display.ts` contains formatting helpers shared across pages.
- `src/styles/*.css` is split by concern: global base, layout, controls, finder, workflow pages, and responsive overrides.

## Data Flow

- `scripts/ingest-openreview.mjs` pulls official ICLR 2026 main-conference papers from OpenReview.
- `scripts/ingest-ccfa-2026.mjs` pulls official CVPR 2026 and AAAI main-conference papers, writes an official-only mirror, and merges in unofficial queue entries that are still waiting for official venue pages.
- `scripts/discover-unofficial-papers.mjs` uses Zhipu web search and reader tools to discover likely 2026 papers from X, Xiaohongshu, and personal homepages.
- `scripts/reconcile-unofficial-papers.mjs` promotes unofficial entries when acceptance signals become strong, and retires them once an exact-title official entry appears.
- `scripts/build-catalog-shards.mjs` turns the full catalog into:
  - `public/data/catalog/index.json`: lightweight search/list index
  - `public/data/catalog/shards/*.json`: per `venue/year` detail shards
  - `public/data/catalog/abstracts/*.json`: abstract-only shards for on-demand abstract loading
- `scripts/semantic/build-embeddings.mjs` builds the browser semantic index from the same full catalog mirror.
  - `data/semantic/paper-embeddings-all-MiniLM-L6-v2.chunked.meta.json`: semantic chunk manifest
  - `data/semantic/chunks/*.f32.bin`: semantic binary chunks split by shard and part

## Runtime Loading

- First load only fetches `data/catalog/index.json`, which is much smaller than the old monolithic catalog.
- Venue/year counts, keyword search, and semantic ranking all work from the index payload.
- Abstracts and Chinese guides are fetched on demand from the matching venue/year shard when a paper card is expanded.
- Browser semantic search loads the chunk manifest first and then streams the prebuilt chunk binaries into a local in-browser index.
- Search ranking is hybrid: Transformers.js MiniLM vectors provide semantic recall, while `usePaperSearch` adds Fuse fuzzy matching plus corpus-derived acronym expansion for short queries such as `3DGS`, `VLA`, and `MLLM`.
- The main Finder and Brain Storm both fuse semantic and lexical candidates with reciprocal-rank fusion, so idea search and paper search use the same recall behavior.
- Semantic rebuilds reuse unchanged per-paper vectors and skip rewriting chunk binaries whose fingerprints have not changed.
- Unofficial discoveries appear as `Unclassified / Unclassified-2026` until official sources catch up. The daily reconciliation pass removes promoted entries from the unofficial queue.

## Backend And Automation

- GitHub Pages serves the static app and static data assets only.
- `.github/workflows/discover-unofficial.yml` runs the discovery, reconciliation, catalog shard build, and semantic rebuild pipeline on a daily schedule with GitHub Actions concurrency protection.
- `scripts/lib/brainstorm-zhipu.mjs` wraps the Zhipu call for Brain Storm refinement.
- `scripts/serve-pages-dist.mjs` and `scripts/semantic/serve-app.mjs` expose local/server preview routes:
  - `/api/brainstorm/status`
  - `/api/brainstorm/enhance`
- The browser never receives `ZHIPU_API_KEY`. Public GitHub Pages gracefully keeps Brain Storm in local semantic-retrieval mode when the backend route is unavailable.

## Deployment Notes

- `npm run build:pages` creates a GitHub Pages build with base path `/TopVenuePapers/`.
- `npm run preview:pages` serves the built Pages output locally, including the lightweight backend routes used for preview.
- The browser semantic model caches through Transformers.js/browser cache after the first successful model download.
- Catalog shards, abstract shards, and semantic chunks are static assets, so many concurrent users can read them safely without shared mutable server state.

## Refactor Direction

- Keep `App.vue` as a container until semantic search and Brain Storm action state are moved into composables.
- Good next extraction targets:
  - `useSemanticSearch`: server/browser semantic mode, progress, warmup, and search.
  - `useBrainstorm`: related-paper retrieval, local plan generation, and backend enhancement.
- Keep hybrid lexical recall in a single reusable path so future acronym fixes improve Finder and Brain Storm together.
- Keep page components mostly presentational so layout changes remain cheap and data races stay concentrated in composables/container logic.
