"""
WBS Domain Agent v2 — LLM Tool Calling (ReAct Pattern)
"""
from __future__ import annotations
import logging

from config.state import AgentState
from config.lang_util import lang_instruction
from nodes.react_utils import build_react_subgraph, invoke_subgraph, extract_turn_results
from nodes.domain_agents.wbs import _build_tasks_chart, _build_projects_chart

logger = logging.getLogger(__name__)


def _system(state: AgentState) -> str:
    lang    = state.get("lang", "ko")
    proj_id = state.get("wbs_project_id")
    lines   = [
        "당신은 WBS(Work Breakdown Structure) 공정 관리 AI입니다.",
        f"현재 wbs_project_id: {proj_id or '없음 (list_wbs_projects 로 조회 가능)'}",
        "project_id 필요한 tool 호출 시 위 값을 사용하세요.",
        "",
        "tool 선택 가이드:",
        "  - list_wbs_projects  : WBS 프로젝트 목록 조회",
        "  - get_wbs_project    : 특정 프로젝트 상세 조회",
        "  - create_wbs_project : 새 WBS 프로젝트 생성 (name 필수)",
        "  - delete_wbs_project : 프로젝트 삭제 (project_id 필수)",
        "  - list_wbs_tasks     : 프로젝트의 태스크 목록 조회",
        "  - add_wbs_task       : 태스크 추가 (project_id, name 필수)",
        "  - update_wbs_task    : 태스크 수정 (task_id, status/progress 등)",
        "  - delete_wbs_task    : 태스크 삭제 (task_id 필수)",
        "  - list_wbs_links     : 태스크 연결(선후행) 관계 조회",
    ]
    note = lang_instruction(lang)
    if note:
        lines.append(note)
    return "\n".join(lines)


def _finalize(state: AgentState) -> dict:
    """list_wbs_tasks / list_wbs_projects 결과로 wbs_data 차트를 조립합니다."""
    results = extract_turn_results(state.get("messages", []))
    proj_id = state.get("wbs_project_id")

    tasks_result    = results.get("list_wbs_tasks")
    projects_result = results.get("list_wbs_projects")

    wbs_data = None
    if tasks_result:
        wbs_data = _build_tasks_chart(tasks_result, proj_id)
    elif projects_result:
        wbs_data = _build_projects_chart(projects_result)

    if wbs_data is None:
        return {}
    return {"wbs_data": wbs_data}


def _make_subgraph():
    from tools.wbs_tool import (
        list_wbs_projects, get_wbs_project, create_wbs_project,
        delete_wbs_project, list_wbs_tasks, add_wbs_task,
        update_wbs_task, delete_wbs_task, list_wbs_links,
    )
    return build_react_subgraph(
        tools=[
            list_wbs_projects, get_wbs_project, create_wbs_project,
            delete_wbs_project, list_wbs_tasks, add_wbs_task,
            update_wbs_task, delete_wbs_task, list_wbs_links,
        ],
        system_fn=_system,
        finalize_fn=_finalize,
    )


_subgraph = _make_subgraph()


def run_wbs_react_agent(state: AgentState) -> dict:
    logger.info("[NODE] ▶ wbs_react_agent 진입")
    return invoke_subgraph(_subgraph, state)
