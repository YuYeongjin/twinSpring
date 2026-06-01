"""
WBS Domain Agent — LLM 없음, Tool 전용 디스패처
"""
from __future__ import annotations

import re
import json
import logging

from config.state import AgentState

logger = logging.getLogger(__name__)

_TASK_PAT   = re.compile(r"태스크|공정(?!\s*표)|task|公程", re.I)
_LINK_PAT   = re.compile(r"연결|링크|연동|link|connect|連結|リンク", re.I)
_CREATE_PAT = re.compile(r"생성|만들|추가|create|add|作成|追加", re.I)
_UPDATE_PAT = re.compile(r"수정|변경|업데이트|update|modify|修正|変更", re.I)
_DELETE_PAT = re.compile(r"삭제|제거|delete|remove|削除", re.I)


def _invoke(tool_fn, args: dict) -> dict:
    logger.info("[wbs] tool 호출: %s args=%s", tool_fn.name, args)
    try:
        raw = tool_fn.invoke(args)
        return json.loads(raw) if isinstance(raw, str) else raw
    except Exception as e:
        logger.error("[wbs] %s 실패: %s", tool_fn.name, e)
        return {"success": False, "error": str(e)}


def _extract_quoted(text: str, fallback: str) -> str:
    m = re.search(r'["\'「]([^"\'」]+)["\'」]', text)
    return m.group(1) if m else fallback


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

    if _TASK_PAT.search(text):
        if _CREATE_PAT.search(text):
            name   = _extract_quoted(text, "새 공정")
            result = _invoke(add_wbs_task, {
                "project_id": int(proj_id) if proj_id else 1,
                "name":       name,
            })
        elif _UPDATE_PAT.search(text):
            nums    = re.findall(r'\d+', text)
            task_id = int(nums[0]) if nums else 1
            # 상태값 추출: 완료/완료됨/COMPLETED 등
            status = None
            if re.search(r"완료|completed|complete", text, re.I):
                status = "COMPLETED"
            elif re.search(r"진행|in.progress|진행중", text, re.I):
                status = "IN_PROGRESS"
            elif re.search(r"지연|delayed|지연됨", text, re.I):
                status = "DELAYED"
            args = {"task_id": task_id}
            if status:
                args["status"] = status
            result = _invoke(update_wbs_task, args)
        elif _DELETE_PAT.search(text):
            nums    = re.findall(r'\d+', text)
            task_id = int(nums[0]) if nums else 1
            result  = _invoke(delete_wbs_task, {"task_id": task_id})
        else:
            result = _invoke(list_wbs_tasks, {
                "project_id": int(proj_id) if proj_id else 1,
            })
    elif _LINK_PAT.search(text):
        result = _invoke(list_wbs_links, {
            "project_id": int(proj_id) if proj_id else 1,
        })
    elif _CREATE_PAT.search(text):
        name   = _extract_quoted(text, "새 프로젝트")
        result = _invoke(create_wbs_project, {"name": name})
    elif _DELETE_PAT.search(text):
        nums   = re.findall(r'\d+', text)
        pid    = int(nums[0]) if nums else (int(proj_id) if proj_id else 1)
        result = _invoke(delete_wbs_project, {"project_id": pid})
    elif proj_id:
        result = _invoke(get_wbs_project, {"project_id": int(proj_id)})
    else:
        result = _invoke(list_wbs_projects, {})

    return {"tool_results": {"data": result}}
