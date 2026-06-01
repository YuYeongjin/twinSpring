# -*- coding: utf-8 -*-
"""
RAG pipeline diagnostic — psycopg v3 version
Run: python scripts/diagnose_rag.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("PYTHONIOENCODING", "utf-8")

from dotenv import load_dotenv
load_dotenv()

from config.settings import (
    VECTOR_DB_HOST, VECTOR_DB_PORT, VECTOR_DB_NAME,
    VECTOR_DB_USER, VECTOR_DB_PASSWORD,
    EMBEDDING_MODEL, get_pgvector_connection,
)

def p(msg): print(msg, flush=True)
OK = "[OK]"; FAIL = "[FAIL]"; WARN = "[WARN]"

p("=" * 60)
p("  RAG Pipeline Diagnostic")
p("=" * 60)

# ── 1. psycopg v3 ────────────────────────────────────────────────
p("\n[1] psycopg v3 driver")
try:
    import psycopg
    p(f"  {OK} psycopg version: {psycopg.__version__}")
except ImportError:
    p(f"  {FAIL} psycopg v3 not installed.")
    p(f"       Fix: pip install 'psycopg[binary]'")
    try:
        import psycopg2
        p(f"  {WARN} psycopg2 found ({psycopg2.__version__}) but langchain-postgres>=0.0.12 needs psycopg v3")
    except ImportError:
        pass
    sys.exit(1)

# ── 2. PostgreSQL connection ──────────────────────────────────────
p("\n[2] PostgreSQL connection")
dsn_display = get_pgvector_connection().replace(VECTOR_DB_PASSWORD, "****")
p(f"  DSN: {dsn_display}")
try:
    conn = psycopg.connect(
        host=VECTOR_DB_HOST, port=VECTOR_DB_PORT, dbname=VECTOR_DB_NAME,
        user=VECTOR_DB_USER, password=VECTOR_DB_PASSWORD, connect_timeout=5,
    )
    p(f"  {OK} Connected to PostgreSQL")
except Exception as e:
    p(f"  {FAIL} Connection failed: {e}")
    p(f"")
    p(f"  Possible reasons:")
    p(f"    1. PostgreSQL pod not running or not accessible")
    p(f"    2. Check VECTOR_DB_HOST/PORT env vars match your k8s service name")
    p(f"    3. For local test: kubectl port-forward svc/<postgres-svc> 5432:5432")
    sys.exit(1)

# ── 3. pgvector extension ─────────────────────────────────────────
p("\n[3] pgvector extension")
with conn.cursor() as cur:
    cur.execute("SELECT extname, extversion FROM pg_extension WHERE extname = 'vector'")
    row = cur.fetchone()
    if row:
        p(f"  {OK} pgvector v{row[1]} installed")
    else:
        p(f"  {FAIL} pgvector extension missing!")
        p(f"       Fix: psql -U postgres -d digital_twin -c 'CREATE EXTENSION vector;'")
        p(f"       (pgvector/pgvector:pg16 image includes this automatically on first start)")

# ── 4. langchain_pg tables ────────────────────────────────────────
p("\n[4] langchain_pg tables")
with conn.cursor() as cur:
    cur.execute("""
        SELECT table_name FROM information_schema.tables
        WHERE table_schema='public'
          AND table_name IN ('langchain_pg_collection','langchain_pg_embedding')
        ORDER BY table_name
    """)
    tables = [r[0] for r in cur.fetchall()]
    if len(tables) == 2:
        p(f"  {OK} Both langchain_pg tables exist")
    else:
        p(f"  {WARN} Found tables: {tables}  (missing tables will be created by PGVector automatically)")

# ── 5. construction_specs collection ─────────────────────────────
p("\n[5] construction_specs collection")
with conn.cursor() as cur:
    try:
        cur.execute("SELECT name, uuid FROM langchain_pg_collection WHERE name='construction_specs'")
        row = cur.fetchone()
        if row:
            coll_uuid = row[1]
            cur.execute("SELECT COUNT(*) FROM langchain_pg_embedding WHERE collection_id=%s", (coll_uuid,))
            count = cur.fetchone()[0]
            if count > 0:
                p(f"  {OK} {count:,} chunks indexed")
                cur.execute("""
                    SELECT cmetadata->>'code', cmetadata->>'title'
                    FROM langchain_pg_embedding WHERE collection_id=%s LIMIT 3
                """, (coll_uuid,))
                for r in cur.fetchall():
                    p(f"       sample: {r[0]}  {r[1]}")
            else:
                p(f"  {FAIL} Collection exists but is EMPTY")
                p(f"       Fix: python scripts/build_rag_index.py")
        else:
            p(f"  {FAIL} 'construction_specs' collection not found")
            p(f"       Fix: python scripts/build_rag_index.py")
    except Exception as e:
        p(f"  {WARN} Query failed (tables may not exist yet): {e}")
        p(f"       Run build_rag_index.py to create tables and populate index")

# ── 6. twin_docs collection ───────────────────────────────────────
p("\n[6] twin_docs collection")
with conn.cursor() as cur:
    try:
        cur.execute("""
            SELECT COUNT(*) FROM langchain_pg_embedding e
            JOIN langchain_pg_collection c ON e.collection_id=c.uuid
            WHERE c.name='twin_docs'
        """)
        count = cur.fetchone()[0]
        if count > 0:
            p(f"  {OK} twin_docs: {count:,} chunks")
        else:
            p(f"  {WARN} twin_docs empty  →  python scripts/init_rag.py")
    except Exception as e:
        p(f"  {WARN} {e}")

# ── 7. HWP source files ───────────────────────────────────────────
p("\n[7] HWP source files")
rag_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "rag")
hwp_files = [
    os.path.join(r, f)
    for r, _, fs in os.walk(rag_dir)
    for f in fs if f.lower().endswith(".hwp")
]
p(f"  agent/rag/ HWP count: {len(hwp_files)}")
if len(hwp_files) == 0:
    p(f"  {FAIL} No HWP files found in {rag_dir}")
    p(f"       Place KCS/KDS .hwp files under agent/rag/<series>/<filename>.hwp")

# ── 8. Embedding model ────────────────────────────────────────────
p("\n[8] Embedding model")
p(f"  Model: {EMBEDDING_MODEL}")
emb = None
try:
    from langchain_huggingface import HuggingFaceEmbeddings
    emb = HuggingFaceEmbeddings(
        model_name=EMBEDDING_MODEL,
        model_kwargs={"device": "cpu"},
        encode_kwargs={"normalize_embeddings": True},
    )
    vec = emb.embed_query("굴착 기준")
    p(f"  {OK} Embedding OK  dim={len(vec)}")
except Exception as e:
    p(f"  {FAIL} Embedding failed: {e}")

# ── 9. End-to-end PGVector search ────────────────────────────────
p("\n[9] PGVector end-to-end search")
if emb:
    try:
        from langchain_postgres.vectorstores import PGVector
        vs = PGVector(
            embeddings=emb,
            collection_name="construction_specs",
            connection=get_pgvector_connection(),
            use_jsonb=True,
        )
        results = vs.similarity_search("굴착 기준 비탈면", k=2)
        if results:
            p(f"  {OK} Search succeeded  results={len(results)}")
            p(f"  Preview: {results[0].page_content[:100].strip()}...")
            p(f"  Source:  {results[0].metadata.get('code','')} {results[0].metadata.get('title','')}")
        else:
            p(f"  {WARN} Connected but 0 results — collection is empty")
            p(f"       Run: python scripts/build_rag_index.py")
    except Exception as e:
        p(f"  {FAIL} PGVector error: {type(e).__name__}: {e}")
else:
    p(f"  (skipped — embedding model failed)")

conn.close()
p("\n" + "=" * 60)
p("  Diagnostic complete")
p("=" * 60)
p("")
p("Quick fix summary:")
p("  1. Start DB:       docker compose up -d db")
p("  2. Build index:    python scripts/build_rag_index.py")
p("  3. Verify:         python scripts/diagnose_rag.py")
