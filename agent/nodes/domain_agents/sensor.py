"""
Sensor Domain Agent — LLM 없음, Tool 전용 디스패처

변경: get_sensor_trend(TimescaleDB time_bucket) 추가로 차트용 집계 데이터 제공.
     임계값 초과 시 alerts 자동 생성.
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

# ── 알람 임계값 ────────────────────────────────────────────────────────────────
_TEMP_HIGH  = 35.0
_TEMP_LOW   =  5.0
_HUM_HIGH   = 80.0
_HUM_LOW    = 20.0


def _check_alerts(latest: dict) -> list:
    """최신 센서값에서 임계값 초과 항목을 알람 리스트로 반환."""
    alerts = []
    temp = latest.get("temperature")
    hum  = latest.get("humidity")
    if temp is not None:
        if temp > _TEMP_HIGH:
            alerts.append({"type": "HIGH_TEMP",     "value": temp, "threshold": _TEMP_HIGH, "level": "danger"})
        elif temp < _TEMP_LOW:
            alerts.append({"type": "LOW_TEMP",      "value": temp, "threshold": _TEMP_LOW,  "level": "warning"})
    if hum is not None:
        if hum > _HUM_HIGH:
            alerts.append({"type": "HIGH_HUMIDITY", "value": hum,  "threshold": _HUM_HIGH,  "level": "warning"})
        elif hum < _HUM_LOW:
            alerts.append({"type": "LOW_HUMIDITY",  "value": hum,  "threshold": _HUM_LOW,   "level": "warning"})
    return alerts


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
    from tools.sensor_tools import get_latest_sensor, get_sensor_history, get_sensor_trend

    messages = state.get("messages", [])
    text     = messages[-1].content if messages and hasattr(messages[-1], "content") else ""
    logger.info("[sensor] 입력 텍스트: %.80s", text)

    nums  = _NUM_PAT.findall(text)
    limit = int(nums[0]) if nums else 20
    limit = max(1, min(limit, 100))

    # ── 1) 최신값 + 원시 이력 + 24h 집계 트렌드 항상 병렬 조회 ─────────────────
    latest_raw = _invoke(get_latest_sensor, {})
    hist       = _invoke(get_sensor_history, {"limit": limit})
    trend      = _invoke(get_sensor_trend,   {"hours": 24, "bucket": "1 hour"})

    latest  = latest_raw if not latest_raw.get("error") else hist.get("latest", {})
    records = hist.get("records", [])
    alerts  = _check_alerts(latest)

    # ── 2) chart 타입 결정 ──────────────────────────────────────────────────────
    # 트렌드·추이·그래프 요청이면 집계 데이터를 primary로, 아니면 원시 records를 primary로
    is_trend_req = bool(_HISTORY_PAT.search(text))

    sensor_data = {
        # 원시 이력 (테이블, 소형 라인차트)
        "sensor":    records,
        # TimescaleDB 집계 트렌드 (avg_temp, min_temp, max_temp, avg_humidity)
        "trend":     trend.get("trend", []),
        "latest":    latest,
        "alerts":    alerts,
        "summary":   trend.get("summary", {}),
        "chartType": "line",
        "primaryKey": "trend" if is_trend_req else "sensor",
    }

    logger.info(
        "[sensor] records=%d trend=%d alerts=%d",
        len(records), len(trend.get("trend", [])), len(alerts),
    )

    return {
        "tool_results": {"data": latest_raw, "sensor_data": sensor_data},
        "sensor_data":  sensor_data,
    }
