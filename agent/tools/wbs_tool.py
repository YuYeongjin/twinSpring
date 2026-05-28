"""
WBS Agent 도구 모음

담당 도메인:
  - WBS 프로젝트 CRUD (list / get / create / update / delete)
  - WBS 태스크 CRUD  (list / add / update / delete)
  - 프로젝트 연결   (BIM / Safe / Simulation ↔ WBS)
"""
from __future__ import annotations
from typing import Optional

import json
import httpx
from langchain_core.tools import tool
from config.settings import SPRING_BASE_URL


# ── 프로젝트 도구 ─────────────────────────────────────────────────────────────

@tool
def list_wbs_projects() -> str:
    """
    DB에 저장된 WBS 프로젝트(현장) 목록을 반환합니다.
    프로젝트 ID, 현장명, 위치, 상태, 시작일, 종료일, 태스크 수를 포함합니다.
    """
    try:
        res = httpx.get(f"{SPRING_BASE_URL}/api/wbs/projects", timeout=10)
        res.raise_for_status()
        projects = res.json()
        return json.dumps({"projects": projects, "count": len(projects)}, ensure_ascii=False)
    except httpx.ConnectError:
        return json.dumps({"error": f"Spring 서버 연결 실패 ({SPRING_BASE_URL})"})
    except Exception as e:
        return json.dumps({"error": str(e)})


@tool
def get_wbs_project(project_id: str) -> str:
    """
    특정 WBS 프로젝트의 상세 정보를 반환합니다.
    project_id 는 list_wbs_projects 로 확인한 ID 를 사용합니다.
    """
    try:
        res = httpx.get(f"{SPRING_BASE_URL}/api/wbs/project/{project_id}", timeout=10)
        res.raise_for_status()
        return json.dumps(res.json(), ensure_ascii=False)
    except Exception as e:
        return json.dumps({"error": str(e)})


@tool
def create_wbs_project(
    project_name: str,
    location: str = "",
    start_date: str = "",
    end_date: str = "",
    contract_amount: Optional[int] = None,
    client_name: str = "",
    manager_name: str = "",
    description: str = "",
    status: str = "PLANNED",
) -> str:
    """
    새 WBS 현장 프로젝트를 생성합니다.

    project_name: 현장명 (필수)
    location: 현장 위치
    start_date: 착공일 (YYYY-MM-DD)
    end_date: 준공 예정일 (YYYY-MM-DD)
    contract_amount: 계약금액 (원, 숫자만)
    client_name: 발주처
    manager_name: 현장소장
    description: 설명
    status: PLANNED | IN_PROGRESS | COMPLETED | SUSPENDED (기본 PLANNED)
    """
    payload = {
        "projectName":    project_name,
        "location":       location or None,
        "startDate":      start_date or None,
        "endDate":        end_date or None,
        "contractAmount": contract_amount,
        "clientName":     client_name or None,
        "managerName":    manager_name or None,
        "description":    description or None,
        "status":         status,
    }
    try:
        res = httpx.post(f"{SPRING_BASE_URL}/api/wbs/project", json=payload, timeout=10)
        res.raise_for_status()
        data = res.json()
        return json.dumps({
            "success":     True,
            "projectId":   data.get("projectId"),
            "projectName": project_name,
            "message":     f"WBS 프로젝트 '{project_name}' 생성 완료",
        }, ensure_ascii=False)
    except httpx.ConnectError:
        return json.dumps({"success": False, "error": f"Spring 서버 연결 실패 ({SPRING_BASE_URL})"})
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})


@tool
def update_wbs_project(
    project_id: str,
    project_name: Optional[str] = None,
    location: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    contract_amount: Optional[int] = None,
    client_name: Optional[str] = None,
    manager_name: Optional[str] = None,
    description: Optional[str] = None,
    status: Optional[str] = None,
) -> str:
    """
    WBS 프로젝트 정보를 수정합니다. 변경할 필드만 전달하면 됩니다.
    project_id 는 필수입니다.
    status 값: PLANNED | IN_PROGRESS | COMPLETED | SUSPENDED
    """
    try:
        curr_res = httpx.get(f"{SPRING_BASE_URL}/api/wbs/project/{project_id}", timeout=10)
        curr_res.raise_for_status()
        curr = curr_res.json()
    except Exception as e:
        return json.dumps({"success": False, "error": f"프로젝트 조회 실패: {e}"})

    payload = {
        "projectName":    project_name    if project_name    is not None else curr.get("projectName"),
        "location":       location        if location        is not None else curr.get("location"),
        "startDate":      start_date      if start_date      is not None else curr.get("startDate"),
        "endDate":        end_date        if end_date        is not None else curr.get("endDate"),
        "contractAmount": contract_amount if contract_amount is not None else curr.get("contractAmount"),
        "clientName":     client_name     if client_name     is not None else curr.get("clientName"),
        "managerName":    manager_name    if manager_name    is not None else curr.get("managerName"),
        "description":    description     if description     is not None else curr.get("description"),
        "status":         status          if status          is not None else curr.get("status"),
    }
    try:
        res = httpx.put(f"{SPRING_BASE_URL}/api/wbs/project/{project_id}", json=payload, timeout=10)
        res.raise_for_status()
        return json.dumps({"success": True, "message": f"프로젝트 '{payload['projectName']}' 수정 완료"}, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})


@tool
def delete_wbs_project(project_id: str) -> str:
    """
    WBS 프로젝트와 해당 프로젝트의 모든 태스크를 삭제합니다.
    이 작업은 되돌릴 수 없습니다.
    """
    try:
        res = httpx.delete(f"{SPRING_BASE_URL}/api/wbs/project/{project_id}", timeout=10)
        res.raise_for_status()
        return json.dumps({"success": True, "message": f"프로젝트 {project_id} 및 모든 태스크 삭제 완료"}, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})


# ── 태스크 도구 ───────────────────────────────────────────────────────────────

@tool
def list_wbs_tasks(project_id: str) -> str:
    """
    특정 WBS 프로젝트의 태스크(공정) 목록을 반환합니다.
    태스크 ID, WBS 코드, 태스크명, 진행률, 상태, 담당자 등을 포함합니다.
    """
    try:
        res = httpx.get(f"{SPRING_BASE_URL}/api/wbs/project/{project_id}/tasks", timeout=10)
        res.raise_for_status()
        tasks = res.json()
        return json.dumps({"projectId": project_id, "tasks": tasks, "count": len(tasks)}, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"error": str(e)})


@tool
def add_wbs_task(
    project_id: str,
    task_name: str,
    wbs_code: str = "",
    start_date: str = "",
    end_date: str = "",
    duration: int = 0,
    progress: int = 0,
    status: str = "NOT_STARTED",
    responsible: str = "",
    notes: str = "",
    predecessor_ids: str = "",
    sort_order: int = 0,
) -> str:
    """
    WBS 프로젝트에 태스크(공정)를 추가합니다.

    project_id: 대상 프로젝트 ID (필수)
    task_name: 태스크명 (필수)
    wbs_code: WBS 코드 (예: 1.1.1)
    start_date: 시작일 (YYYY-MM-DD)
    end_date: 종료일 (YYYY-MM-DD)
    duration: 기간 (일, 정수)
    progress: 진행률 (0~100)
    status: NOT_STARTED | IN_PROGRESS | COMPLETED | DELAYED
    responsible: 담당자
    notes: 비고
    predecessor_ids: 선행 태스크 ID 목록 (쉼표 구분)
    sort_order: 정렬 순서
    """
    payload = {
        "wbsCode":        wbs_code or "",
        "taskName":       task_name,
        "startDate":      start_date or None,
        "endDate":        end_date or None,
        "duration":       duration,
        "progress":       progress,
        "status":         status,
        "responsible":    responsible or "",
        "notes":          notes or "",
        "predecessorIds": predecessor_ids or "",
        "source":         "AGENT_AUTO",
        "sortOrder":      sort_order,
    }
    try:
        res = httpx.post(f"{SPRING_BASE_URL}/api/wbs/project/{project_id}/task", json=payload, timeout=10)
        res.raise_for_status()
        data = res.json()
        return json.dumps({
            "success":  True,
            "taskId":   data.get("taskId"),
            "taskName": task_name,
            "message":  f"태스크 '{task_name}' 추가 완료",
        }, ensure_ascii=False)
    except httpx.ConnectError:
        return json.dumps({"success": False, "error": f"Spring 서버 연결 실패 ({SPRING_BASE_URL})"})
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})


@tool
def update_wbs_task(
    project_id: str,
    task_id: str,
    task_name: Optional[str] = None,
    wbs_code: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    duration: Optional[int] = None,
    progress: Optional[int] = None,
    status: Optional[str] = None,
    responsible: Optional[str] = None,
    notes: Optional[str] = None,
    predecessor_ids: Optional[str] = None,
    sort_order: Optional[int] = None,
) -> str:
    """
    WBS 태스크 정보를 수정합니다. 변경할 필드만 전달하면 됩니다.
    project_id: 해당 태스크가 속한 프로젝트 ID (현재 태스크 값 조회에 필요)
    task_id: 수정할 태스크 ID (필수)
    status 값: NOT_STARTED | IN_PROGRESS | COMPLETED | DELAYED
    progress: 0~100 사이 정수
    """
    try:
        list_res = httpx.get(f"{SPRING_BASE_URL}/api/wbs/project/{project_id}/tasks", timeout=10)
        list_res.raise_for_status()
        tasks = list_res.json()
        curr = next((t for t in tasks if t.get("taskId") == task_id), None)
        if curr is None:
            return json.dumps({"success": False, "error": f"태스크 {task_id} 를 찾을 수 없습니다"})
    except Exception as e:
        return json.dumps({"success": False, "error": f"태스크 조회 실패: {e}"})

    payload = {
        "wbsCode":        wbs_code        if wbs_code        is not None else curr.get("wbsCode", ""),
        "taskName":       task_name       if task_name       is not None else curr.get("taskName", ""),
        "startDate":      start_date      if start_date      is not None else curr.get("startDate"),
        "endDate":        end_date        if end_date        is not None else curr.get("endDate"),
        "duration":       duration        if duration        is not None else curr.get("duration", 0),
        "progress":       progress        if progress        is not None else curr.get("progress", 0),
        "status":         status          if status          is not None else curr.get("status", "NOT_STARTED"),
        "responsible":    responsible     if responsible     is not None else curr.get("responsible", ""),
        "notes":          notes           if notes           is not None else curr.get("notes", ""),
        "predecessorIds": predecessor_ids if predecessor_ids is not None else curr.get("predecessorIds", ""),
        "sortOrder":      sort_order      if sort_order      is not None else curr.get("sortOrder", 0),
    }
    try:
        res = httpx.put(f"{SPRING_BASE_URL}/api/wbs/task/{task_id}", json=payload, timeout=10)
        res.raise_for_status()
        return json.dumps({"success": True, "message": f"태스크 '{payload['taskName']}' 수정 완료"}, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})


@tool
def delete_wbs_task(task_id: str) -> str:
    """
    WBS 태스크를 삭제합니다.
    task_id 는 list_wbs_tasks 로 확인한 ID 를 사용합니다.
    """
    try:
        res = httpx.delete(f"{SPRING_BASE_URL}/api/wbs/task/{task_id}", timeout=10)
        res.raise_for_status()
        return json.dumps({"success": True, "message": f"태스크 {task_id} 삭제 완료"}, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})


# ── 프로젝트 연결 도구 ────────────────────────────────────────────────────────

@tool
def list_wbs_links(wbs_project_id: str) -> str:
    """
    WBS 프로젝트에 연결된 BIM/Safe/Simulation 프로젝트 목록을 반환합니다.
    연결 ID, 타입(BIM/SAFE/SIMULATION), 연결된 프로젝트 ID를 포함합니다.
    """
    try:
        res = httpx.get(f"{SPRING_BASE_URL}/api/project-link/wbs/{wbs_project_id}", timeout=10)
        res.raise_for_status()
        links = res.json()
        return json.dumps({"wbsProjectId": wbs_project_id, "links": links, "count": len(links)}, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"error": str(e)})


@tool
def link_wbs_project(
    wbs_project_id: str,
    linked_type: str,
    linked_project_id: str,
    note: str = "",
) -> str:
    """
    WBS 프로젝트를 BIM / Safe / Simulation 탭의 프로젝트와 연결합니다.

    wbs_project_id: WBS 프로젝트 ID
    linked_type: BIM | SAFE | SIMULATION
    linked_project_id: 연결할 프로젝트의 ID
    note: 연결 메모 (선택)
    """
    payload = {
        "wbsProjectId":    wbs_project_id,
        "linkedType":      linked_type.upper(),
        "linkedProjectId": linked_project_id,
        "note":            note or "",
    }
    try:
        res = httpx.post(f"{SPRING_BASE_URL}/api/project-link", json=payload, timeout=10)
        res.raise_for_status()
        data = res.json()
        return json.dumps({
            "success": True,
            "linkId":  data.get("linkId"),
            "message": f"WBS {wbs_project_id} ↔ {linked_type.upper()} {linked_project_id} 연결 완료",
        }, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})


@tool
def delete_wbs_link(link_id: str) -> str:
    """
    WBS 프로젝트와 다른 탭 프로젝트 간의 연결을 삭제합니다.
    link_id 는 list_wbs_links 로 확인한 ID 를 사용합니다.
    """
    try:
        res = httpx.delete(f"{SPRING_BASE_URL}/api/project-link/{link_id}", timeout=10)
        res.raise_for_status()
        return json.dumps({"success": True, "message": f"연결 {link_id} 삭제 완료"}, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})


# ── 도구 목록 ─────────────────────────────────────────────────────────────────
WBS_TOOLS = [
    list_wbs_projects,
    get_wbs_project,
    create_wbs_project,
    update_wbs_project,
    delete_wbs_project,
    list_wbs_tasks,
    add_wbs_task,
    update_wbs_task,
    delete_wbs_task,
    list_wbs_links,
    link_wbs_project,
    delete_wbs_link,
]
