"""
Safe Domain Agent — LLM 없음, Tool 전용 디스패처
"""
from __future__ import annotations

import re
import json
import logging

from config.state import AgentState

logger = logging.getLogger(__name__)

_GUIDE_PAT    = re.compile(r"안내|설명|가이드|사용법|어떻게|how|guide|説明|使い方", re.I)
_STATUS_PAT   = re.compile(r"서버.{0,5}상태|server.{0,5}status|サーバー.{0,5}状態", re.I)
_DETECT_PAT   = re.compile(r"감지|이벤트|위반|탐지|detect|event|violation|検知|違反", re.I)
_STATS_PAT    = re.compile(r"통계|현황|stats|statistics|統計", re.I)
_PROJECTS_PAT = re.compile(r"프로젝트|목록|project|list|プロジェクト.{0,5}一覧", re.I)


def _invoke(tool_fn, args: dict) -> dict:
    try:
        raw = tool_fn.invoke(args)
        return json.loads(raw) if isinstance(raw, str) else raw
    except Exception as e:
        logger.error("[safe] %s 실패: %s", tool_fn.name, e)
        return {"success": False, "error": str(e)}


def run_safe_agent(state: AgentState) -> dict:
    from tools.safe_tools import (
        list_safe_projects, get_detection_server_status,
        get_recent_detections, get_safety_stats, get_safe_tab_guide,
    )

    messages = state.get("messages", [])
    text     = messages[-1].content if messages and hasattr(messages[-1], "content") else ""

    if _GUIDE_PAT.search(text):
        result = _invoke(get_safe_tab_guide, {})
    elif _STATUS_PAT.search(text):
        result = _invoke(get_detection_server_status, {})
    elif _DETECT_PAT.search(text):
        nums  = re.findall(r'\d+', text)
        limit = int(nums[0]) if nums else 10
        result = _invoke(get_recent_detections, {"limit": limit})
    elif _STATS_PAT.search(text):
        result = _invoke(get_safety_stats, {})
    elif _PROJECTS_PAT.search(text):
        result = _invoke(list_safe_projects, {})
    else:
        result = _invoke(get_safety_stats, {})

    return {"tool_results": {"data": result}}
