"""
GraphRAG 인덱스 구축 — 엔티티 추출 → 그래프 → Leiden 커뮤니티 → 요약

Pipeline:
  1. HWP 파일 파싱 (build_rag_index 재사용)
  2. 청크별 LLM 엔티티·관계 추출
  3. PostgreSQL graph_entities / graph_relationships 저장
  4. Leiden 알고리즘으로 커뮤니티 감지
  5. 커뮤니티별 LLM 요약 생성 → graph_communities 저장

Usage:
    python scripts/build_graph_index.py [--force]
"""
from __future__ import annotations

import sys
import os
import json
import re

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    import igraph as ig
    import leidenalg
except ImportError:
    print("[ERROR] python-igraph 및 leidenalg 패키지가 필요합니다.")
    print("  pip install python-igraph leidenalg")
    sys.exit(1)

import psycopg
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_ollama import ChatOllama
from langchain_core.messages import SystemMessage, HumanMessage
from langchain_text_splitters import RecursiveCharacterTextSplitter

from config.settings import (
    EMBEDDING_MODEL, OLLAMA_BASE_URL, LLM_MODEL,
    VECTOR_DB_HOST, VECTOR_DB_PORT, VECTOR_DB_NAME,
    VECTOR_DB_USER, VECTOR_DB_PASSWORD,
)
from scripts.build_rag_index import collect_hwp_files, extract_hwp_text, _parse_filename_meta

RAG_DIR       = os.path.join(os.path.dirname(os.path.dirname(__file__)), "rag")
CHUNK_SIZE    = 1200
CHUNK_OVERLAP = 200

_llm:        ChatOllama | None          = None
_embeddings: HuggingFaceEmbeddings | None = None


def _get_llm() -> ChatOllama:
    global _llm
    if _llm is None:
        _llm = ChatOllama(
            base_url=OLLAMA_BASE_URL, model=LLM_MODEL,
            temperature=0, timeout=120,
        )
    return _llm


def _get_embeddings() -> HuggingFaceEmbeddings:
    global _embeddings
    if _embeddings is None:
        _embeddings = HuggingFaceEmbeddings(
            model_name=EMBEDDING_MODEL,
            model_kwargs={"device": "cpu"},
            encode_kwargs={"normalize_embeddings": True},
        )
    return _embeddings


def _get_conn() -> psycopg.Connection:
    return psycopg.connect(
        host=VECTOR_DB_HOST, port=VECTOR_DB_PORT,
        dbname=VECTOR_DB_NAME, user=VECTOR_DB_USER,
        password=VECTOR_DB_PASSWORD,
    )


# ── DB 스키마 ────────────────────────────────────────────────────────────────

_CREATE_SQL = """
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS graph_entities (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    type        TEXT,
    description TEXT,
    source_code TEXT,
    embedding   vector(384)
);

CREATE TABLE IF NOT EXISTS graph_relationships (
    id               SERIAL PRIMARY KEY,
    source_entity_id INTEGER REFERENCES graph_entities(id) ON DELETE CASCADE,
    target_entity_id INTEGER REFERENCES graph_entities(id) ON DELETE CASCADE,
    relation_type    TEXT,
    description      TEXT,
    weight           FLOAT DEFAULT 1.0
);

CREATE TABLE IF NOT EXISTS graph_communities (
    id                SERIAL PRIMARY KEY,
    community_id      INTEGER NOT NULL,
    level             INTEGER DEFAULT 0,
    title             TEXT,
    summary           TEXT,
    summary_embedding vector(384),
    entity_ids        INTEGER[],
    rank              FLOAT DEFAULT 0.0
);
"""

_INDEX_SQL = """
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'idx_graph_entities_emb'
    ) THEN
        CREATE INDEX idx_graph_entities_emb
            ON graph_entities USING ivfflat (embedding vector_cosine_ops)
            WITH (lists = 50);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'idx_graph_communities_emb'
    ) THEN
        CREATE INDEX idx_graph_communities_emb
            ON graph_communities USING ivfflat (summary_embedding vector_cosine_ops)
            WITH (lists = 10);
    END IF;
END $$;
"""


def create_schema(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute(_CREATE_SQL)
    conn.commit()
    print("[schema] 테이블 생성/확인 완료")


def is_graph_populated(conn: psycopg.Connection) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM graph_communities")
        return cur.fetchone()[0] > 0


def clear_graph(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "TRUNCATE graph_communities, graph_relationships, graph_entities "
            "RESTART IDENTITY CASCADE"
        )
    conn.commit()
    print("[clear] 기존 그래프 데이터 삭제 완료")


# ── 1단계: 엔티티·관계 추출 ─────────────────────────────────────────────────

_EXTRACT_SYSTEM = SystemMessage(content="""당신은 한국 건설 시방서 지식 추출 전문가입니다.
주어진 건설 시방서 텍스트에서 엔티티와 관계를 추출하세요.

엔티티 유형:
- Standard: KCS/KDS 규격 코드 (예: KCS 24.10.10)
- Concept: 기술 용어 (예: 물시멘트비, 철근피복두께, 배합설계)
- Value: 수치 기준 (예: fck=24MPa, W/C≤0.55, 피복두께30mm)
- Process: 작업 절차 (예: 거푸집설치, 양생, 콘크리트타설)

관계 유형: REFERENCES, DEFINES, APPLIES_TO, RELATED_TO, HAS_VALUE

반드시 아래 JSON 형식으로만 출력하세요 (다른 텍스트 없이):
{"entities":[{"name":"...","type":"Standard|Concept|Value|Process","description":"..."}],"relationships":[{"source":"엔티티명","target":"엔티티명","type":"관계유형","description":"..."}]}

엔티티 최대 8개, 관계 최대 10개.""")


def extract_entities(chunk_text: str, source_code: str) -> dict:
    prompt = f"[출처: {source_code}]\n\n{chunk_text[:900]}"
    try:
        result = _get_llm().invoke([_EXTRACT_SYSTEM, HumanMessage(content=prompt)])
        raw = result.content.strip()
        m = re.search(r'\{[\s\S]*?"entities"[\s\S]*?\}(?=\s*$|\s*```)', raw)
        if not m:
            m = re.search(r'\{[\s\S]*?"entities"[\s\S]*\}', raw)
        if m:
            parsed = json.loads(m.group())
            return {
                "entities":      parsed.get("entities", []),
                "relationships": parsed.get("relationships", []),
            }
    except Exception:
        pass
    return {"entities": [], "relationships": []}


# ── 2단계: 그래프 저장 ────────────────────────────────────────────────────────

def save_entities(
    conn: psycopg.Connection,
    raw_entities: list[dict],
) -> dict[str, int]:
    """엔티티 저장 후 lowercase(name) → db_id 맵 반환 (중복 제거)."""
    entity_map: dict[str, int] = {}
    with conn.cursor() as cur:
        for ent in raw_entities:
            name = (ent.get("name") or "").strip()
            if not name:
                continue
            key = name.lower()
            if key in entity_map:
                continue
            emb = _get_embeddings().embed_query(name)
            cur.execute(
                """INSERT INTO graph_entities (name, type, description, source_code, embedding)
                   VALUES (%s, %s, %s, %s, %s) RETURNING id""",
                (name, ent.get("type"), ent.get("description"), ent.get("source_code"), emb),
            )
            entity_map[key] = cur.fetchone()[0]
    conn.commit()
    return entity_map


def save_relationships(
    conn: psycopg.Connection,
    raw_rels: list[dict],
    entity_map: dict[str, int],
) -> None:
    with conn.cursor() as cur:
        for rel in raw_rels:
            src_key = (rel.get("source") or "").strip().lower()
            tgt_key = (rel.get("target") or "").strip().lower()
            src_id  = entity_map.get(src_key)
            tgt_id  = entity_map.get(tgt_key)
            if not src_id or not tgt_id or src_id == tgt_id:
                continue
            cur.execute(
                """INSERT INTO graph_relationships
                       (source_entity_id, target_entity_id, relation_type, description, weight)
                   VALUES (%s, %s, %s, %s, 1.0)""",
                (src_id, tgt_id, rel.get("type"), rel.get("description")),
            )
    conn.commit()


# ── 3단계: Leiden 커뮤니티 감지 ─────────────────────────────────────────────

def run_leiden(conn: psycopg.Connection) -> dict[int, int]:
    """
    graph_entities + graph_relationships → igraph → Leiden 실행.
    반환: {entity_db_id: community_id}
    """
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM graph_entities ORDER BY id")
        db_ids = [row[0] for row in cur.fetchall()]

        cur.execute(
            "SELECT source_entity_id, target_entity_id, weight FROM graph_relationships"
        )
        edges_raw = cur.fetchall()

    if not db_ids:
        print("  [Leiden] 엔티티 없음 — 건너뜀")
        return {}

    id_to_idx = {db_id: idx for idx, db_id in enumerate(db_ids)}
    n = len(db_ids)
    g = ig.Graph(n=n, directed=False)

    edges, weights = [], []
    for src_id, tgt_id, w in edges_raw:
        si = id_to_idx.get(src_id)
        ti = id_to_idx.get(tgt_id)
        if si is not None and ti is not None and si != ti:
            edges.append((si, ti))
            weights.append(float(w or 1.0))

    has_edges = bool(edges)
    if has_edges:
        g.add_edges(edges)
        g.es["weight"] = weights

    partition = leidenalg.find_partition(
        g,
        leidenalg.ModularityVertexPartition,
        weights="weight" if has_edges else None,
        n_iterations=10,
        seed=42,
    )

    n_comm = len(set(partition.membership))
    print(f"  [Leiden] 엔티티 {n}개 → 커뮤니티 {n_comm}개 감지")
    return {db_ids[idx]: partition.membership[idx] for idx in range(n)}


# ── 4단계: 커뮤니티 요약 ─────────────────────────────────────────────────────

_SUMMARY_SYSTEM = SystemMessage(content="""당신은 건설 시방서 지식 그래프 커뮤니티 요약 전문가입니다.
주어진 엔티티와 관계를 분석해 이 커뮤니티의 핵심 주제를 요약하세요.

출력 형식 (JSON만, 다른 텍스트 없이):
{"title":"핵심 주제 (15자 이내)","summary":"3~5문장. 어떤 규격·개념·수치 기준이 포함되는지 명시."}""")


def summarize_community(
    conn: psycopg.Connection,
    comm_id: int,
    entity_ids: list[int],
) -> dict:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT name, type, description, source_code FROM graph_entities "
            "WHERE id = ANY(%s) LIMIT 25",
            (entity_ids,),
        )
        entities = cur.fetchall()

        cur.execute(
            """SELECT e1.name, r.relation_type, e2.name, r.description
               FROM graph_relationships r
               JOIN graph_entities e1 ON r.source_entity_id = e1.id
               JOIN graph_entities e2 ON r.target_entity_id = e2.id
               WHERE r.source_entity_id = ANY(%s)
               LIMIT 30""",
            (entity_ids,),
        )
        rels = cur.fetchall()

    ent_lines = "\n".join(
        f"- [{e[1]}] {e[0]}: {e[2] or ''} (출처: {e[3] or ''})" for e in entities
    )
    rel_lines = "\n".join(
        f"- {r[0]} --[{r[1]}]--> {r[2]}" + (f": {r[3]}" if r[3] else "")
        for r in rels
    )
    prompt = f"엔티티:\n{ent_lines}\n\n관계:\n{rel_lines}"

    try:
        result = _get_llm().invoke([_SUMMARY_SYSTEM, HumanMessage(content=prompt)])
        raw = result.content.strip()
        m = re.search(r'\{[\s\S]*?"title"[\s\S]*\}', raw)
        if m:
            return json.loads(m.group())
    except Exception:
        pass

    return {
        "title":   f"커뮤니티 {comm_id}",
        "summary": ent_lines[:400] or f"커뮤니티 {comm_id}",
    }


def save_communities(
    conn: psycopg.Connection,
    entity_community_map: dict[int, int],
) -> None:
    from collections import defaultdict

    community_members: dict[int, list[int]] = defaultdict(list)
    for eid, cid in entity_community_map.items():
        community_members[cid].append(eid)

    max_size = max((len(v) for v in community_members.values()), default=1)

    with conn.cursor() as cur:
        for comm_id, eids in sorted(community_members.items()):
            print(f"  [요약] 커뮤니티 {comm_id} ({len(eids)}개 엔티티)...", end=" ", flush=True)
            result  = summarize_community(conn, comm_id, eids)
            title   = result.get("title",   f"커뮤니티 {comm_id}")
            summary = result.get("summary", "")
            emb     = _get_embeddings().embed_query(summary or title)
            rank    = len(eids) / max_size

            cur.execute(
                """INSERT INTO graph_communities
                       (community_id, title, summary, summary_embedding, entity_ids, rank)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                (comm_id, title, summary, emb, eids, rank),
            )
            print("완료")

    conn.commit()
    print(f"\n[save] 커뮤니티 {len(community_members)}개 저장 완료")


# ── 메인 ──────────────────────────────────────────────────────────────────────

def build_graph_index(force: bool = False) -> None:
    print("=" * 60)
    print("  GraphRAG 인덱스 구축 (Leiden 커뮤니티 감지)")
    print(f"  소스 디렉토리: {RAG_DIR}")
    print("=" * 60)

    with _get_conn() as conn:
        create_schema(conn)
        if not force and is_graph_populated(conn):
            print("\n[SKIP] GraphRAG 인덱스가 이미 존재합니다. 재구축하려면 --force 옵션 사용.")
            return
        if force:
            clear_graph(conn)

    hwp_files = collect_hwp_files(RAG_DIR)
    if not hwp_files:
        print(f"[ERROR] {RAG_DIR} 에서 HWP 파일을 찾을 수 없습니다.")
        return

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n\n", "\n", ". ", " ", ""],
    )

    all_entities:      list[dict] = []
    all_relationships: list[dict] = []

    print(f"\n총 {len(hwp_files)}개 HWP 파일 처리 시작\n")
    for hwp_path in hwp_files:
        meta     = _parse_filename_meta(hwp_path)
        raw_text = extract_hwp_text(hwp_path)
        if not raw_text.strip():
            continue

        print(f"[파싱] [{meta['code']}] {meta['title']}")
        chunks = splitter.split_text(raw_text)

        for i, chunk in enumerate(chunks):
            if not chunk.strip():
                continue
            print(f"  청크 {i+1}/{len(chunks)} 엔티티 추출...", end=" ", flush=True)
            extracted = extract_entities(chunk, meta["code"])
            ents = extracted.get("entities", [])
            for ent in ents:
                ent["source_code"] = meta["code"]
                all_entities.append(ent)
            all_relationships.extend(extracted.get("relationships", []))
            print(f"{len(ents)}개")

    print(f"\n총 {len(all_entities)}개 엔티티, {len(all_relationships)}개 관계 추출")

    print("\n[2단계] 그래프 DB 저장 중...")
    with _get_conn() as conn:
        entity_map = save_entities(conn, all_entities)
        print(f"  저장된 엔티티: {len(entity_map)}개 (중복 제거 후)")
        save_relationships(conn, all_relationships, entity_map)
        print("  관계 저장 완료")

        print("\n[3단계] Leiden 커뮤니티 감지 중...")
        entity_community_map = run_leiden(conn)

        print("\n[4단계] 커뮤니티 요약 생성 중...")
        save_communities(conn, entity_community_map)

        print("\n[5단계] 벡터 인덱스 생성 중...")
        with conn.cursor() as cur:
            cur.execute(_INDEX_SQL)
        conn.commit()
        print("  벡터 인덱스 생성 완료")

    print("\n✅ GraphRAG 인덱스 구축 완료!")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="GraphRAG 인덱스 구축 (Leiden)")
    parser.add_argument("--force", action="store_true", help="기존 인덱스 삭제 후 재구축")
    args = parser.parse_args()
    build_graph_index(force=args.force)
