"""
Shared RAG Node — 통합 건설 시방서/문서 검색

모든 도메인이 공유하는 단일 RAG 노드.
router_node 가 need_rag=True 로 판단한 경우에만 실행됩니다.
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

    try:
        from tools.construction_rag_tool import search_construction_docs
        docs = search_construction_docs(user_text, k=4)
        if not docs:
            return {"rag_context": ""}

        parts = []
        for doc in docs:
            meta = doc.metadata
            src  = f"{meta.get('code', '')} {meta.get('title', '')}".strip()
            if not src:
                src = meta.get("source", "")
            parts.append(f"[{src}]\n{doc.page_content[:400]}")

        context = "\n\n".join(parts)
        logger.info("[rag_node] %d 건 문서 검색 완료", len(docs))
        return {"rag_context": context}
    except Exception:
        logger.error("[rag_node] RAG 검색 실패", exc_info=True)
        return {"rag_context": ""}
