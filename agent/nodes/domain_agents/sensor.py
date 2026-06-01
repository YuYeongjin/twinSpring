"""
Sensor Domain Agent — LLM 없음, Tool 전용 디스패처
"""
from __future__ import annotations

import re
import json
import logging

from config.state import AgentState

logger = logging.getLogger(__name__)

_HISTORY_PAT = re.compile(r"이력|기록|최근\s*\d+|history|recent\s*\d+|履歴", re.I)
_NUM_PAT     = re.compile(r"\d+")


def _invoke(tool_fn, args: dict) -> dict:
    try:
        raw = tool_fn.invoke(args)
        return json.loads(raw) if isinstance(raw, str) else raw
    except Exception as e:
        logger.error("[sensor] %s 실패: %s", tool_fn.name, e)
        return {"success": False, "error": str(e)}


def run_sensor_agent(state: AgentState) -> dict:
    from tools.sensor_tools import get_latest_sensor, get_sensor_history

    messages = state.get("messages", [])
    text     = messages[-1].content if messages and hasattr(messages[-1], "content") else ""

    if _HISTORY_PAT.search(text):
        nums  = _NUM_PAT.findall(text)
        limit = int(nums[0]) if nums else 10
        result = _invoke(get_sensor_history, {"limit": limit})
    else:
        result = _invoke(get_latest_sensor, {})

    return {
        "tool_results": {"data": result, "sensor_data": result},
        "sensor_data":  result,
    }
