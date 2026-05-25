"""
Multi-Agent 공유 상태 정의

모든 Agent 와 Node 가 동일한 AgentState 를 공유합니다.
add_messages reducer 를 사용하여 messages 필드가 올바르게 누적됩니다.
"""

from typing import Annotated, Literal
from typing_extensions import TypedDict
from langgraph.graph.message import add_messages


# ── 지원 intent 목록 ────────────────────────────────────────────────────────
AgentName = Literal[
    "sensor_agent",
    "bim_agent",
    "simulation_agent",
    "safe_agent",
    "test_agent",
    "tab_guide",
    "chat",
]


class AgentState(TypedDict):
    # ── 공통 ────────────────────────────────────────────────────────────────
    messages: Annotated[list, add_messages]   # 누적 대화 이력
    intent: str | None                        # 현재 처리 intent (프론트 시각화용)
    next_agent: AgentName | None              # Supervisor 라우팅 대상

    # ── DB 쿼리 결과 ────────────────────────────────────────────────────────
    query_result: str | None                  # 원시 DB/RAG 결과 텍스트
    context: str | None                       # RAG 검색 결과

    # ── 컨텍스트 ID ─────────────────────────────────────────────────────────
    bim_project_id: str | None                # 선택된 BIM 프로젝트 ID
    simulation_project_id: str | None         # 선택된 시뮬레이션 프로젝트 ID

    # ── 구조화 응답 (프론트 차트/테이블용) ─────────────────────────────────
    bim_data: dict | None                     # bim_agent 구조화 데이터
    sensor_data: dict | None                  # sensor_agent 구조화 데이터

    # ── 멀티스텝 BIM 대화 ───────────────────────────────────────────────────
    pending_action: dict | None               # BIM 대화 중 대기 액션
