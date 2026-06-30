"""
Sensor Agent 도구 모음 — TimescaleDB 시계열 쿼리 지원

SensorAgent 가 create_react_agent 를 통해 호출하는 @tool 함수들.
TimescaleDB 연산(time_bucket, Continuous Aggregate)을 직접 활용합니다.
"""
from __future__ import annotations

import json
from datetime import datetime
from langchain_core.tools import tool
from tools.db_tool import query_sensor_data, _PooledConn
from tools.rag_tool import search_as_text

import logging
logger = logging.getLogger(__name__)


# ── 내부 헬퍼 ────────────────────────────────────────────────────────────────

def _fmt(val) -> str:
    if val is None:
        return "N/A"
    if isinstance(val, datetime):
        return val.strftime("%m/%d %H:%M")
    try:
        return datetime.fromisoformat(str(val)).strftime("%m/%d %H:%M")
    except Exception:
        return str(val)[:16]


def _safe_float(val) -> float | None:
    try:
        return round(float(val), 2) if val is not None else None
    except (TypeError, ValueError):
        return None


def _query_timescale(sql: str, params: tuple = ()) -> list[dict]:
    """TimescaleDB 직접 쿼리"""
    try:
        with _PooledConn() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                return [dict(row) for row in cur.fetchall()]
    except Exception as e:
        logger.warning("[TimescaleDB] 쿼리 실패: %s", e)
        return []


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
def get_sensor_trend(hours: int = 24, bucket: str = "1 hour", location: str = "") -> str:
    """
    TimescaleDB time_bucket 을 이용한 시계열 트렌드를 반환합니다.

    - hours:    조회할 최근 시간 수 (기본 24시간, 최대 720)
    - bucket:   집계 단위 — "5 minutes" | "30 minutes" | "1 hour" | "6 hours" | "1 day"
    - location: 위치 필터 (빈 문자열이면 전체 위치 합산)

    반환: [{bucket, location, avg_temp, min_temp, max_temp, avg_humidity, sample_count}, ...]
    예: "최근 24시간 1시간 단위 평균 온도 추세를 보여줘"
    """
    hours = max(1, min(hours, 720))
    valid_buckets = {"1 minute", "5 minutes", "10 minutes", "30 minutes",
                     "1 hour", "3 hours", "6 hours", "12 hours", "1 day"}
    if bucket not in valid_buckets:
        bucket = "1 hour"

    sql = """
        SELECT
            time_bucket(%s::interval, timestamp) AS bucket,
            location,
            ROUND(AVG(temperature)::numeric, 2) AS avg_temp,
            ROUND(MIN(temperature)::numeric, 2) AS min_temp,
            ROUND(MAX(temperature)::numeric, 2) AS max_temp,
            ROUND(AVG(humidity)::numeric, 2)    AS avg_humidity,
            COUNT(*)                            AS sample_count
        FROM sensor_data
        WHERE timestamp >= NOW() - (%s * INTERVAL '1 hour')
        {loc_filter}
        GROUP BY bucket, location
        ORDER BY bucket ASC
    """
    loc_filter = "AND location = %s" if location else ""
    params = (bucket, hours, location) if location else (bucket, hours)
    rows = _query_timescale(sql.format(loc_filter=loc_filter), params)

    if not rows:
        return json.dumps({"trend": [], "count": 0, "hours": hours, "bucket": bucket})

    records = [
        {
            "time":        _fmt(r.get("bucket")),
            "location":    r.get("location", ""),
            "avg_temp":    _safe_float(r.get("avg_temp")),
            "min_temp":    _safe_float(r.get("min_temp")),
            "max_temp":    _safe_float(r.get("max_temp")),
            "avg_humidity": _safe_float(r.get("avg_humidity")),
            "samples":     r.get("sample_count"),
        }
        for r in rows
    ]
    return json.dumps({
        "trend": records, "count": len(records),
        "hours": hours, "bucket": bucket,
        "summary": {
            "overall_avg_temp": round(
                sum(r["avg_temp"] for r in records if r["avg_temp"]) / max(len(records), 1), 2),
            "overall_max_temp": max((r["max_temp"] for r in records if r["max_temp"]), default=None),
            "overall_min_temp": min((r["min_temp"] for r in records if r["min_temp"]), default=None),
        }
    }, ensure_ascii=False)


@tool
def get_sensor_hourly_stats(hours: int = 48, location: str = "") -> str:
    """
    Continuous Aggregate(sensor_hourly_avg)에서 시간별 집계 통계를 반환합니다.
    time_bucket 원시 쿼리보다 빠릅니다 (미리 집계된 뷰).

    - hours:    최근 N시간 (기본 48)
    - location: 위치 필터 (빈 문자열이면 전체)
    """
    sql = """
        SELECT bucket, location,
               ROUND(avg_temp::numeric, 2)     AS avg_temp,
               ROUND(min_temp::numeric, 2)     AS min_temp,
               ROUND(max_temp::numeric, 2)     AS max_temp,
               ROUND(avg_humidity::numeric, 2) AS avg_humidity,
               sample_count
        FROM sensor_hourly_avg
        WHERE bucket >= NOW() - (%s * INTERVAL '1 hour')
        {loc_filter}
        ORDER BY bucket ASC
    """
    loc_filter = "AND location = %s" if location else ""
    params = (hours, location) if location else (hours,)
    rows = _query_timescale(sql.format(loc_filter=loc_filter), params)

    if not rows:
        return json.dumps({"stats": [], "count": 0, "note": "데이터 없음 또는 Continuous Aggregate 미갱신"})

    records = [
        {
            "time":        _fmt(r.get("bucket")),
            "location":    r.get("location", ""),
            "avg_temp":    _safe_float(r.get("avg_temp")),
            "min_temp":    _safe_float(r.get("min_temp")),
            "max_temp":    _safe_float(r.get("max_temp")),
            "avg_humidity": _safe_float(r.get("avg_humidity")),
            "samples":     r.get("sample_count"),
        }
        for r in rows
    ]
    return json.dumps({"stats": records, "count": len(records)}, ensure_ascii=False)


@tool
def get_sensor_history(limit: int = 20) -> str:
    """
    최근 N건의 온도·습도 원시 이력을 반환합니다.
    limit 은 1~100 범위 (기본 20건).
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
            "location":    r.get("location", ""),
        }
        for r in reversed(rows)
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


# ── 도구 목록 ─────────────────────────────────────────────────────────────────
SENSOR_TOOLS = [
    get_latest_sensor,
    get_sensor_trend,
    get_sensor_hourly_stats,
    get_sensor_history,
    search_building_knowledge,
]
