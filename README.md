# TopVenuePapers

Vue + Vite explorer for 2026 CCF-A / ICLR papers in LLM, VLM, VLA and MLLM-related directions.

The app ships a lazy paper catalog and a prebuilt semantic embedding index. On GitHub Pages it runs fully in the browser: the page loads the paper JSON, downloads the Transformers.js model on demand, and ranks papers against the local embedding index.

The semantic model uses the browser Cache API through Transformers.js. After the first successful download, later visits reuse the cached model files instead of downloading them again.

## Unofficial discovery pipeline

The repo also supports a daily unofficial-paper queue for cases where 2026 papers are announced on X, Xiaohongshu, GitHub, arXiv, lab pages, or personal homepages before official venue pages go live.

- `data/unofficial/unofficial-papers.json` stores candidate and accepted-but-not-yet-official entries.
- `public/data/unofficial/unofficial-papers.json` mirrors that queue for the `New Finding` page.
- `npm run papers:unofficial:discover` uses a Codex-style staged search loop: Zhipu first plans high-recall queries, the script runs static source probes across X/GitHub/arXiv/OpenReview/homepages/Chinese web, then evidence-derived follow-up queries trace likely titles, repositories, and venue-year signals. Zhipu chat then extracts the clean paper title, status, venue evidence, and source URL.
- `npm run papers:unofficial:reconcile` re-checks unofficial entries and removes them from the queue once they appear in the official catalog mirror.
- `npm run pipeline:refresh:discover` runs discovery, reconciliation, catalog rebuild, semantic rebuild, and validation in one pass.

Set `ZHIPU_API_KEY` before running the discovery steps locally or in GitHub Actions. Local extraction heuristics are disabled by default; the script only keeps minimal safety guards for malformed titles, generic homepages, official-catalog duplicates, and missing URLs. If Zhipu returns `429 Too Many Requests`, the shared client backs off before retrying. Discovery traces include optional model-planning prompts, selected query intents, follow-up parent URLs, rejected search evidence, and compact per-item extraction prompts for debugging recall without overloading the chat model.

## Local development

```bash
npm ci
npm run dev -- --host 127.0.0.1 --port 4174
```

To preview the GitHub Pages build locally:

```bash
npm run build:pages
npm run preview:pages
```

Then open `http://127.0.0.1:4182/`. The local preview redirects to `/TopVenuePapers/` automatically so the production asset paths resolve correctly.

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
