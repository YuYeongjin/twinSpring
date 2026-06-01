"""
Test Domain Agent — LLM 없음, Tool 전용 디스패처
"""
from __future__ import annotations

import re
import json
import logging

from config.state import AgentState

logger = logging.getLogger(__name__)

_KEYBOARD_PAT = re.compile(r"키보드|단축키|조작법|keyboard|shortcut|キーボード", re.I)
_LOG_PAT      = re.compile(r"로그|이력|기록|log|history|履歴|ログ", re.I)


def _invoke(tool_fn, args: dict) -> dict:
    logger.info("[test] tool 호출: %s args=%s", tool_fn.name, args)
    try:
        raw = tool_fn.invoke(args)
        return json.loads(raw) if isinstance(raw, str) else raw
    except Exception as e:
        logger.error("[test] %s 실패: %s", tool_fn.name, e)
        return {"success": False, "error": str(e)}


def run_test_agent(state: AgentState) -> dict:
    logger.info("[NODE] ▶ test_agent 진입")
    from tools.test_tools import get_test_tab_guide, get_keyboard_controls, get_collision_log

    messages = state.get("messages", [])
    text     = messages[-1].content if messages and hasattr(messages[-1], "content") else ""
    logger.info("[test] 입력 텍스트: %.80s", text)

    if _KEYBOARD_PAT.search(text):
        result = _invoke(get_keyboard_controls, {})
    elif _LOG_PAT.search(text):
        result = _invoke(get_collision_log, {})
    else:
        result = _invoke(get_test_tab_guide, {})

    return {"tool_results": {"data": result}}
