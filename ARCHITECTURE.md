# Architecture

## Data flow

- `scripts/ingest-openreview.mjs` pulls official ICLR 2026 main-conference papers from OpenReview.
- `scripts/ingest-ccfa-2026.mjs` pulls official CVPR 2026 and AAAI main-conference papers, writes an official-only mirror, and then merges in any unofficial queue entries that are still waiting for official venue pages.
- `scripts/discover-unofficial-papers.mjs` uses Zhipu web search + reader to discover likely 2026 papers from X, Xiaohongshu, and personal homepages.
- `scripts/reconcile-unofficial-papers.mjs` promotes unofficial entries when acceptance signals become strong, and retires them once an exact-title official entry appears.
- `scripts/build-catalog-shards.mjs` turns the full catalog into:
  - `public/data/catalog/index.json`: lightweight search/list index
  - `public/data/catalog/shards/*.json`: per `venue/year` detail shards
- `scripts/semantic/build-embeddings.mjs` builds the browser semantic index from the same full catalog mirror.
  - `data/semantic/paper-embeddings-all-MiniLM-L6-v2.chunked.meta.json`: semantic chunk manifest
  - `data/semantic/chunks/*.f32.bin`: semantic binary chunks split by shard and part

## Runtime loading

- First load only fetches `data/catalog/index.json`, which is much smaller than the old monolithic catalog.
- Venue/year counts, keyword search, and semantic ranking all work from the index payload.
- Abstracts and Chinese guides are fetched on demand from the matching venue/year shard when a paper card is expanded.
- Browser semantic search loads the chunk manifest first and then streams the prebuilt chunk binaries into a local in-browser index.
- Semantic rebuilds reuse unchanged per-paper vectors and skip rewriting chunk binaries whose fingerprints have not changed.
- Unofficial discoveries appear as `未分类 / Unclassified` until official sources catch up, after which the daily reconciliation pass removes them from the unofficial queue.

## Deployment notes

- GitHub Pages only needs the built `dist` output, which now includes the lightweight index, shards, and chunked semantic assets.
- The browser semantic model still caches through Transformers.js browser cache after the first successful model download.
- `.github/workflows/discover-unofficial.yml` runs the discovery + reconciliation + rebuild pipeline on a daily schedule with GitHub Actions concurrency protection.
