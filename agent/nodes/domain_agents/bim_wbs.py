"""
BIM-WBS Bridge Agent

BIM 에디터에서 대화로 두 가지 작업을 처리합니다.
  1. 구조 안정성 검토  → get_structural_summary 호출 후 structural 탭 전환 신호
  2. WBS 스케줄링     → schedule_wbs_for_bim 호출 (기존 WBS 업데이트 or 신규 생성)

directAgent="bim_wbs_agent" 로 직접 라우팅됩니다 (LLM 라우터 스킵).
"""
from __future__ import annotations

import json
import logging
import re

from config.state import AgentState

logger = logging.getLogger(__name__)

# ── 의도 패턴 ──────────────────────────────────────────────────────────────────
_MOVE_PAT = re.compile(
    r"부재.{0,25}(이동|내리|내려|올리|올려|옮기|옮겨|translate)"
    r"|전체.{0,15}(이동|내리|내려|올리|올려|옮기)"
    r"|모두.{0,15}(이동|내리|내려|올리|올려)"
    r"|이동.{0,10}(해줘|해주|시켜|부재)",
    re.I,
)
_AXIS_DOWN = re.compile(r"내리|내려|아래|down|minus|マイナス|下げ|下方", re.I)
_AXIS_X    = re.compile(r"x\s*축|x-axis|x방향|x\s*軸|x方向", re.I)
_AXIS_Y    = re.compile(r"y\s*축|y-axis|y방향|y\s*軸|y方向", re.I)

_STRUCT_PAT = re.compile(
    r"구조.{0,5}(안정성|검토|분석|해석|리뷰)"
    r"|structural.{0,5}(analysis|review|check|stability)"
    r"|stability.{0,5}(check|review|analysis)",
    re.I,
)
_WBS_PAT = re.compile(
    r"wbs|공정표|스케줄(링)?|schedule"
    r"|일정.{0,5}(추가|생성|만들|넣어)"
    r"|공정.{0,5}(생성|추가|만들|넣어|작성)",
    re.I,
)
_NEW_PAT = re.compile(
    r"신규|새로?(?:\s*만들|\s*추가|\s*생성)?|new\s+wbs|force.new",
    re.I,
)


def _invoke(tool_fn, args: dict) -> dict:
    logger.info("[bim_wbs] tool=%s  args=%s", tool_fn.name, args)
    try:
        raw    = tool_fn.invoke(args)
        result = json.loads(raw) if isinstance(raw, str) else raw
        logger.info("[bim_wbs] tool 완료 action=%s", result.get("action", "?"))
        return result
    except Exception as exc:
        logger.error("[bim_wbs] tool=%s 실패 (args=%s): %s", tool_fn.name, args, exc, exc_info=True)
        return {"success": False, "error": "요청을 처리할 수 없습니다."}


def run_bim_wbs_agent(state: AgentState) -> dict:
    logger.info("[NODE] ▶ bim_wbs_agent 진입")
    from tools.bim_wbs_tools import get_structural_summary, schedule_wbs_for_bim

    messages       = state.get("messages", [])
    text           = messages[-1].content if messages and hasattr(messages[-1], "content") else ""
    bim_project_id = state.get("bim_project_id") or ""
    logger.info("[bim_wbs] text=%.80s  projectId=%s", text, bim_project_id)

    # ── 부재 이동 ─────────────────────────────────────────────────────────────
    if _MOVE_PAT.search(text):
        from tools.bim_tools import translate_bim_elements, translate_selected_elements
        nums = re.findall(r'[\d.]+', text)
        val  = float(nums[0]) if nums else 0.0
        dx = dy = dz = 0.0
        if _AXIS_X.search(text):
            dx = -val if _AXIS_DOWN.search(text) else val
        elif _AXIS_Y.search(text):
            dy = -val if _AXIS_DOWN.search(text) else val
        else:
            dz = -val if _AXIS_DOWN.search(text) else val
        sel_ids = state.get("selected_element_ids") or []
        if sel_ids:
            result = _invoke(translate_selected_elements, {
                "project_id": str(bim_project_id),
                "element_ids": sel_ids,
                "delta_x": dx, "delta_y": dy, "delta_z": dz,
            })
        else:
            result = _invoke(translate_bim_elements, {
                "project_id": str(bim_project_id),
                "delta_x": dx, "delta_y": dy, "delta_z": dz,
            })
        bim_data = {"action": "glb_reload"} if result.get("action") == "glb_reload" else None
        return {"tool_results": {"data": result}, "bim_data": bim_data}

    # ── 구조 안정성 검토 ───────────────────────────────────────────────────────
    if _STRUCT_PAT.search(text):
        result   = _invoke(get_structural_summary, {"project_id": str(bim_project_id)})
        bim_data = {"action": "structural_analysis", **result}
        return {
            "tool_results": {"data": result},
            "bim_data":     bim_data,
            "intent":       "structural_analysis",
        }

    # ── WBS 스케줄링 ──────────────────────────────────────────────────────────
    if _WBS_PAT.search(text):
        force_new = bool(_NEW_PAT.search(text))
        result    = _invoke(schedule_wbs_for_bim, {
            "bim_project_id":   str(bim_project_id),
            "bim_project_name": "",
            "force_new":        force_new,
        })
        action   = result.get("action", "wbs_updated")
        bim_data = {"action": action, **result}
        return {
            "tool_results": {"data": result},
            "bim_data":     bim_data,
            "intent":       action,
        }

    # ── 일반 안내 ────────────────────────────────────────────────────────────
    info = (
        "BIM Agent에게 다음과 같이 요청할 수 있습니다:\n"
        "• '구조 안정성 검토해줘' → 부재 기반 구조해석 탭 자동 전환\n"
        "• 'WBS 스케줄링 넣어줘' → 기존 WBS 업데이트 또는 신규 공정표 생성"
    )
    return {
        "tool_results": {"data": {"info": info}},
        "bim_data":     None,
    }
