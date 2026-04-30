#!/usr/bin/env python
from __future__ import annotations

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

try:
    import numpy as np
    from sentence_transformers import SentenceTransformer
except ImportError as exc:
    raise SystemExit(
        "Missing semantic dependencies. Install them with: "
        "python -m pip install -r scripts/semantic/requirements.txt"
    ) from exc


DEFAULT_MODEL = "all-MiniLM-L6-v2"
DEFAULT_EMBEDDINGS = "data/semantic/paper-embeddings-all-MiniLM-L6-v2.npz"
DEFAULT_META = "data/semantic/paper-embeddings-all-MiniLM-L6-v2.meta.json"


class SemanticIndex:
    def __init__(self, model_name: str, embeddings_path: Path, meta_path: Path) -> None:
        if not embeddings_path.exists() or not meta_path.exists():
            raise FileNotFoundError(
                "Semantic index is missing. Run: npm run semantic:build"
            )

        self.model_name = model_name
        self.meta = json.loads(meta_path.read_text(encoding="utf-8"))
        self.ids = self.meta["ids"]
        self.titles = self.meta.get("titles") or self.ids
        self.embeddings = np.load(embeddings_path)["embeddings"].astype("float32")

        if self.embeddings.shape[0] != len(self.ids):
            raise ValueError("Embedding row count does not match metadata ids.")

        print(f"Loading SentenceTransformer('{model_name}')")
        self.model = SentenceTransformer(model_name)
        print(f"Semantic index ready: {len(self.ids)} papers x {self.embeddings.shape[1]} dims")

    def search(self, query: str, top_k: int) -> list[dict]:
        top_k = max(1, min(top_k, len(self.ids)))
        query_embedding = self.model.encode(
            [query],
            normalize_embeddings=True,
            convert_to_numpy=True,
        )[0].astype("float32")
        scores = self.embeddings @ query_embedding

        if top_k == len(self.ids):
            top_indices = np.argsort(-scores)
        else:
            candidates = np.argpartition(-scores, top_k - 1)[:top_k]
            top_indices = candidates[np.argsort(-scores[candidates])]

        return [
            {
                "id": self.ids[int(index)],
                "score": float(scores[int(index)]),
                "title": self.titles[int(index)],
            }
            for index in top_indices
        ]


class SemanticHandler(BaseHTTPRequestHandler):
    server: "SemanticServer"

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path == "/health":
            self.write_json(
                {
                    "ok": True,
                    "model": self.server.index.model_name,
                    "count": len(self.server.index.ids),
                    "dimensions": int(self.server.index.embeddings.shape[1]),
                }
            )
            return

        if parsed.path == "/search":
            params = parse_qs(parsed.query)
            query = (params.get("q") or [""])[0].strip()
            top_k = parse_int((params.get("top_k") or ["500"])[0], default=500)

            if not query:
                self.write_json({"query": query, "results": []})
                return

            results = self.server.index.search(query, top_k)
            self.write_json({"query": query, "results": results})
            return

        self.send_response(404)
        self.send_cors_headers()
        self.end_headers()

    def write_json(self, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def log_message(self, format: str, *args) -> None:
        print("%s - %s" % (self.address_string(), format % args))


class SemanticServer(ThreadingHTTPServer):
    def __init__(self, address: tuple[str, int], index: SemanticIndex) -> None:
        super().__init__(address, SemanticHandler)
        self.index = index


def parse_int(value: str, default: int) -> int:
    try:
        return int(value)
    except ValueError:
        return default


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve local semantic search.")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--embeddings", default=DEFAULT_EMBEDDINGS)
    parser.add_argument("--meta", default=DEFAULT_META)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    index = SemanticIndex(args.model, Path(args.embeddings), Path(args.meta))
    server = SemanticServer((args.host, args.port), index)
    print(f"Semantic server listening on http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
