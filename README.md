# TopVenuePapers

Vue + Vite explorer for 2026 CCF-A / ICLR papers in LLM, VLM, VLA and MLLM-related directions.

The app ships a lazy paper catalog and a prebuilt semantic embedding index. On GitHub Pages it runs fully in the browser: the page loads the paper JSON, downloads the Transformers.js model on demand, and ranks papers against the local embedding index.

The semantic model uses the browser Cache API through Transformers.js. After the first successful download, later visits reuse the cached model files instead of downloading them again.

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

Expected Pages URL:

```text
https://anyacoder.github.io/TopVenuePapers/
```
