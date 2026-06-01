#!/bin/sh
# Agent container entrypoint
# 1. DB 준비 대기 → 2. RAG 인덱스 자동 구축 → 3. 서버 시작

set -e

echo "=========================================="
echo "  TwinSpring Agent Server Starting"
echo "=========================================="

# ── 1. PostgreSQL 준비 대기 (최대 60초) ───────────────────────────
echo "[1/3] Waiting for PostgreSQL..."
TRIES=0
until python -c "
import psycopg, os
try:
    psycopg.connect(
        host=os.getenv('VECTOR_DB_HOST','localhost'),
        port=int(os.getenv('VECTOR_DB_PORT','5432')),
        dbname=os.getenv('VECTOR_DB_NAME','digital_twin'),
        user=os.getenv('VECTOR_DB_USER','postgres'),
        password=os.getenv('VECTOR_DB_PASSWORD','Abcd1234'),
        connect_timeout=3,
    ).close()
    print('  DB ready')
except Exception as e:
    import sys; print(f'  DB not ready: {e}', file=sys.stderr); sys.exit(1)
" 2>/dev/null; do
    TRIES=$((TRIES+1))
    if [ $TRIES -ge 20 ]; then
        echo "  [WARN] PostgreSQL not available after 60s, skipping RAG index build."
        break
    fi
    echo "  DB not ready, retrying ($TRIES/20)..."
    sleep 3
done

# ── 2. RAG 인덱스 자동 구축 (비어 있을 때만) ─────────────────────
if [ $TRIES -lt 20 ]; then
    echo "[2/3] Building RAG index if needed..."
    python scripts/build_rag_index.py || echo "  [WARN] RAG index build failed (non-fatal)"
else
    echo "[2/3] Skipping RAG index build (DB unavailable)"
fi

# ── 3. Agent 서버 시작 ────────────────────────────────────────────
echo "[3/3] Starting agent server on port 7070..."
exec uvicorn server:app --host 0.0.0.0 --port 7070
