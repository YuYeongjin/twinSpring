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
    rag_type: Optional[str]     # "local" (특정 조항) | "global" (전체 요약)
    lang: Optional[str]         # ko|en|ja

    # ── RAG 노드 출력 ────────────────────────────────────────────────────────
    rag_context: Optional[str]  # 검색된 시방서/문서 텍스트

    # ── Domain Agent 출력 ───────────────────────────────────────────────────
    tool_results: Optional[dict]  # tool 실행 결과 JSON

    # ── 컨텍스트 ID (프론트엔드 전달) ────────────────────────────────────────
    bim_project_id: Optional[str]
    simulation_project_id: Optional[str]
    wbs_project_id: Optional[str]
    direct_agent: Optional[str]          # 탭 전용 강제 라우팅
    selected_element_ids: Optional[list] # 현재 선택된 BIM 부재 ID 목록

    # ── 구조화 응답 (프론트 차트/테이블용, 하위호환) ─────────────────────────
    bim_data: Optional[dict]
    sensor_data: Optional[dict]
    report_data: Optional[dict]
    wbs_data: Optional[dict]
    safe_data: Optional[dict]
    intent: Optional[str]

    # ── BIM 작업 이력 / 스냅샷 (서버 세션에 지속, 취소·복원용) ─────────────
    bim_undo_stack: Optional[list]   # 역연산 레코드 스택 (최대 50건)
    bim_snapshot:   Optional[list]   # 저장된 전체 부재 데이터 (복원용)
