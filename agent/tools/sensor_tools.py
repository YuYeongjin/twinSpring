"""
Sensor Agent 도구 모음 — 온습도 데이터 조회 / RAG 검색

SensorAgent 가 create_react_agent 를 통해 호출하는 @tool 함수들.
"""
from __future__ import annotations

import json
from datetime import datetime
from langchain_core.tools import tool
from tools.db_tool import query_sensor_data
from tools.rag_tool import search_as_text


# ── 내부 헬퍼 ────────────────────────────────────────────────────────────────

def _fmt(val) -> str:
    if val is None:
        return "N/A"
    if isinstance(val, datetime):
        return val.strftime("%H:%M")
    try:
        return datetime.fromisoformat(str(val)).strftime("%H:%M")
    except Exception:
        return str(val)[:16]


def _safe_float(val) -> float | None:
    try:
        return round(float(val), 2) if val is not None else None
    except (TypeError, ValueError):
        return None


# ── Tools ─────────────────────────────────────────────────────────────────────

@tool
def get_latest_sensor() -> str:
    """
    현재 최신 온도·습도 센서 값을 반환합니다.
    가장 최근 측정값 1건을 JSON 문자열로 반환합니다.
    """
    rows = query_sensor_data(limit=1)
    if not rows:
        return json.dumps({"error": "No sensor data found."})
    r = rows[0]
    return json.dumps({
        "temperature": _safe_float(r.get("temperature") or r.get("temp")),
        "humidity":    _safe_float(r.get("humidity")),
        "timestamp":   _fmt(r.get("timestamp")),
        "location":    r.get("location", ""),
    }, ensure_ascii=False)


@tool
def get_sensor_history(limit: int = 20) -> str:
    """
    최근 N건의 온도·습도 이력을 반환합니다.
    limit 은 1~100 범위로 지정합니다 (기본 20건).
    각 레코드는 {time, temperature, humidity} 형식의 JSON 배열을 반환합니다.
    """
    limit = max(1, min(limit, 100))
    rows = query_sensor_data(limit=limit)
    if not rows:
        return json.dumps({"records": [], "count": 0})
    records = [
        {
            "time":        _fmt(r.get("timestamp")),
            "temperature": _safe_float(r.get("temperature") or r.get("temp")),
            "humidity":    _safe_float(r.get("humidity")),
        }
        for r in reversed(rows)  # 오래된 것 먼저
    ]
    latest = rows[0]
    return json.dumps({
        "records": records,
        "count":   len(records),
        "latest": {
            "temperature": _safe_float(latest.get("temperature") or latest.get("temp")),
            "humidity":    _safe_float(latest.get("humidity")),
            "timestamp":   _fmt(latest.get("timestamp")),
        },
    }, ensure_ascii=False)


@tool
def search_building_knowledge(query: str) -> str:
    """
    건물/시설 관련 문서에서 query 와 관련된 내용을 RAG 검색합니다.
    센서 알림 임계값, 관리 기준, 매뉴얼 내용 등을 조회할 때 사용합니다.
    """
    result = search_as_text(query, k=4)
    return result if result else "관련 문서를 찾을 수 없습니다."


# ── 도구 목록 (SensorAgent 생성 시 사용) ─────────────────────────────────────
SENSOR_TOOLS = [get_latest_sensor, get_sensor_history, search_building_knowledge]
