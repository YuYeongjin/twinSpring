"""
Orchestrator Domain Agent v2 — LLM Tool Calling (ReAct Pattern)

WBS / BIM / Safe 데이터를 LLM이 tool 호출로 수집한 뒤
통합관제 차트 데이터(report_data)를 finalize 에서 조립합니다.
"""
from __future__ import annotations
import logging

from config.state import AgentState
from config.lang_util import lang_instruction
from nodes.react_utils import build_react_subgraph, invoke_subgraph, extract_turn_results
from nodes.domain_agents.orchestrator import _build_report_charts

logger = logging.getLogger(__name__)


def _system(state: AgentState) -> str:
    lang    = state.get("lang", "ko")
    wbs_pid = state.get("wbs_project_id", "")
    lines   = [
        "당신은 디지털 트윈 통합관제 AI입니다.",
        "WBS 공정, BIM 부재, 안전 감지 현황을 종합해 보고서를 생성합니다.",
        f"현재 wbs_project_id: {wbs_pid or '없음'}",
        "",
        "tool 선택 가이드 (통합 보고서는 3개 모두 호출 권장):",
        "  - collect_wbs_overview  : 전체 WBS 프로젝트 진행 현황 수집",
        "  - collect_bim_overview  : 전체 BIM 프로젝트·부재 현황 수집",
        "  - collect_safe_overview : 전체 안전 감지 통계 수집",
        "  - collect_project_links : 특정 WBS 프로젝트의 BIM·Safe 연계 정보 (wbs_project_id 필요)",
    ]
    note = lang_instruction(lang)
    if note:
        lines.append(note)
    return "\n".join(lines)


def _finalize(state: AgentState) -> dict:
    """collect_* 결과로 통합 report_data 와 차트 5종을 조립합니다."""
    results = extract_turn_results(state.get("messages", []))

    wbs  = results.get("collect_wbs_overview",  {})
    bim  = results.get("collect_bim_overview",   {})
    safe = results.get("collect_safe_overview",  {})
    links = results.get("collect_project_links", {})

    if not any([wbs, bim, safe]):
        return {}

    charts = _build_report_charts(wbs, bim, safe)
    report_data = {
        "wbs":    wbs,
        "bim":    bim,
        "safe":   safe,
        "links":  links,
        "charts": charts,
    }
    return {"report_data": report_data}


def _make_subgraph():
    from tools.report_tool import (
        collect_wbs_overview, collect_bim_overview,
        collect_safe_overview, collect_project_links,
    )
    return build_react_subgraph(
        tools=[
            collect_wbs_overview, collect_bim_overview,
            collect_safe_overview, collect_project_links,
        ],
        system_fn=_system,
        finalize_fn=_finalize,
    )


_subgraph = _make_subgraph()


def run_orchestrator_react_agent(state: AgentState) -> dict:
    logger.info("[NODE] ▶ orchestrator_react_agent 진입")
    return invoke_subgraph(_subgraph, state)
