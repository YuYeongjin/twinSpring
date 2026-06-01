"""
BIM Domain Agent — LLM 없음, Tool 전용 디스패처

키워드 매칭으로 적절한 BIM tool을 직접 호출합니다.
"""
from __future__ import annotations

import re
import json
import logging

from langchain_core.messages import AIMessage as _AIMessage
from config.state import AgentState

logger = logging.getLogger(__name__)

_CREATE_PAT     = re.compile(r"추가|생성|만들|create|add|作成|追加", re.I)
_DELETE_PAT     = re.compile(r"삭제|제거|delete|remove|削除", re.I)
_STATS_PAT      = re.compile(r"통계|현황|개수|몇\s*개|stats|count|統計", re.I)
_DRONE_PAT      = re.compile(r"드론|drone|aerial|ドローン", re.I)
_STRUCT_PAT     = re.compile(r"구조\s*(해석|분析)|structural\s*anal|構造.{0,5}解析", re.I)
_IFC_PAT        = re.compile(r"ifc.{0,10}(import|가져오기)", re.I)
_PROJ_PAT       = re.compile(r"프로젝트.{0,10}(생성|만들)|create.{0,10}project|プロジェクト.{0,5}作成", re.I)
_COMPOSITE_PAT  = re.compile(
    r"피사의?\s*사탑|에펠탑|피라미드|인천대교|교각구조|건물골조|교량경간"
    r"|pier.struct|bridge.span|building.frame|landmark", re.I)

_ELEMENT_TYPES = [
    ("기둥", "IfcColumn"), ("column", "IfcColumn"), ("柱", "IfcColumn"),
    ("보",   "IfcBeam"),   ("beam",   "IfcBeam"),   ("梁", "IfcBeam"),
    ("벽",   "IfcWall"),   ("wall",   "IfcWall"),   ("壁", "IfcWall"),
    ("슬래브", "IfcSlab"), ("slab",   "IfcSlab"),
    ("교각", "IfcPier"),   ("pier",   "IfcPier"),   ("橋脚", "IfcPier"),
]

_COMPOSITE_TYPES = [
    (re.compile(r"인천대교|incheon.bridge", re.I), "incheon_bridge"),
    (re.compile(r"교량경간|bridge.span",    re.I), "bridge_span"),
    (re.compile(r"교각구조|pier.struct",    re.I), "pier"),
    (re.compile(r"건물골조|building.frame", re.I), "building_frame"),
]


def _awaiting_project_name(messages: list) -> bool:
    """이전 AI 응답이 프로젝트 이름을 물었는지 확인."""
    for m in reversed(messages[:-1]):
        if isinstance(m, _AIMessage):
            return "프로젝트 이름" in (m.content or "")
    return False


def _element_type(text: str) -> str:
    for kw, etype in _ELEMENT_TYPES:
        if kw.lower() in text.lower():
            return etype
    return "IfcColumn"


def _extract_json(text: str) -> dict | None:
    """마크다운 코드블록 또는 순수 JSON 텍스트에서 dict 추출."""
    # ```json ... ``` 또는 ``` ... ``` 블록 제거
    clean = re.sub(r"```(?:json)?\s*([\s\S]*?)```", r"\1", text).strip()
    if not clean:
        clean = text.strip()
    try:
        parsed = json.loads(clean)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


def _invoke(tool_fn, args: dict) -> dict:
    logger.info("[bim] tool 호출: %s args=%s", tool_fn.name, args)
    try:
        raw = tool_fn.invoke(args)
        result = json.loads(raw) if isinstance(raw, str) else raw
        logger.info("[bim] tool 완료: %s → success=%s", tool_fn.name, result.get("success", "?"))
        return result
    except Exception as e:
        logger.error("[bim] %s 실패: %s", tool_fn.name, e)
        return {"success": False, "error": str(e)}


def run_bim_agent(state: AgentState) -> dict:
    logger.info("[NODE] ▶ bim_agent 진입")
    from tools.bim_tools import (
        list_bim_projects, get_bim_stats, create_bim_element,
        delete_bim_element, create_bim_project, create_composite_structure,
        get_drone_analysis_info, get_structural_analysis, get_ifc_import_guide,
    )

    messages = state.get("messages", [])
    text     = messages[-1].content if messages and hasattr(messages[-1], "content") else ""
    proj_id  = state.get("bim_project_id")
    logger.info("[bim] 입력 텍스트: %.80s", text)

    bim_data = None

    # ── 이전 AI가 프로젝트 이름을 물었다면 현재 메시지를 이름으로 처리 ──────────
    if _awaiting_project_name(messages) and text.strip() and len(text.strip()) <= 60:
        name = text.strip()
        result = _invoke(create_bim_project, {"project_name": name})
        return {"tool_results": {"data": result, "bim_data": None}, "bim_data": None}

    # ── JSON 구조 입력 우선 처리 (```json {...}``` 또는 순수 JSON) ──────────────
    parsed_json = _extract_json(text)
    if parsed_json:
        # 프로젝트 생성: project_name 또는 name 키 존재
        if "project_name" in parsed_json or ("name" in parsed_json and "element_type" not in parsed_json):
            name = parsed_json.get("project_name") or parsed_json.get("name") or "새 프로젝트"
            result = _invoke(create_bim_project, {"project_name": name})
            return {"tool_results": {"data": result, "bim_data": None}, "bim_data": None}
        # 부재 생성: element_type 키 존재
        if "element_type" in parsed_json:
            result = _invoke(create_bim_element, {
                "element_type": parsed_json.get("element_type", "IfcColumn"),
                "project_id":   str(parsed_json.get("project_id", proj_id or "1")),
                "material":     parsed_json.get("material", "Concrete"),
                "position_x":   float(parsed_json.get("position_x", 0.0)),
                "position_y":   float(parsed_json.get("position_y", 0.0)),
                "position_z":   float(parsed_json.get("position_z", 0.0)),
            })
            return {"tool_results": {"data": result, "bim_data": None}, "bim_data": None}

    if _DRONE_PAT.search(text):
        result = _invoke(get_drone_analysis_info, {})
    elif _STRUCT_PAT.search(text):
        args = {"project_id": proj_id} if proj_id else {}
        result = _invoke(get_structural_analysis, args)
    elif _IFC_PAT.search(text):
        result = _invoke(get_ifc_import_guide, {})
    elif _COMPOSITE_PAT.search(text):
        ctype = "building_frame"
        for pat, ct in _COMPOSITE_TYPES:
            if pat.search(text):
                ctype = ct
                break
        result = _invoke(create_composite_structure, {
            "composite_type": ctype,
            "project_id":     str(proj_id) if proj_id else "1",
        })
    elif _DELETE_PAT.search(text):
        nums = re.findall(r'\d+', text)
        eid  = str(nums[0]) if nums else "1"
        result = _invoke(delete_bim_element, {"element_id": eid})
    elif _PROJ_PAT.search(text) and _CREATE_PAT.search(text):
        name_m = re.search(r'["\'「]([^"\'」]+)["\'」]', text)
        if not name_m:
            return {"tool_results": {"need_project_name": True}, "bim_data": None}
        name   = name_m.group(1)
        result = _invoke(create_bim_project, {"project_name": name})
    elif _CREATE_PAT.search(text):
        etype  = _element_type(text)
        result = _invoke(create_bim_element, {
            "element_type": etype,
            "project_id":   str(proj_id) if proj_id else "1",
            "material":     "Concrete",
            "position_x":   0.0,
            "position_y":   0.0,
            "position_z":   0.0,
        })
    elif _STATS_PAT.search(text):
        args   = {"project_id": proj_id} if proj_id else {}
        result = _invoke(get_bim_stats, args)
        bim_data = result
    else:
        result   = _invoke(list_bim_projects, {})
        bim_data = result

    return {"tool_results": {"data": result, "bim_data": bim_data}, "bim_data": bim_data}
