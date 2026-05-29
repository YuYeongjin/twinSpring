"""
Report Tool — WBS/BIM/Safe 데이터 수집 및 보고서 조립 도구
Orchestrator Agent 전용
"""
from __future__ import annotations

import json
import datetime
import httpx
from langchain_core.tools import tool
from config.settings import SPRING_BASE_URL


# ── 데이터 수집 도구 ──────────────────────────────────────────────────────────

@tool
def collect_wbs_overview() -> str:
    """
    전체 WBS 현장 프로젝트와 공정 요약을 수집합니다.
    프로젝트별 태스크 수, 평균 진행률, 상태, 기간을 포함합니다.
    """
    try:
        res = httpx.get(f"{SPRING_BASE_URL}/api/wbs/projects", timeout=10)
        res.raise_for_status()
        projects = res.json()

        summaries = []
        for p in projects:
            proj_id = p.get("projectId")
            try:
                task_res = httpx.get(
                    f"{SPRING_BASE_URL}/api/wbs/project/{proj_id}/tasks",
                    timeout=10,
                )
                tasks = task_res.json() if task_res.status_code == 200 else []
                avg_progress = (
                    round(sum(t.get("progress", 0) for t in tasks) / len(tasks), 1)
                    if tasks else 0
                )
                completed = sum(1 for t in tasks if t.get("status") == "COMPLETED")
                delayed   = sum(1 for t in tasks if t.get("status") == "DELAYED")
            except Exception:
                tasks, avg_progress, completed, delayed = [], 0, 0, 0

            summaries.append({
                "projectId":   proj_id,
                "projectName": p.get("projectName", ""),
                "location":    p.get("location", ""),
                "status":      p.get("status", ""),
                "startDate":   p.get("startDate", ""),
                "endDate":     p.get("endDate", ""),
                "taskCount":   len(tasks),
                "avgProgress": avg_progress,
                "completedTasks": completed,
                "delayedTasks":   delayed,
            })

        return json.dumps(
            {"projects": summaries, "count": len(summaries)},
            ensure_ascii=False,
        )
    except httpx.ConnectError:
        return json.dumps({"error": f"Spring 서버 연결 실패 ({SPRING_BASE_URL})"})
    except Exception as e:
        return json.dumps({"error": str(e)})


@tool
def collect_bim_overview() -> str:
    """
    전체 BIM 프로젝트와 부재 타입별 통계를 수집합니다.
    프로젝트별 총 부재 수와 타입 분포를 포함합니다.
    """
    try:
        res = httpx.get(f"{SPRING_BASE_URL}/api/bim/db-projects", timeout=10)
        res.raise_for_status()
        projects = res.json()

        summaries = []
        for p in projects:
            proj_id = p.get("projectId")
            try:
                stats_res = httpx.get(
                    f"{SPRING_BASE_URL}/api/bim/stats/{proj_id}",
                    timeout=10,
                )
                stats = stats_res.json() if stats_res.status_code == 200 else []
                total = sum(int(s.get("elementCount", 0)) for s in stats)
            except Exception:
                stats, total = [], 0

            summaries.append({
                "projectId":     proj_id,
                "projectName":   p.get("projectName", ""),
                "structureType": p.get("structureType", ""),
                "stats":         stats,
                "totalElements": total,
            })

        return json.dumps(
            {"projects": summaries, "count": len(summaries)},
            ensure_ascii=False,
        )
    except httpx.ConnectError:
        return json.dumps({"error": f"Spring 서버 연결 실패 ({SPRING_BASE_URL})"})
    except Exception as e:
        return json.dumps({"error": str(e)})


@tool
def collect_safe_overview() -> str:
    """
    안전 프로젝트 목록, 최근 감지 이벤트, 안전 통계를 수집합니다.
    헬멧 위반 수, 침입 감지 수, 총 스캔 횟수를 포함합니다.
    """
    try:
        projects_res   = httpx.get(f"{SPRING_BASE_URL}/api/safe/projects", timeout=10)
        detection_res  = httpx.get(
            f"{SPRING_BASE_URL}/api/detection/logs",
            params={"limit": 10}, timeout=8,
        )
        stats_res      = httpx.get(f"{SPRING_BASE_URL}/api/detection/stats", timeout=8)

        projects   = projects_res.json()   if projects_res.status_code == 200   else []
        raw_det    = detection_res.json()  if detection_res.status_code == 200  else []
        detections = raw_det if isinstance(raw_det, list) else raw_det.get("logs", [])
        stats      = stats_res.json()      if stats_res.status_code == 200      else {}

        return json.dumps(
            {
                "projects":          projects,
                "recentDetections":  detections[:10],
                "stats":             stats,
            },
            ensure_ascii=False,
            default=str,
        )
    except httpx.ConnectError:
        return json.dumps({"error": f"Spring 서버 연결 실패 ({SPRING_BASE_URL})"})
    except Exception as e:
        return json.dumps({"error": str(e)})


@tool
def collect_project_links(wbs_project_id: str) -> str:
    """
    특정 WBS 프로젝트와 연결된 BIM/Safe/Simulation 프로젝트 링크를 조회합니다.
    cross-domain 연동 현황 확인에 사용합니다.
    """
    try:
        res = httpx.get(
            f"{SPRING_BASE_URL}/api/project-link/wbs/{wbs_project_id}",
            timeout=10,
        )
        res.raise_for_status()
        links = res.json()
        return json.dumps(
            {"wbsProjectId": wbs_project_id, "links": links, "count": len(links)},
            ensure_ascii=False,
        )
    except Exception as e:
        return json.dumps({"error": str(e)})


# ── 보고서 조립 도구 ──────────────────────────────────────────────────────────

@tool
def assemble_report(title: str, markdown_content: str) -> str:
    """
    제목과 완성된 Markdown 본문을 받아 보고서 JSON을 반환합니다.
    반드시 데이터 수집 도구를 모두 호출한 뒤 마지막 단계로 이 도구를 호출하세요.

    title: 보고서 제목 (예: "3월 현장 통합 보고서")
    markdown_content: 완성된 Markdown 문자열 (섹션·표·목록 포함)
    """
    report = {
        "title":       title,
        "content":     markdown_content,
        "generatedAt": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
    }
    return json.dumps(report, ensure_ascii=False)


# ── 도구 목록 ─────────────────────────────────────────────────────────────────
REPORT_TOOLS = [
    collect_wbs_overview,
    collect_bim_overview,
    collect_safe_overview,
    collect_project_links,
    assemble_report,
]
