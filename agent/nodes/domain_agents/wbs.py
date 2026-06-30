"""
WBS Domain Agent — LLM 없음, Tool 전용 디스패처

차트 데이터:
  - statusPie      : 공정 상태 분포 (도넛)
  - progressBar    : 태스크별 실제 vs 계획 진행률 (혼합 바+라인)
  - workerWorkload : 담당자별 태스크 수·완료·총 공기 (스택 바)
  - gantt          : 간트 차트 데이터 (startDate·endDate 있는 태스크)
  - progressLine   : 공정 누적 완료율 추이 (라인) — 완료일 기준 S-curve
"""
from __future__ import annotations

import re
import json
import logging
from datetime import date

from config.state import AgentState

logger = logging.getLogger(__name__)

_TASK_PAT   = re.compile(r"태스크|공정(?!\s*표)|task|公程", re.I)
_LINK_PAT   = re.compile(r"연결|링크|연동|link|connect|連結|リンク", re.I)
_CREATE_PAT = re.compile(r"생성|만들|추가|create|add|作成|追加", re.I)
_UPDATE_PAT = re.compile(r"수정|변경|업데이트|update|modify|修正|変更", re.I)
_DELETE_PAT = re.compile(r"삭제|제거|delete|remove|削除", re.I)

# ── 색상/레이블 상수 ────────────────────────────────────────────────────────────
_STATUS_COLORS = {
    "COMPLETED":   "#22c55e",
    "IN_PROGRESS": "#3b82f6",
    "DELAYED":     "#ef4444",
    "NOT_STARTED": "#9ca3af",
}
_STATUS_KO = {
    "COMPLETED":   "완료",
    "IN_PROGRESS": "진행중",
    "DELAYED":     "지연",
    "NOT_STARTED": "미착수",
}


# ── 계획 진행률 계산 ────────────────────────────────────────────────────────────

def _planned_progress(start_str: str, end_str: str) -> float | None:
    """오늘 날짜 기준 선형 계획 진행률(%) 반환. 날짜 없으면 None."""
    try:
        today = date.today()
        s = date.fromisoformat(str(start_str)[:10])
        e = date.fromisoformat(str(end_str)[:10])
        if today <= s:
            return 0.0
        if today >= e:
            return 100.0
        span = (e - s).days
        return round((today - s).days / span * 100, 1) if span > 0 else 0.0
    except Exception:
        return None


# ── 태스크 차트 빌더 ────────────────────────────────────────────────────────────

def _build_tasks_chart(tasks_result: dict, project_id) -> dict:
    """
    태스크 목록에서 4종 차트 + 간트 데이터를 생성합니다.

    charts:
      statusPie      — 공정 상태 분포 도넛
      progressBar    — 태스크별 실제 vs 계획 진행률 (바+라인 혼합)
      workerWorkload — 담당자별 태스크 수·완료·총 공기 스택 바
      progressLine   — 완료 태스크 누적 S-curve 라인
    gantt: [{id, name, wbsCode, start, end, progress, status, color}]
    """
    tasks = tasks_result.get("tasks", [])
    if not isinstance(tasks, list):
        tasks = []

    status_counts  = {k: 0 for k in _STATUS_COLORS}
    task_chart     = []
    worker_stats: dict[str, dict] = {}
    total_progress = 0

    pb_labels:  list[str]         = []   # progressBar labels
    actual_pct: list[int]         = []
    planned_pct: list[float|None] = []

    gantt: list[dict] = []
    completed_dates: list[str] = []   # S-curve 용

    for t in tasks:
        status   = t.get("status", "NOT_STARTED")
        if status not in status_counts:
            status_counts[status] = 0
        status_counts[status] += 1

        progress  = int(t.get("progress", 0) or 0)
        total_progress += progress

        start_d = t.get("startDate", "") or ""
        end_d   = t.get("endDate",   "") or ""
        dur     = int(t.get("duration", 0) or 0)
        name    = t.get("taskName") or t.get("name", "")
        resp    = t.get("responsible", "") or "미지정"

        planned = _planned_progress(start_d, end_d)

        task_chart.append({
            "id":          t.get("taskId") or t.get("id"),
            "name":        name,
            "wbsCode":     t.get("wbsCode", ""),
            "status":      status,
            "progress":    progress,
            "planned":     planned,
            "startDate":   start_d,
            "endDate":     end_d,
            "duration":    dur,
            "responsible": resp,
        })

        # progressBar 데이터
        short_name = (name[:10] + "…") if len(name) > 10 else name
        pb_labels.append(short_name)
        actual_pct.append(progress)
        planned_pct.append(planned)

        # 간트 (날짜 있는 태스크만)
        if start_d and end_d:
            gantt.append({
                "id":       t.get("taskId") or t.get("id"),
                "name":     name,
                "wbsCode":  t.get("wbsCode", ""),
                "start":    start_d,
                "end":      end_d,
                "progress": progress,
                "status":   status,
                "color":    _STATUS_COLORS.get(status, "#9ca3af"),
                "responsible": resp,
            })

        # S-curve: 완료 태스크의 종료일 수집
        if status == "COMPLETED" and end_d:
            completed_dates.append(end_d)

        # 담당자 작업량
        if resp not in worker_stats:
            worker_stats[resp] = {"taskCount": 0, "totalDuration": 0,
                                   "completed": 0, "inProgress": 0, "delayed": 0}
        worker_stats[resp]["taskCount"]     += 1
        worker_stats[resp]["totalDuration"] += dur
        if status == "COMPLETED":
            worker_stats[resp]["completed"]  += 1
        elif status == "IN_PROGRESS":
            worker_stats[resp]["inProgress"] += 1
        elif status == "DELAYED":
            worker_stats[resp]["delayed"]    += 1

    total = len(tasks)

    # ── statusPie (도넛) ───────────────────────────────────────────────────────
    status_pie = {
        "type":  "doughnut",
        "title": "공정 상태 분포",
        "labels": [_STATUS_KO[k] for k in _STATUS_COLORS],
        "datasets": [{
            "label": "태스크 수",
            "data":  [status_counts.get(k, 0) for k in _STATUS_COLORS],
            "backgroundColor": list(_STATUS_COLORS.values()),
        }],
    }

    # ── progressBar (바 + 라인 혼합) ──────────────────────────────────────────
    progress_bar = {
        "type":  "bar",
        "title": "태스크별 진행률 (실적 vs 계획)",
        "labels": pb_labels,
        "datasets": [
            {
                "type":            "bar",
                "label":           "실제 진행률(%)",
                "data":            actual_pct,
                "backgroundColor": "#22c55e",
                "order":           2,
            },
            {
                "type":            "line",
                "label":           "계획 진행률(%)",
                "data":            planned_pct,
                "borderColor":     "#3b82f6",
                "backgroundColor": "transparent",
                "pointRadius":     3,
                "order":           1,
            },
        ],
    }

    # ── workerWorkload (스택 바) ───────────────────────────────────────────────
    workers = sorted(worker_stats.keys())
    worker_chart = {
        "type":    "bar",
        "title":   "담당자별 작업량",
        "labels":  workers,
        "stacked": True,
        "datasets": [
            {
                "label":           "완료",
                "data":            [worker_stats[w]["completed"]  for w in workers],
                "backgroundColor": "#22c55e",
            },
            {
                "label":           "진행중",
                "data":            [worker_stats[w]["inProgress"] for w in workers],
                "backgroundColor": "#3b82f6",
            },
            {
                "label":           "지연",
                "data":            [worker_stats[w]["delayed"]    for w in workers],
                "backgroundColor": "#ef4444",
            },
        ],
        "durationDataset": {
            "label": "총 공기(일)",
            "data":  [worker_stats[w]["totalDuration"] for w in workers],
        },
    }

    # ── progressLine (S-curve) ────────────────────────────────────────────────
    completed_dates.sort()
    s_labels: list[str] = []
    for d in completed_dates:
        s_labels.append(d[:7])   # YYYY-MM
    # 중복 월 합산
    s_monthly: dict[str, int] = {}
    for label in s_labels:
        s_monthly[label] = s_monthly.get(label, 0) + 1
    s_cumulative: list[int] = []
    running = 0
    for v in s_monthly.values():
        running += v
        s_cumulative.append(round(running / total * 100, 1) if total else 0)

    progress_line = {
        "type":  "line",
        "title": "공정 누적 완료율 (S-Curve)",
        "labels": list(s_monthly.keys()),
        "datasets": [{
            "label":           "누적 완료율(%)",
            "data":            s_cumulative,
            "borderColor":     "#8b5cf6",
            "backgroundColor": "rgba(139,92,246,0.15)",
            "fill":            True,
            "tension":         0.4,
        }],
    }

    return {
        "projectId": project_id,
        "tasks":     task_chart,
        "gantt":     gantt,
        "summary": {
            "total":       total,
            "completed":   status_counts.get("COMPLETED",   0),
            "inProgress":  status_counts.get("IN_PROGRESS", 0),
            "delayed":     status_counts.get("DELAYED",     0),
            "notStarted":  status_counts.get("NOT_STARTED", 0),
            "avgProgress": round(total_progress / total, 1) if total else 0,
        },
        "charts": {
            "statusPie":      status_pie,
            "progressBar":    progress_bar,
            "workerWorkload": worker_chart,
            "progressLine":   progress_line,
            "gantt":          gantt,
        },
        "chartType": "multi",
    }


def _build_projects_chart(projects_result: dict) -> dict:
    """프로젝트 목록 개요 차트."""
    projects = projects_result.get("projects", [])
    if not isinstance(projects, list):
        projects = []

    names       = [p.get("projectName") or p.get("name", f"P{p.get('projectId','')}") for p in projects]
    task_counts = [int(p.get("taskCount", 0) or 0) for p in projects]

    return {
        "projects":  projects,
        "total":     len(projects),
        "charts": {
            "taskCountBar": {
                "type":  "bar",
                "title": "현장별 태스크 수",
                "labels": names,
                "datasets": [{
                    "label":           "태스크 수",
                    "data":            task_counts,
                    "backgroundColor": "#3b82f6",
                }],
            },
        },
        "chartType": "bar",
    }


# ── invoke helper ──────────────────────────────────────────────────────────────

def _invoke(tool_fn, args: dict) -> dict:
    logger.info("[wbs] tool 호출: %s args=%s", tool_fn.name, args)
    try:
        raw = tool_fn.invoke(args)
        return json.loads(raw) if isinstance(raw, str) else raw
    except Exception as e:
        logger.error("[wbs] %s 실패 (args=%s): %s", tool_fn.name, args, e, exc_info=True)
        return {"success": False, "error": "공정 데이터를 불러올 수 없습니다."}


def _extract_quoted(text: str, fallback: str) -> str:
    m = re.search(r'["\'「]([^"\'」]+)["\'」]', text)
    return m.group(1) if m else fallback


# ── 메인 에이전트 ──────────────────────────────────────────────────────────────

def run_wbs_agent(state: AgentState) -> dict:
    logger.info("[NODE] ▶ wbs_agent 진입")
    from tools.wbs_tool import (
        list_wbs_projects, get_wbs_project, create_wbs_project,
        delete_wbs_project, list_wbs_tasks, add_wbs_task,
        update_wbs_task, delete_wbs_task, list_wbs_links,
    )

    messages = state.get("messages", [])
    text     = messages[-1].content if messages and hasattr(messages[-1], "content") else ""
    proj_id  = state.get("wbs_project_id")
    logger.info("[wbs] 입력 텍스트: %.80s", text)

    wbs_data = None

    if _TASK_PAT.search(text):
        if _CREATE_PAT.search(text):
            name   = _extract_quoted(text, "새 공정")
            result = _invoke(add_wbs_task, {
                "project_id": int(proj_id) if proj_id else 1,
                "name":       name,
            })
            if proj_id:
                tasks_result = _invoke(list_wbs_tasks, {"project_id": int(proj_id)})
                wbs_data = _build_tasks_chart(tasks_result, proj_id)

        elif _UPDATE_PAT.search(text):
            nums    = re.findall(r'\d+', text)
            task_id = int(nums[0]) if nums else 1
            status  = None
            if re.search(r"완료|completed|complete", text, re.I):
                status = "COMPLETED"
            elif re.search(r"진행|in.progress|진행중", text, re.I):
                status = "IN_PROGRESS"
            elif re.search(r"지연|delayed|지연됨", text, re.I):
                status = "DELAYED"
            args = {"task_id": task_id, "project_id": int(proj_id) if proj_id else 1}
            if status:
                args["status"] = status
            result = _invoke(update_wbs_task, args)
            if proj_id:
                tasks_result = _invoke(list_wbs_tasks, {"project_id": int(proj_id)})
                wbs_data = _build_tasks_chart(tasks_result, proj_id)

        elif _DELETE_PAT.search(text):
            nums    = re.findall(r'\d+', text)
            task_id = int(nums[0]) if nums else 1
            result  = _invoke(delete_wbs_task, {"task_id": task_id})
            if proj_id:
                tasks_result = _invoke(list_wbs_tasks, {"project_id": int(proj_id)})
                wbs_data = _build_tasks_chart(tasks_result, proj_id)

        else:
            result   = _invoke(list_wbs_tasks, {"project_id": int(proj_id) if proj_id else 1})
            wbs_data = _build_tasks_chart(result, proj_id)

    elif _LINK_PAT.search(text):
        result = _invoke(list_wbs_links, {"project_id": int(proj_id) if proj_id else 1})

    elif _CREATE_PAT.search(text):
        name   = _extract_quoted(text, "새 프로젝트")
        result = _invoke(create_wbs_project, {"name": name})

    elif _DELETE_PAT.search(text):
        nums   = re.findall(r'\d+', text)
        pid    = int(nums[0]) if nums else (int(proj_id) if proj_id else 1)
        result = _invoke(delete_wbs_project, {"project_id": pid})

    elif proj_id:
        result       = _invoke(get_wbs_project, {"project_id": int(proj_id)})
        tasks_result = _invoke(list_wbs_tasks,  {"project_id": int(proj_id)})
        wbs_data     = _build_tasks_chart(tasks_result, proj_id)

    else:
        result   = _invoke(list_wbs_projects, {})
        wbs_data = _build_projects_chart(result)

    return {
        "tool_results": {"data": result, "wbs_data": wbs_data},
        "wbs_data":     wbs_data,
    }
