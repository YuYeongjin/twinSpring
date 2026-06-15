"""
Orchestrator Domain Agent — LLM 없음, Tool 전용 디스패처

WBS / BIM / Safe 데이터를 수집해 report_data 에 담고,
통합관제 전용 차트 데이터(charts)를 함께 생성합니다.

charts:
  projectProgress  — 현장별 WBS 평균 진행률·완료·지연 (그룹 바)
  overallStatus    — 전체 공정 상태 통합 분포 (도넛)
  bimElements      — BIM 프로젝트별 총 부재 수 (수평 바)
  bimTypeOverall   — 전체 BIM 부재 타입 분포 (도넛)
  safetyOverview   — 안전 감지 현황 수치 (바)
"""
from __future__ import annotations

import json
import logging

from config.state import AgentState

logger = logging.getLogger(__name__)

# 부재 타입 한글 레이블
_ELEM_KO = {
    "IfcColumn": "기둥", "IfcBeam": "보", "IfcWall": "벽",
    "IfcSlab":   "슬래브", "IfcPier": "교각",
}
_ELEM_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6",
                "#06b6d4", "#f97316", "#84cc16"]


def _invoke(tool_fn, args: dict) -> dict:
    logger.info("[orchestrator] tool 호출: %s args=%s", tool_fn.name, args)
    try:
        raw = tool_fn.invoke(args)
        return json.loads(raw) if isinstance(raw, str) else raw
    except Exception as e:
        logger.error("[orchestrator] %s 실패: %s", tool_fn.name, e)
        return {"success": False, "error": str(e)}


def _build_report_charts(wbs: dict, bim: dict, safe: dict) -> dict:
    """WBS + BIM + Safe 수집 데이터에서 통합관제 차트 5종 생성."""

    # ── 현장별 WBS 진행률 그룹 바 ────────────────────────────────────────────
    wbs_projects  = wbs.get("projects", []) if isinstance(wbs, dict) else []
    wbs_names     = [p.get("projectName", f"현장{p.get('projectId','')}") for p in wbs_projects]
    wbs_avg       = [round(float(p.get("avgProgress", 0) or 0), 1)  for p in wbs_projects]
    wbs_completed = [int(p.get("completedTasks", 0) or 0)           for p in wbs_projects]
    wbs_delayed   = [int(p.get("delayedTasks",   0) or 0)           for p in wbs_projects]
    wbs_total     = [int(p.get("taskCount",       0) or 0)           for p in wbs_projects]

    project_progress = {
        "type":  "bar",
        "title": "현장별 WBS 진행률",
        "labels": wbs_names,
        "datasets": [
            {"label": "평균 진행률(%)", "data": wbs_avg,       "backgroundColor": "#3b82f6", "yAxisID": "pct"},
            {"label": "완료 태스크",    "data": wbs_completed, "backgroundColor": "#22c55e", "yAxisID": "cnt"},
            {"label": "지연 태스크",    "data": wbs_delayed,   "backgroundColor": "#ef4444", "yAxisID": "cnt"},
        ],
        "meta": {"totalTasks": wbs_total},
    }

    # ── 전체 공정 상태 분포 도넛 ─────────────────────────────────────────────
    tot_completed = sum(p.get("completedTasks", 0) or 0 for p in wbs_projects)
    tot_delayed   = sum(p.get("delayedTasks",   0) or 0 for p in wbs_projects)
    tot_all       = sum(p.get("taskCount",       0) or 0 for p in wbs_projects)
    tot_inprog    = max(0, tot_all - tot_completed - tot_delayed)
    tot_notstart  = max(0, tot_all - tot_completed - tot_delayed - tot_inprog)

    overall_status = {
        "type":  "doughnut",
        "title": "전체 공정 상태 분포",
        "labels": ["완료", "진행중", "지연", "미착수"],
        "datasets": [{
            "data": [tot_completed, tot_inprog, tot_delayed, tot_notstart],
            "backgroundColor": ["#22c55e", "#3b82f6", "#ef4444", "#9ca3af"],
        }],
        "meta": {"totalTasks": tot_all},
    }

    # ── BIM 프로젝트별 총 부재 수 수평 바 ────────────────────────────────────
    bim_projects = bim.get("projects", []) if isinstance(bim, dict) else []
    bim_names    = [p.get("projectName", f"BIM{p.get('projectId','')}") for p in bim_projects]
    bim_totals   = [int(p.get("totalElements", 0) or 0)                 for p in bim_projects]

    bim_elements = {
        "type":      "bar",
        "title":     "BIM 프로젝트별 총 부재 수",
        "labels":    bim_names,
        "indexAxis": "y",
        "datasets": [{
            "label":           "총 부재",
            "data":            bim_totals,
            "backgroundColor": "#8b5cf6",
        }],
    }

    # ── 전체 BIM 부재 타입 분포 도넛 ────────────────────────────────────────
    global_type_counts: dict[str, int] = {}
    for p in bim_projects:
        for s in p.get("stats", []):
            etype = s.get("elementType", "Unknown")
            cnt   = int(s.get("elementCount", 0) or 0)
            global_type_counts[etype] = global_type_counts.get(etype, 0) + cnt

    sorted_types = sorted(global_type_counts.items(), key=lambda x: -x[1])
    bt_labels  = [_ELEM_KO.get(k, k) for k, _ in sorted_types]
    bt_data    = [v for _, v in sorted_types]
    bt_colors  = [_ELEM_COLORS[i % len(_ELEM_COLORS)] for i in range(len(bt_labels))]

    bim_type_overall = {
        "type":  "doughnut",
        "title": "전체 BIM 부재 타입 분포",
        "labels": bt_labels,
        "datasets": [{
            "label":           "부재 수",
            "data":            bt_data,
            "backgroundColor": bt_colors,
        }],
    }

    # ── 안전 감지 현황 바 ────────────────────────────────────────────────────
    safe_stats  = safe.get("stats", {}) if isinstance(safe, dict) else {}
    total_scans = int(safe_stats.get("totalScans",       safe_stats.get("total_scans",     0)))
    danger      = int(safe_stats.get("dangerCount",      safe_stats.get("danger_count",    0)))
    helmet      = int(safe_stats.get("helmetViolations", 0))
    area        = int(safe_stats.get("areaViolations",   safe_stats.get("intrusionEvents", 0)))
    safe_cnt    = max(0, total_scans - danger)

    safety_overview = {
        "type":  "bar",
        "title": "안전 감지 현황",
        "labels": ["총 스캔", "정상", "위험 감지", "헬멧 미착용", "구역 침입"],
        "datasets": [{
            "label": "건수",
            "data":  [total_scans, safe_cnt, danger, helmet, area],
            "backgroundColor": ["#94a3b8", "#22c55e", "#ef4444", "#f59e0b", "#f97316"],
        }],
    }

    return {
        "projectProgress": project_progress,
        "overallStatus":   overall_status,
        "bimElements":     bim_elements,
        "bimTypeOverall":  bim_type_overall,
        "safetyOverview":  safety_overview,
    }


def run_orchestrator_agent(state: AgentState) -> dict:
    logger.info("[NODE] ▶ orchestrator_agent 진입")
    from tools.report_tool import (
        collect_wbs_overview, collect_bim_overview, collect_safe_overview,
    )

    wbs  = _invoke(collect_wbs_overview,  {})
    bim  = _invoke(collect_bim_overview,  {})
    safe = _invoke(collect_safe_overview, {})

    # 특정 WBS 프로젝트 링크 수집 (project_id 있을 때만)
    links: dict = {}
    wbs_project_id = state.get("wbs_project_id")
    if wbs_project_id:
        from tools.report_tool import collect_project_links
        links = _invoke(collect_project_links, {"wbs_project_id": str(wbs_project_id)})

    charts = _build_report_charts(wbs, bim, safe)

    report_data = {
        "wbs":    wbs,
        "bim":    bim,
        "safe":   safe,
        "links":  links,
        "charts": charts,
    }

    return {
        "tool_results": {
            "data":        report_data,
            "report_data": report_data,
        },
        "report_data": report_data,
    }
