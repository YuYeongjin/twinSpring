"""
Safe Domain Agent v2 — LLM Tool Calling (ReAct Pattern)
"""
from __future__ import annotations
import logging

from config.state import AgentState
from config.lang_util import lang_instruction
from nodes.react_utils import build_react_subgraph, invoke_subgraph, extract_turn_results
from nodes.domain_agents.safe import _build_safe_chart

logger = logging.getLogger(__name__)


def _system(state: AgentState) -> str:
    lang  = state.get("lang", "ko")
    lines = [
        "당신은 건설현장 안전 모니터링 AI입니다.",
        "헬멧 미착용, 구역 침입, 위험 감지 이벤트를 분석합니다.",
        "",
        "tool 선택 가이드:",
        "  - get_safety_stats         : 전체 안전 통계 (감지 건수, 위반 건수)",
        "  - get_recent_detections    : 최근 감지 이력 목록 (limit 파라미터)",
        "  - list_safe_projects       : 안전 프로젝트 목록",
        "  - get_detection_server_status: 감지 서버 상태 확인",
        "  - get_safe_tab_guide       : 안전 탭 사용 안내",
        "",
        "통계 + 최근 감지 이력은 함께 조회하면 차트 데이터가 풍부해집니다.",
    ]
    note = lang_instruction(lang)
    if note:
        lines.append(note)
    return "\n".join(lines)


def _finalize(state: AgentState) -> dict:
    """get_safety_stats + get_recent_detections 결과로 safe_data 차트를 조립합니다."""
    results    = extract_turn_results(state.get("messages", []))
    stats      = results.get("get_safety_stats", {})
    detect_res = results.get("get_recent_detections", {})

    if not stats and not detect_res:
        return {}

    detections = detect_res.get("records", []) if detect_res else []
    safe_data  = _build_safe_chart(stats, detections)
    return {"safe_data": safe_data}


def _make_subgraph():
    from tools.safe_tools import (
        list_safe_projects, get_detection_server_status,
        get_recent_detections, get_safety_stats, get_safe_tab_guide,
    )
    return build_react_subgraph(
        tools=[
            list_safe_projects, get_detection_server_status,
            get_recent_detections, get_safety_stats, get_safe_tab_guide,
        ],
        system_fn=_system,
        finalize_fn=_finalize,
    )


_subgraph = _make_subgraph()


def run_safe_react_agent(state: AgentState) -> dict:
    logger.info("[NODE] ▶ safe_react_agent 진입")
    return invoke_subgraph(_subgraph, state)
