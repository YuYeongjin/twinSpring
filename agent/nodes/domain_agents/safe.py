"""
Safe Domain Agent — LLM 없음, Tool 전용 디스패처

변경: 모든 조회에서 통계 + 최근 감지 이력을 safe_data 차트 데이터로 함께 반환.
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
_PROJECTS_PAT = re.compile(r"프로젝트|목록|project|list|プロジェクト.{0,5}一覧", re.I)


def _invoke(tool_fn, args: dict) -> dict:
    logger.info("[safe] tool 호출: %s args=%s", tool_fn.name, args)
    try:
        raw = tool_fn.invoke(args)
        return json.loads(raw) if isinstance(raw, str) else raw
    except Exception as e:
        logger.error("[safe] %s 실패: %s", tool_fn.name, e)
        return {"success": False, "error": str(e)}


def _build_safe_chart(stats: dict, detections: list) -> dict:
    """통계 + 최근 감지 이력으로 차트 데이터 생성."""
    total      = int(stats.get("totalScans",         stats.get("totalDetections",    0)))
    danger     = int(stats.get("dangerCount",         stats.get("dangerDetections",   0)))
    helmet_vio = int(stats.get("helmetViolations",    0))
    area_vio   = int(stats.get("areaViolations",      stats.get("intrusionEvents",    0)))
    safe_cnt   = max(0, total - danger)

    # 시간대별 감지 집계 (최근 감지 이력에서)
    hourly: dict[str, int] = {}
    for d in detections:
        ts = d.get("detectedAt") or d.get("timestamp") or d.get("createdAt") or ""
        hour = str(ts)[:13]  # "YYYY-MM-DDTHH" 또는 "YYYY-MM-DD HH"
        if hour:
            hourly[hour] = hourly.get(hour, 0) + 1

    hourly_series = [
        {"time": h, "count": c}
        for h, c in sorted(hourly.items())
    ]

    return {
        "stats": {
            "totalScans":       total,
            "dangerCount":      danger,
            "safeCount":        safe_cnt,
            "helmetViolations": helmet_vio,
            "areaViolations":   area_vio,
        },
        # 상태 분포 (파이 차트)
        "statusDistribution": [
            {"label": "위험 감지",      "value": danger,     "key": "danger"},
            {"label": "헬멧 미착용",    "value": helmet_vio, "key": "helmet"},
            {"label": "구역 침입",      "value": area_vio,   "key": "area"},
            {"label": "정상",           "value": safe_cnt,   "key": "safe"},
        ],
        # 시간대별 감지 (라인 차트)
        "hourlySeries":    hourly_series,
        # 최근 이벤트 테이블
        "recentDetections": detections[:20],
        "chartType": "bar",
    }


def run_safe_agent(state: AgentState) -> dict:
    logger.info("[NODE] ▶ safe_agent 진입")
    from tools.safe_tools import (
        list_safe_projects, get_detection_server_status,
        get_recent_detections, get_safety_stats, get_safe_tab_guide,
    )

    messages = state.get("messages", [])
    text     = messages[-1].content if messages and hasattr(messages[-1], "content") else ""
    logger.info("[safe] 입력 텍스트: %.80s", text)

    if _GUIDE_PAT.search(text):
        result = _invoke(get_safe_tab_guide, {})
        return {"tool_results": {"data": result}, "safe_data": None}

    if _STATUS_PAT.search(text):
        result = _invoke(get_detection_server_status, {})
        return {"tool_results": {"data": result}, "safe_data": None}

    # ── 나머지 모든 요청: 통계 + 감지 이력 항상 조회 → 차트 데이터 생성 ──────────
    nums  = re.findall(r'\d+', text)
    limit = int(nums[0]) if nums else 10

    if _DETECT_PAT.search(text):
        result      = _invoke(get_recent_detections, {"limit": limit})
        detections  = result.get("records", [])
        stats       = _invoke(get_safety_stats, {})
    elif _PROJECTS_PAT.search(text):
        result      = _invoke(list_safe_projects, {})
        stats       = _invoke(get_safety_stats, {})
        detections  = _invoke(get_recent_detections, {"limit": 10}).get("records", [])
    else:
        # 기본: 통계 + 최근 감지
        stats       = _invoke(get_safety_stats, {})
        detect_res  = _invoke(get_recent_detections, {"limit": limit})
        detections  = detect_res.get("records", [])
        result      = stats

    safe_data = _build_safe_chart(stats, detections)
    logger.info(
        "[safe] chart: total=%d danger=%d detections=%d",
        safe_data["stats"]["totalScans"],
        safe_data["stats"]["dangerCount"],
        len(detections),
    )

    return {
        "tool_results": {"data": result, "safe_data": safe_data},
        "safe_data":    safe_data,
    }
