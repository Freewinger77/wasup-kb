#!/bin/bash
set -e

cd "$(dirname "$0")"

pip install -r requirements.txt

cd frontend && npm ci && npm run build && cd ..

python -m uvicorn backend.app:app --host 0.0.0.0 --port ${PORT:-8000}
