"""
Shared RAG Node — GraphRAG 기반 건설 시방서/문서 검색

모든 도메인이 공유하는 단일 RAG 노드.
router_node 가 need_rag=True 로 판단한 경우에만 실행됩니다.

검색 전략:
  rag_type="local"  → 엔티티 유사도 검색 + 1-hop 관계 탐색 (특정 조항 질의)
  rag_type="global" → 커뮤니티 요약 검색 (전체 기준 요약 질의)
  GraphRAG 인덱스 미준비 → 기존 pgvector 자동 폴백
"""
from __future__ import annotations

import logging
from config.state import AgentState

logger = logging.getLogger(__name__)


def rag_node(state: AgentState) -> dict:
    logger.info("[NODE] ▶ rag_node 진입")
    messages  = state.get("messages", [])
    last      = messages[-1]
    user_text = last.content if hasattr(last, "content") else str(last)
    rag_type  = state.get("rag_type") or "local"

    try:
        from tools.graph_rag_tool import search_graph_docs
        docs = search_graph_docs(user_text, rag_type=rag_type, k=4)
        if not docs:
            return {"rag_context": ""}

        parts = []
        for doc in docs:
            meta        = doc.metadata
            search_type = meta.get("search_type")

            if search_type == "global":
                src = "[GraphRAG 커뮤니티 요약]"
                parts.append(f"{src}\n{doc.page_content[:1000]}")
            elif search_type == "local":
                src = "[GraphRAG 엔티티·관계]"
                parts.append(f"{src}\n{doc.page_content[:1200]}")
            else:
                # pgvector 폴백 결과 (기존 포맷)
                src = f"{meta.get('code', '')} {meta.get('title', '')}".strip()
                if not src:
                    src = meta.get("source", "")
                parts.append(f"[{src}]\n{doc.page_content[:400]}")

        context = "\n\n".join(parts)
        logger.info("[rag_node] %d건 문서 검색 완료 (rag_type=%s)", len(docs), rag_type)
        return {"rag_context": context}

    except Exception:
        logger.error("[rag_node] RAG 검색 실패", exc_info=True)
        return {"rag_context": ""}
