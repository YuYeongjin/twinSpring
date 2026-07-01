"""
BIM-WBS Bridge Agent v2 — LLM Tool Calling (ReAct Pattern)

BIM 부재 조작(이동·회전·크기)과 WBS 스케줄링을 LLM이 통합 처리합니다.
directAgent="bim_wbs_agent" 로 직접 라우팅됩니다 (LLM 라우터 스킵).
"""
from __future__ import annotations
import logging

from config.state import AgentState
from config.lang_util import lang_instruction
from nodes.react_utils import build_react_subgraph, invoke_subgraph, extract_turn_results

logger = logging.getLogger(__name__)


def _system(state: AgentState) -> str:
    lang       = state.get("lang", "ko")
    bim_pid    = state.get("bim_project_id", "")
    sel_ids    = state.get("selected_element_ids") or []
    lines      = [
        "당신은 BIM-WBS 통합 에이전트입니다.",
        "BIM 부재 조작과 WBS 공정 스케줄링을 함께 처리합니다.",
        f"현재 bim_project_id: {bim_pid or '없음'}",
        f"현재 선택된 부재 IDs: {sel_ids if sel_ids else '없음 (전체 부재에 적용)'}",
        "",
        "tool 선택 가이드:",
        "  - translate_bim_elements        : 전체 부재 이동 (delta_x/y/z, project_id 필수)",
        "  - translate_selected_elements   : 선택 부재 이동 (element_ids, delta_x/y/z 필수)",
        "  - transform_bim_elements        : 부재 회전·크기 변환 (delta_rot_x/y/z, scale_x/y/z)",
        "  - get_structural_summary        : 구조 안정성 분석 (project_id 필수)",
        "  - schedule_wbs_for_bim          : BIM 기반 WBS 일정 생성·업데이트",
        "",
        "부재 이동/회전/크기 tool 호출 시 bim_project_id 를 반드시 포함하세요.",
        "선택된 부재가 있으면 translate_selected_elements 를 우선 사용하세요.",
    ]
    note = lang_instruction(lang)
    if note:
        lines.append(note)
    return "\n".join(lines)


def _finalize(state: AgentState) -> dict:
    """tool 결과에서 bim_data 액션 신호와 intent 를 추출합니다."""
    results = extract_turn_results(state.get("messages", []))
    out: dict = {}

    struct = results.get("get_structural_summary")
    if struct and struct.get("success"):
        out["bim_data"] = {"action": "structural_analysis", **struct}
        out["intent"]   = "structural_analysis"
        return out

    wbs_result = results.get("schedule_wbs_for_bim")
    if wbs_result and wbs_result.get("success"):
        action = wbs_result.get("action", "wbs_updated")
        out["bim_data"] = {"action": action, **wbs_result}
        out["intent"]   = action
        return out

    # 이동/변환 → GLB 리로드 신호
    for tool_name in ("translate_bim_elements", "translate_selected_elements", "transform_bim_elements"):
        r = results.get(tool_name)
        if r and r.get("action") == "glb_reload":
            out["bim_data"] = {"action": "glb_reload"}
            return out

    return out


def _make_subgraph():
    from tools.bim_tools import (
        translate_bim_elements, translate_selected_elements, transform_bim_elements,
    )
    from tools.bim_wbs_tools import get_structural_summary, schedule_wbs_for_bim
    return build_react_subgraph(
        tools=[
            translate_bim_elements, translate_selected_elements, transform_bim_elements,
            get_structural_summary, schedule_wbs_for_bim,
        ],
        system_fn=_system,
        finalize_fn=_finalize,
    )


_subgraph = _make_subgraph()


def run_bim_wbs_react_agent(state: AgentState) -> dict:
    logger.info("[NODE] ▶ bim_wbs_react_agent 진입")
    return invoke_subgraph(_subgraph, state)
