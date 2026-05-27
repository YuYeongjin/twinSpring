"""
Construction RAG Agent — 건설 공정서·시방서 전문 에이전트

담당:
  - 한국 건설 표준 시방서(KCS) / 설계기준(KDS) 검색
  - 공종별 시공 기준, 품질 관리, 안전 규정 답변
  - 검색 결과에 출처(규격코드·시리즈·제목) 명시
  - 인덱싱된 문서 목록 안내
"""

from langchain_core.messages import SystemMessage, AIMessage
from langgraph.prebuilt import create_react_agent

from config.llm_config import llm_chat
from tools.construction_rag_tool import CONSTRUCTION_RAG_TOOLS
from config.lang_util import detect_lang, lang_instruction


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
    "1. **핵심 답변**: 질문에 직접 답하는 1~3문장 요약\n"
    "2. **관련 규정**: 검색된 문서에서 인용한 핵심 조항 (직접 인용 시 따옴표 사용)\n"
    "3. **출처**: 각 인용의 규격코드와 문서명 명시\n"
    "\n"
    "## Rules\n"
    "- 검색 결과가 없으면 솔직하게 '해당 내용을 찾지 못했습니다'라고 밝히세요.\n"
    "- 검색 결과 밖의 내용을 추측하거나 창작하지 마세요.\n"
    "- 출처는 반드시 검색 결과의 메타데이터(code, series)를 기반으로 명시하세요.\n"
    "- 수치(온도, 강도, 두께 등)는 검색 결과에서 직접 인용하세요.\n"
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
    except Exception as e:
        content = (
            f"공정서/시방서 검색 중 오류가 발생했습니다: {e}\n\n"
            "build_rag_index.py 스크립트를 먼저 실행하여 문서를 인덱싱해 주세요.\n"
            "  python scripts/build_rag_index.py"
        )

    return {
        "messages": [AIMessage(content=content)],
        "intent":   "rag_agent",
    }
