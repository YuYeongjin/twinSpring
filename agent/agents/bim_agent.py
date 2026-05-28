"""
BIM Agent — BIM 모델 관리 전문 에이전트 (pure ReAct)

담당:
  - BIM 부재 생성/삭제 (create_bim_element, delete_bim_element, create_composite_structure)
  - BIM 프로젝트·부재 통계 조회 (list_bim_projects, get_bim_stats)
  - 드론 사진 분석 안내, 구조 해석 조회, IFC 파일 가져오기 안내
"""
from __future__ import annotations

import json
from langchain_core.messages import SystemMessage, AIMessage
from langgraph.prebuilt import create_react_agent

from config.llm_config import llm_chat
from tools.bim_tools import BIM_TOOLS
from config.lang_util import detect_lang, lang_instruction

_SYSTEM_BASE = (
    "You are a BIM (Building Information Modeling) specialist.\n\n"

    "CRITICAL RULE: Always call a tool FIRST. Never answer without tool data.\n\n"

    "Tool selection:\n"
    "- list_bim_projects: FIRST tool for any question about projects or project lists.\n"
    "- get_bim_stats(project_id): element counts per type for a specific project.\n"
    "- create_bim_element: ADD a single element (IfcColumn/IfcBeam/IfcWall/IfcSlab/IfcPier).\n"
    "  → Use the project_id from context if available, otherwise call list_bim_projects first.\n"
    "  → You MUST have position_x, position_y, position_z before calling this tool.\n"
    "  → If coordinates are missing, ask: 'Please provide x, y, z coordinates. Example: 1, 0, 2'\n"
    "- create_composite_structure: preset structures (pier, frame, Eiffel Tower, etc.).\n"
    "  composite_type: pier | building_frame | bridge_span | incheon_bridge\n"
    "                  leaning_tower | eiffel_tower | pyramid\n"
    "  base_x/y/z default to 0 if not specified by user.\n"
    "- create_bim_project: ONLY when user explicitly asks to CREATE a NEW project.\n"
    "- delete_bim_element(element_id): delete by ID.\n"
    "- get_drone_analysis_info: drone/aerial photo analysis questions.\n"
    "- get_structural_analysis(project_id): structural analysis questions.\n"
    "- get_ifc_import_guide: IFC file import questions.\n\n"

    "After tool results: respond in 2-3 sentences with key details (type, count, ID)."
)

_react_agent = create_react_agent(
    model=llm_chat,
    tools=BIM_TOOLS,
)


def run_bim_agent(state: dict) -> dict:
    messages = state.get("messages", [])
    bim_project_id = state.get("bim_project_id")

    recent_text = " ".join(m.content for m in messages[-5:] if hasattr(m, "content"))
    lang = detect_lang(recent_text)
    note = lang_instruction(lang)

    system_parts = [_SYSTEM_BASE]
    if bim_project_id:
        system_parts.append(f"Currently selected BIM project ID: {bim_project_id}")
    if note:
        system_parts.append(note)

    agent_messages = [SystemMessage(content="\n\n".join(system_parts))] + list(messages)

    result = _react_agent.invoke({"messages": agent_messages})

    last = result["messages"][-1]
    content = last.content if hasattr(last, "content") else ""
    bim_data = _extract_bim_data(result["messages"])

    return {
        "messages": [AIMessage(content=content)],
        "intent":   "bim_agent",
        "bim_data": bim_data,
    }


def _extract_bim_data(messages: list) -> dict | None:
    bim_data: dict = {}
    for msg in messages:
        if hasattr(msg, "content") and isinstance(msg.content, str):
            try:
                data = json.loads(msg.content)
                if isinstance(data, dict):
                    if "projects" in data:
                        bim_data["projects"] = data["projects"]
                    if "stats" in data:
                        bim_data["stats"] = data["stats"]
                        bim_data["total"] = data.get("total", 0)
                        bim_data["targetProjectId"] = data.get("projectId")
            except (json.JSONDecodeError, TypeError):
                pass
    return bim_data if bim_data else None
