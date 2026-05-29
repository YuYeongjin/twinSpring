"""
Multi-Agent 공유 상태 정의

모든 Agent 와 Node 가 동일한 AgentState 를 공유합니다.
add_messages reducer 를 사용하여 messages 필드가 올바르게 누적됩니다.
"""
from __future__ import annotations   # Python 3.9 호환

from typing import Annotated, Literal, Optional
from typing_extensions import TypedDict
from langgraph.graph.message import add_messages


# ── 지원 intent 목록 ────────────────────────────────────────────────────────
AgentName = Literal[
    "sensor_agent",
    "bim_agent",
    "simulation_agent",
    "safe_agent",
    "test_agent",
    "rag_agent",
    "wbs_agent",
    "orchestrator",
    "tab_guide",
    "chat",
]


class AgentState(TypedDict):
    # ── 공통 ────────────────────────────────────────────────────────────────
    messages: Annotated[list, add_messages]        # 누적 대화 이력
    intent: Optional[str]                          # 현재 처리 intent (프론트 시각화용)
    next_agent: Optional[AgentName]                # Supervisor 라우팅 대상

    # ── DB 쿼리 결과 ────────────────────────────────────────────────────────
    query_result: Optional[str]                    # 원시 DB/RAG 결과 텍스트
    context: Optional[str]                         # RAG 검색 결과

    # ── 컨텍스트 ID ─────────────────────────────────────────────────────────
    bim_project_id: Optional[str]                  # 선택된 BIM 프로젝트 ID
    simulation_project_id: Optional[str]           # 선택된 시뮬레이션 프로젝트 ID
    wbs_project_id: Optional[str]                  # 선택된 WBS 프로젝트 ID
    direct_agent: Optional[str]                    # 강제 라우팅 에이전트 (탭 전용 채팅)

    # ── 구조화 응답 (프론트 차트/테이블용) ─────────────────────────────────
    bim_data: Optional[dict]                       # bim_agent 구조화 데이터
    sensor_data: Optional[dict]                    # sensor_agent 구조화 데이터
    report_data: Optional[dict]                    # orchestrator 보고서 데이터

