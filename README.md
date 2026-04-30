# TopVenuePapers

Vue + Vite explorer for 2026 CCF-A / ICLR papers in LLM, VLM, VLA and MLLM-related directions.

The app ships a lazy paper catalog and a prebuilt semantic embedding index. On GitHub Pages it runs fully in the browser: the page loads the paper JSON, downloads the Transformers.js model on demand, and ranks papers against the local embedding index.

The semantic model uses the browser Cache API through Transformers.js. After the first successful download, later visits reuse the cached model files instead of downloading them again.

## Unofficial discovery pipeline

The repo also supports a daily unofficial-paper queue for cases where 2026 papers are announced on X, Xiaohongshu, or personal homepages before official venue pages go live.

- `data/unofficial/unofficial-papers.json` stores candidate and accepted-but-not-yet-official entries.
- `npm run papers:unofficial:discover` uses the Zhipu web search + reader flow to discover likely papers.
- `npm run papers:unofficial:reconcile` re-checks unofficial entries and removes them from the queue once they appear in the official catalog mirror.
- `npm run pipeline:refresh:discover` runs discovery, reconciliation, catalog rebuild, semantic rebuild, and validation in one pass.

Set `ZHIPU_API_KEY` before running the discovery steps locally or in GitHub Actions.

## Local development

```bash
npm ci
npm run dev -- --host 127.0.0.1 --port 4174
```

For local semantic search with the Node helper:

```bash
npm run semantic:serve:mirror
```

## GitHub Pages

Push to `main` and GitHub Actions will install dependencies, validate the catalog, build the Vite app, and publish `dist` to Pages.

There is also a scheduled workflow, `Discover Unofficial Papers`, which can run daily after adding the `ZHIPU_API_KEY` repository secret.

Expected Pages URL:

```text
https://anyacoder.github.io/TopVenuePapers/
```
