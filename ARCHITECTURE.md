# Architecture

## Data flow

- `scripts/ingest-openreview.mjs` pulls official ICLR 2026 main-conference papers from OpenReview.
- `scripts/ingest-ccfa-2026.mjs` pulls official CVPR 2026 and AAAI-26 main-conference papers and merges them with ICLR plus any existing Chinese guides.
- `scripts/build-catalog-shards.mjs` turns the full catalog into:
  - `public/data/catalog/index.json`: lightweight search/list index
  - `public/data/catalog/shards/*.json`: per `venue/year` detail shards
- `scripts/semantic/build-embeddings.mjs` builds the browser semantic index from the same full catalog mirror.

## Runtime loading

- First load only fetches `data/catalog/index.json`, which is much smaller than the old monolithic catalog.
- Venue/year counts, keyword search, and semantic ranking all work from the index payload.
- Abstracts and Chinese guides are fetched on demand from the matching venue/year shard when a paper card is expanded.

## Deployment notes

- GitHub Pages only needs the built `dist` output, which now includes the lightweight index, shards, and semantic assets.
- The browser semantic model still caches through Transformers.js browser cache after the first successful model download.
