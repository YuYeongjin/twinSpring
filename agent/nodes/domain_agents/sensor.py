"""
Sensor Domain Agent — LLM 없음, Tool 전용 디스패처
"""
from __future__ import annotations

import re
import json
import logging

from config.state import AgentState

logger = logging.getLogger(__name__)

_HISTORY_PAT = re.compile(
    r"이력|기록|최근\s*\d+|history|recent\s*\d+|履歴"
    r"|그래프|차트|graph|chart|보여|show|추이|trend|변화|변동",
    re.I,
)
_NUM_PAT = re.compile(r"\d+")


def _invoke(tool_fn, args: dict) -> dict:
    logger.info("[sensor] tool 호출: %s args=%s", tool_fn.name, args)
    try:
        raw = tool_fn.invoke(args)
        return json.loads(raw) if isinstance(raw, str) else raw
    except Exception as e:
        logger.error("[sensor] %s 실패: %s", tool_fn.name, e)
        return {"success": False, "error": str(e)}


def run_sensor_agent(state: AgentState) -> dict:
    logger.info("[NODE] ▶ sensor_agent 진입")
    from tools.sensor_tools import get_latest_sensor, get_sensor_history

    messages = state.get("messages", [])
    text     = messages[-1].content if messages and hasattr(messages[-1], "content") else ""
    logger.info("[sensor] 입력 텍스트: %.80s", text)

    nums  = _NUM_PAT.findall(text)
    limit = int(nums[0]) if nums else 20

    if _HISTORY_PAT.search(text):
        result = _invoke(get_sensor_history, {"limit": limit})
        latest = result.get("latest") or {}
        records = result.get("records", [])
    else:
        # 최신 1건 조회 + 차트용 히스토리 병행
        latest_raw = _invoke(get_latest_sensor, {})
        hist       = _invoke(get_sensor_history, {"limit": 20})
        latest     = latest_raw if not latest_raw.get("error") else hist.get("latest", {})
        records    = hist.get("records", [])
        result     = latest_raw

    # 프론트엔드 SensorInlineChart 가 기대하는 구조로 정규화
    # { sensor: [{time, temperature, humidity}...], latest: {...}, alerts: [] }
    sensor_data = {
        "sensor":  records,
        "latest":  latest,
        "alerts":  [],
    }

    return {
        "tool_results": {"data": result, "sensor_data": sensor_data},
        "sensor_data":  sensor_data,
    }
