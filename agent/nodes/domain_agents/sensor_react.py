"""
Sensor Domain Agent v2 — LLM Tool Calling (ReAct Pattern)
"""
from __future__ import annotations
import logging

from config.state import AgentState
from config.lang_util import lang_instruction
from nodes.react_utils import build_react_subgraph, invoke_subgraph, extract_turn_results
from nodes.domain_agents.sensor import _check_alerts

logger = logging.getLogger(__name__)


def _system(state: AgentState) -> str:
    lang = state.get("lang", "ko")
    lines = [
        "당신은 IoT 센서 모니터링 전문 AI입니다.",
        "온도·습도 데이터를 조회하고 이상 징후를 분석합니다.",
        "사용 가능한 tool:",
        "  - get_latest_sensor: 현재 최신 센서값 조회",
        "  - get_sensor_history: 최근 N건 원시 이력 조회",
        "  - get_sensor_trend: 시간대별 집계 트렌드 조회 (기본 24h, 1h bucket)",
    ]
    note = lang_instruction(lang)
    if note:
        lines.append(note)
    return "\n".join(lines)


def _finalize(state: AgentState) -> dict:
    """tool 결과에서 sensor_data 차트 구조를 조립합니다."""
    results = extract_turn_results(state.get("messages", []))

    latest_raw = results.get("get_latest_sensor", {})
    hist       = results.get("get_sensor_history", {})
    trend      = results.get("get_sensor_trend", {})

    if not any([latest_raw, hist, trend]):
        return {}

    latest  = latest_raw if not latest_raw.get("error") else hist.get("latest", {})
    records = hist.get("records", [])
    alerts  = _check_alerts(latest)

    sensor_data = {
        "sensor":     records,
        "trend":      trend.get("trend", []),
        "latest":     latest,
        "alerts":     alerts,
        "summary":    trend.get("summary", {}),
        "chartType":  "line",
        "primaryKey": "trend" if trend else "sensor",
    }
    return {"sensor_data": sensor_data}


def _make_subgraph():
    from tools.sensor_tools import get_latest_sensor, get_sensor_history, get_sensor_trend
    return build_react_subgraph(
        tools=[get_latest_sensor, get_sensor_history, get_sensor_trend],
        system_fn=_system,
        finalize_fn=_finalize,
    )


_subgraph = _make_subgraph()


def run_sensor_react_agent(state: AgentState) -> dict:
    logger.info("[NODE] ▶ sensor_react_agent 진입")
    return invoke_subgraph(_subgraph, state)
