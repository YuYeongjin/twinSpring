"""
Construction RAG Agent — 건설 공정서·시방서 전문 에이전트

담당:
  - 한국 건설 표준 시방서(KCS) / 설계기준(KDS) 검색
  - 공종별 시공 기준, 품질 관리, 안전 규정 답변
  - 검색 결과에 출처(규격코드·시리즈·제목) 명시
  - 인덱싱된 문서 목록 안내
"""

import logging

from langchain_core.messages import SystemMessage, AIMessage
from langgraph.prebuilt import create_react_agent

logger = logging.getLogger(__name__)

from config.llm_config import llm_chat
from tools.construction_rag_tool import CONSTRUCTION_RAG_TOOLS
from config.lang_util import detect_lang, lang_instruction, error_msg


# ── 시스템 프롬프트 ────────────────────────────────────────────────────────────
_SYSTEM = SystemMessage(content=(
    "You are a Korean Construction Standards Expert AI specializing in "
    "KCS (Korean Construction Specifications) and KDS (Korean Design Standards). "
    "\n\n"
    "## Role\n"
    "Answer questions about construction processes, specifications, and design standards "
    "by searching the indexed Korean construction documents. "
    "Always cite the source document (규격코드, 시리즈, 제목) in your answer.\n"
    "\n"
    "## Tool Usage Guidelines\n"
    "- **search_spec_tool**: Use this to search KCS/KDS documents for relevant content. "
    "  Search with specific Korean construction terms (공종명, 재료명, 기준값 등). "
    "  If the first search yields insufficient results, try a more specific or rephrased query.\n"
    "- **list_spec_sources**: Use this when the user asks what documents are available, "
    "  or when you need to understand what topics are covered.\n"
    "\n"
    "## Answer Format\n"
    "1. **Summary**: 1~3 sentence direct answer to the question\n"
    "2. **Relevant Provisions**: Key clauses cited from search results (use quotes for direct citations)\n"
    "3. **Source**: Cite the standard code and document name for each reference\n"
    "\n"
    "## Rules\n"
    "- Match the language of the user's input (Korean/English/Japanese).\n"
    "- If no results found, clearly state that the content was not found.\n"
    "- Do not speculate or fabricate content beyond search results.\n"
    "- Source must be based on metadata (code, series) from search results.\n"
    "- Numeric values (temperature, strength, thickness, etc.) must be cited directly from search results.\n"
))


# ReAct 에이전트 (지연 초기화: 임포트 시 임베딩 모델 로딩 방지)
_react_agent = None


def _get_agent():
    global _react_agent
    if _react_agent is None:
        _react_agent = create_react_agent(
            model=llm_chat,
            tools=CONSTRUCTION_RAG_TOOLS,
            prompt=_SYSTEM,
        )
    return _react_agent


def run_rag_agent(state: dict) -> dict:
    """Construction RAG Agent 실행 엔트리포인트."""
    messages = state.get("messages", [])

    # 언어 감지 → 언어별 응답 지시
    recent_text = " ".join(m.content for m in messages[-5:] if hasattr(m, "content"))
    lang = detect_lang(recent_text)
    note = lang_instruction(lang)

    agent_messages = list(messages)
    if note:
        from langchain_core.messages import SystemMessage as SM
        agent_messages = [SM(content=note)] + agent_messages

    try:
        result = _get_agent().invoke({"messages": agent_messages})
        last    = result["messages"][-1]
        content = last.content if hasattr(last, "content") else str(last)
    except Exception:
        logger.error("[rag_agent] 시방서 검색 실패", exc_info=True)
        content = error_msg(lang)

    return {
        "messages": [AIMessage(content=content)],
        "intent":   "rag_agent",
    }
