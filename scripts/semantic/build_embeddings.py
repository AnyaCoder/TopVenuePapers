#!/usr/bin/env python
from __future__ import annotations

import argparse
import json
from pathlib import Path

try:
    import numpy as np
    from sentence_transformers import SentenceTransformer
except ImportError as exc:
    raise SystemExit(
        "Missing semantic dependencies. Install them with: "
        "python -m pip install -r scripts/semantic/requirements.txt"
    ) from exc


DEFAULT_MODEL = "all-MiniLM-L6-v2"
DEFAULT_CATALOG = "public/data/papers.catalog.json"
DEFAULT_OUT = "data/semantic/paper-embeddings-all-MiniLM-L6-v2.npz"
DEFAULT_META = "data/semantic/paper-embeddings-all-MiniLM-L6-v2.meta.json"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build local paper embeddings with SentenceTransformer."
    )
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--catalog", default=DEFAULT_CATALOG)
    parser.add_argument("--out", default=DEFAULT_OUT)
    parser.add_argument("--meta-out", default=DEFAULT_META)
    parser.add_argument("--batch-size", type=int, default=64)
    args = parser.parse_args()

    catalog_path = Path(args.catalog)
    payload = json.loads(catalog_path.read_text(encoding="utf-8"))
    papers = payload["papers"] if isinstance(payload, dict) else payload
    texts = [paper_to_text(paper) for paper in papers]

    print(f"Loading SentenceTransformer('{args.model}')")
    model = SentenceTransformer(args.model)
    print(f"Encoding {len(texts)} papers...")
    embeddings = model.encode(
        texts,
        batch_size=args.batch_size,
        show_progress_bar=True,
        normalize_embeddings=True,
        convert_to_numpy=True,
    ).astype("float32")

    out_path = Path(args.out)
    meta_path = Path(args.meta_out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    meta_path.parent.mkdir(parents=True, exist_ok=True)

    np.savez_compressed(out_path, embeddings=embeddings)
    meta = {
        "model": args.model,
        "catalog": str(catalog_path),
        "catalogGeneratedAt": payload.get("generatedAt") if isinstance(payload, dict) else None,
        "count": len(papers),
        "dimensions": int(embeddings.shape[1]),
        "normalized": True,
        "ids": [paper["id"] for paper in papers],
        "titles": [paper["title"] for paper in papers],
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Wrote {out_path}")
    print(f"Wrote {meta_path}")


def paper_to_text(paper: dict) -> str:
    fields = [
        paper.get("title", ""),
        paper.get("titleZh", ""),
        paper.get("venue", ""),
        paper.get("track", ""),
        " ".join(paper.get("keywords") or []),
        " ".join(paper.get("categories") or []),
        paper.get("tldr", ""),
        paper.get("abstract", ""),
    ]
    intro = paper.get("introZh") or {}
    fields.extend(str(value) for value in intro.values())
    return " ".join(str(field) for field in fields if field).strip()


if __name__ == "__main__":
    main()
