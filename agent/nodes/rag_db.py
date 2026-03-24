"""
Node 2: RAG + Database 조회 노드

사용자 질문에서 필요한 데이터를 DB와 벡터스토어에서 수집하고,
LLM이 이를 바탕으로 답변을 생성합니다.
"""

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from state import AgentState
from config import ANTHROPIC_API_KEY, LLM_MODEL
from tools.db_tool import (
    query_sensor_data,
    query_energy_data,
    query_ems_alerts,
    query_ems_thresholds,
)
from tools.rag_tool import search_as_text

_llm = ChatAnthropic(
    model=LLM_MODEL,
    api_key=ANTHROPIC_API_KEY,
    temperature=0.3,
    max_tokens=1024,
)

_KEYWORDS = {
    "sensor": ["센서", "온도", "습도", "dht", "sensor"],
    "energy": ["에너지", "전력", "전압", "전류", "kwh", "kw", "energy", "power"],
    "alert": ["알림", "경보", "alert", "alarm", "경고", "위험"],
    "threshold": ["임계값", "threshold", "기준"],
}


def _detect_targets(text: str) -> list[str]:
    """질문 텍스트에서 조회 대상 테이블을 추론"""
    text_lower = text.lower()
    targets = []
    for target, keywords in _KEYWORDS.items():
        if any(kw in text_lower for kw in keywords):
            targets.append(target)
    return targets or ["sensor", "energy"]  # 기본값


def _fetch_db_context(targets: list[str]) -> str:
    lines = []
    if "sensor" in targets:
        rows = query_sensor_data(limit=5)
        lines.append(f"[최근 센서 데이터 (상위 5건)]\n{_rows_to_text(rows)}")
    if "energy" in targets:
        rows = query_energy_data(limit=5)
        lines.append(f"[최근 에너지 데이터 (상위 5건)]\n{_rows_to_text(rows)}")
    if "alert" in targets:
        rows = query_ems_alerts(limit=5)
        lines.append(f"[최근 EMS 알림 (상위 5건)]\n{_rows_to_text(rows)}")
    if "threshold" in targets:
        rows = query_ems_thresholds()
        lines.append(f"[EMS 임계값 설정]\n{_rows_to_text(rows)}")
    return "\n\n".join(lines) if lines else "조회된 데이터가 없습니다."


def _rows_to_text(rows: list[dict]) -> str:
    if not rows:
        return "데이터 없음"
    headers = list(rows[0].keys())
    lines = [" | ".join(headers)]
    for row in rows:
        lines.append(" | ".join(str(v) for v in row.values()))
    return "\n".join(lines)


_SYSTEM_PROMPT = """당신은 스마트 빌딩 디지털 트윈 시스템의 AI 어시스턴트입니다.
아래에 제공된 데이터베이스 조회 결과와 참고 문서를 바탕으로 사용자의 질문에 정확하고 친절하게 답변하세요.
데이터를 기반으로 명확한 수치와 함께 설명하고, 이상 징후가 있으면 알려주세요.
한국어로 답변하세요."""


def rag_db_node(state: AgentState) -> dict:
    """DB 조회 + RAG 검색 후 LLM으로 답변 생성"""
    last_message = state["messages"][-1]
    user_text = last_message.content if hasattr(last_message, "content") else str(last_message)

    # 1. DB 조회
    targets = _detect_targets(user_text)
    db_context = _fetch_db_context(targets)

    # 2. RAG 검색
    rag_context = search_as_text(user_text, k=3)

    # 3. 컨텍스트 조합
    full_context = f"## 데이터베이스 조회 결과\n{db_context}\n\n## 참고 문서\n{rag_context}"

    # 4. LLM 답변 생성
    response = _llm.invoke(
        [
            SystemMessage(content=_SYSTEM_PROMPT),
            HumanMessage(
                content=f"[참고 데이터]\n{full_context}\n\n[사용자 질문]\n{user_text}"
            ),
        ]
    )

    return {
        "messages": [AIMessage(content=response.content)],
        "query_result": db_context,
        "context": rag_context,
    }
