"""
Supervisor 기반 Multi-Agent 공유 상태 정의
"""
from __future__ import annotations

from typing import Annotated, Optional
from typing_extensions import TypedDict
from langgraph.graph.message import add_messages


class AgentState(TypedDict):
    # ── 대화 이력 ────────────────────────────────────────────────────────────
    messages: Annotated[list, add_messages]

    # ── 라우터 출력 ──────────────────────────────────────────────────────────
    domain: Optional[str]       # bim|sensor|simulation|safe|wbs|test|orchestrator|chat
    need_rag: Optional[bool]    # 시방서/RAG 검색 필요 여부
    lang: Optional[str]         # ko|en|ja

    # ── RAG 노드 출력 ────────────────────────────────────────────────────────
    rag_context: Optional[str]  # 검색된 시방서/문서 텍스트

    # ── Domain Agent 출력 ───────────────────────────────────────────────────
    tool_results: Optional[dict]  # tool 실행 결과 JSON

    # ── 컨텍스트 ID (프론트엔드 전달) ────────────────────────────────────────
    bim_project_id: Optional[str]
    simulation_project_id: Optional[str]
    wbs_project_id: Optional[str]
    direct_agent: Optional[str]     # 탭 전용 강제 라우팅

    # ── 구조화 응답 (프론트 차트/테이블용, 하위호환) ─────────────────────────
    bim_data: Optional[dict]
    sensor_data: Optional[dict]
    report_data: Optional[dict]
    intent: Optional[str]
