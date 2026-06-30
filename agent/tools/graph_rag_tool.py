"""
GraphRAG 검색 도구 — Local Search / Global Search

Local:  쿼리 임베딩 → 유사 엔티티 → 1-hop 관계 탐색 → 소속 커뮤니티 요약
Global: 쿼리 임베딩 → 커뮤니티 요약 유사도 검색 → 상위 커뮤니티 반환

그래프 인덱스 미준비 시 기존 pgvector RAG로 자동 폴백.
"""
from __future__ import annotations

import logging

import psycopg
from langchain_core.documents import Document
from langchain_huggingface import HuggingFaceEmbeddings

from config.settings import (
    EMBEDDING_MODEL,
    VECTOR_DB_HOST, VECTOR_DB_PORT, VECTOR_DB_NAME,
    VECTOR_DB_USER, VECTOR_DB_PASSWORD,
)

logger = logging.getLogger(__name__)

_embeddings: HuggingFaceEmbeddings | None = None


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
        password=VECTOR_DB_PASSWORD, connect_timeout=10,
    )


def _is_graph_ready() -> bool:
    """graph_communities 테이블 존재 여부 + 데이터 유무 확인."""
    try:
        with _get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables
                        WHERE table_name = 'graph_communities'
                    )
                """)
                if not cur.fetchone()[0]:
                    return False
                cur.execute("SELECT COUNT(*) FROM graph_communities")
                return cur.fetchone()[0] > 0
    except Exception:
        return False


# ── Local Search ─────────────────────────────────────────────────────────────

def local_search(query: str, k: int = 4) -> list[Document]:
    """
    1) 쿼리 임베딩 → 유사 엔티티 k개 검색
    2) 해당 엔티티의 1-hop 관계 탐색
    3) 소속 커뮤니티 요약 첨부
    """
    emb = _get_embeddings().embed_query(query)
    try:
        with _get_conn() as conn:
            with conn.cursor() as cur:
                # 1) 유사 엔티티 검색 (cosine distance)
                cur.execute("""
                    SELECT id, name, type, description, source_code
                    FROM graph_entities
                    ORDER BY embedding <=> %s::vector
                    LIMIT %s
                """, (emb, k))
                entities = cur.fetchall()

                if not entities:
                    return []

                entity_ids = [e[0] for e in entities]

                # 2) 1-hop 관계 탐색
                cur.execute("""
                    SELECT e1.name, r.relation_type, e2.name, r.description
                    FROM graph_relationships r
                    JOIN graph_entities e1 ON r.source_entity_id = e1.id
                    JOIN graph_entities e2 ON r.target_entity_id = e2.id
                    WHERE r.source_entity_id = ANY(%s)
                       OR r.target_entity_id = ANY(%s)
                    LIMIT 20
                """, (entity_ids, entity_ids))
                relations = cur.fetchall()

                # 3) 소속 커뮤니티 요약 (rank 내림차순 상위 2개)
                cur.execute("""
                    SELECT title, summary
                    FROM graph_communities
                    WHERE entity_ids && %s
                    ORDER BY rank DESC
                    LIMIT 2
                """, (entity_ids,))
                communities = cur.fetchall()

        ent_text = "\n".join(
            f"[{e[2]}] {e[1]}: {e[3] or ''} (출처: {e[4] or ''})"
            for e in entities
        )
        rel_text = "\n".join(
            f"  {r[0]} --[{r[1]}]--> {r[2]}" + (f": {r[3]}" if r[3] else "")
            for r in relations
        )
        comm_text = "\n\n".join(
            f"[{c[0]}]\n{c[1]}" for c in communities
        )

        content = f"## 관련 엔티티\n{ent_text}"
        if rel_text:
            content += f"\n\n## 관계\n{rel_text}"
        if comm_text:
            content += f"\n\n## 커뮤니티 컨텍스트\n{comm_text}"

        return [Document(
            page_content=content,
            metadata={"search_type": "local", "entity_count": len(entities)},
        )]

    except Exception:
        logger.error("[graph_rag] local_search 실패", exc_info=True)
        return []


# ── Global Search ─────────────────────────────────────────────────────────────

def global_search(query: str, k: int = 3) -> list[Document]:
    """
    커뮤니티 요약 임베딩으로 쿼리와 가장 유사한 커뮤니티 k개 반환.
    광역 질의("전체 콘크리트 기준 요약")에 적합.
    """
    emb = _get_embeddings().embed_query(query)
    try:
        with _get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT title, summary, community_id, rank
                    FROM graph_communities
                    ORDER BY summary_embedding <=> %s::vector
                    LIMIT %s
                """, (emb, k))
                communities = cur.fetchall()

        return [
            Document(
                page_content=f"[{c[0]}]\n{c[1]}",
                metadata={"search_type": "global", "community_id": c[2], "rank": c[3]},
            )
            for c in communities
        ]

    except Exception:
        logger.error("[graph_rag] global_search 실패", exc_info=True)
        return []


# ── 통합 진입점 ───────────────────────────────────────────────────────────────

def search_graph_docs(
    query: str,
    rag_type: str = "local",
    k: int = 4,
) -> list[Document]:
    """
    GraphRAG 검색 통합 진입점.
    그래프 인덱스 미준비 또는 결과 없음 → 기존 pgvector RAG로 자동 폴백.
    """
    if not _is_graph_ready():
        logger.info("[graph_rag] 인덱스 미준비 → pgvector 폴백")
        from tools.construction_rag_tool import search_construction_docs
        return search_construction_docs(query, k=k)

    docs = global_search(query, k=k) if rag_type == "global" else local_search(query, k=k)

    if not docs:
        logger.info("[graph_rag] 결과 없음 → pgvector 폴백")
        from tools.construction_rag_tool import search_construction_docs
        return search_construction_docs(query, k=k)

    return docs
