"""
WBS Agent — WBS 현장 프로젝트 관리 전문 에이전트

담당:
  - WBS 프로젝트(현장) CRUD — 생성 / 조회 / 수정 / 삭제
  - WBS 태스크(공정) CRUD  — 추가 / 조회 / 수정 / 삭제
  - BIM / Safe / Simulation 탭 연결 관리
  - 건설 시방서(KCS/KDS) 기반 공정 추천
"""
from __future__ import annotations
import logging

from langchain_core.messages import SystemMessage, AIMessage

logger = logging.getLogger(__name__)
from langgraph.prebuilt import create_react_agent

from config.llm_config import llm_chat
from config.lang_util import detect_lang, lang_instruction, error_msg
from tools.wbs_tool import WBS_TOOLS
from tools.construction_rag_tool import CONSTRUCTION_RAG_TOOLS


_SYSTEM = SystemMessage(content=(
    "You are a WBS (Work Breakdown Structure) construction project management specialist.\n\n"

    "Manage construction site projects and tasks through natural conversation. "
    "Always call the appropriate tool FIRST before answering.\n\n"

    "## Tool Selection Guide\n"
    "- list_wbs_projects: List all projects, or find a project ID. Call this first when the project ID is unknown.\n"
    "- get_wbs_project: Get details of a specific project by ID.\n"
    "- create_wbs_project: Create a new construction project. Requires at minimum: project_name.\n"
    "- update_wbs_project: Update project info (status, dates, manager, etc.). Always fetch current values first.\n"
    "- delete_wbs_project: Delete a project and ALL its tasks. Confirm with user before executing.\n"
    "- list_wbs_tasks: List tasks for a project. Call this first when asked about tasks or to find a task ID.\n"
    "- add_wbs_task: Add a task/work package to a project.\n"
    "- update_wbs_task: Update task progress, status, dates, responsible. Needs project_id + task_id.\n"
    "- delete_wbs_task: Delete a single task by task_id.\n"
    "- list_wbs_links: List BIM/Safe/Simulation links for a WBS project.\n"
    "- link_wbs_project: Link WBS project with BIM, Safe, or Simulation projects.\n"
    "- delete_wbs_link: Remove a project link by link_id.\n"
    "- search_spec_tool: Search Korean construction standards (KCS/KDS) for specs. Use for task recommendations.\n"
    "- list_spec_sources: List available construction standards documents.\n\n"

    "## Context Rules\n"
    "- If a wbsProjectId is provided in the system context, use it as the default project when the user says 'this project' or '현재 프로젝트'.\n"
    "- Before deleting a project, list it first so you can mention its name in your response.\n"
    "- For task updates, you MUST provide project_id to fetch current task values. Use the context projectId or ask the user.\n"
    "- If unsure which project the user means, call list_wbs_projects first.\n\n"

    "## Status Values\n"
    "- Project: PLANNED(계획) | IN_PROGRESS(진행중) | COMPLETED(완료) | SUSPENDED(중단)\n"
    "- Task: NOT_STARTED(미시작) | IN_PROGRESS(진행중) | COMPLETED(완료) | DELAYED(지연)\n\n"

    "## Answer Format\n"
    "- Match the language of the user's input.\n"
    "- Be concise: 2~4 sentences after tool results.\n"
    "- For lists, use bullet points (•).\n"
    "- Always mention the project/task name (not just ID) in responses.\n"
    "- On success, briefly confirm what was done.\n"
    "- On failure, explain the error clearly and suggest next steps.\n"
))

_react_agent = None


def _get_agent():
    global _react_agent
    if _react_agent is None:
        _react_agent = create_react_agent(
            model=llm_chat,
            tools=WBS_TOOLS + CONSTRUCTION_RAG_TOOLS,
            prompt=_SYSTEM,
        )
    return _react_agent


def run_wbs_agent(state: dict) -> dict:
    """WBS Agent 실행 엔트리포인트."""
    messages = state.get("messages", [])
    wbs_project_id = state.get("wbs_project_id")

    recent_text = " ".join(m.content for m in messages[-5:] if hasattr(m, "content"))
    lang = detect_lang(recent_text)
    note = lang_instruction(lang)

    context_parts = []
    if note:
        context_parts.append(note)
    if wbs_project_id:
        context_parts.append(
            f"[현재 선택된 WBS 프로젝트 ID: {wbs_project_id}] "
            "사용자가 '이 프로젝트' 또는 '현재 프로젝트'라고 하면 이 ID를 사용하세요."
        )

    agent_messages = list(messages)
    if context_parts:
        agent_messages = [SystemMessage(content="\n".join(context_parts))] + agent_messages

    try:
        result = _get_agent().invoke({"messages": agent_messages})
        last = result["messages"][-1]
        content = last.content if hasattr(last, "content") else str(last)
    except Exception:
        logger.error("[wbs_agent] WBS 처리 실패", exc_info=True)
        content = error_msg(lang)

    return {
        "messages": [AIMessage(content=content)],
        "intent":   "wbs_agent",
    }
