"""
Orchestrator Domain Agent — LLM 없음, Tool 전용 디스패처

WBS / BIM / Safe 데이터를 수집해 tool_results 에 담아
responder_node 가 통합 보고서를 생성할 수 있게 합니다.
"""
from __future__ import annotations

import json
import logging

from config.state import AgentState

logger = logging.getLogger(__name__)


def _invoke(tool_fn, args: dict) -> dict:
    logger.info("[orchestrator] tool 호출: %s args=%s", tool_fn.name, args)
    try:
        raw = tool_fn.invoke(args)
        return json.loads(raw) if isinstance(raw, str) else raw
    except Exception as e:
        logger.error("[orchestrator] %s 실패: %s", tool_fn.name, e)
        return {"success": False, "error": str(e)}


def run_orchestrator_agent(state: AgentState) -> dict:
    logger.info("[NODE] ▶ orchestrator_agent 진입")
    from tools.report_tool import (
        collect_wbs_overview, collect_bim_overview, collect_safe_overview,
    )

    wbs  = _invoke(collect_wbs_overview, {})
    bim  = _invoke(collect_bim_overview, {})
    safe = _invoke(collect_safe_overview, {})

    # 특정 WBS 프로젝트 링크 수집 (project_id 있을 때만)
    links = {}
    wbs_project_id = state.get("wbs_project_id")
    if wbs_project_id:
        from tools.report_tool import collect_project_links
        links = _invoke(collect_project_links, {"wbs_project_id": str(wbs_project_id)})

    report_data = {
        "wbs":   wbs,
        "bim":   bim,
        "safe":  safe,
        "links": links,
    }

    return {
        "tool_results": {
            "data":        report_data,
            "report_data": report_data,
        },
        "report_data": report_data,
    }
