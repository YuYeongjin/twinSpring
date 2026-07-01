"""
ReAct 도메인 에이전트 공통 유틸리티

모든 *_react.py 파일에서 공유하는 헬퍼 함수 모음.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from langchain_core.messages import HumanMessage, ToolMessage
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode

from config.state import AgentState
from config.llm_config import llm_responder
from config.lang_util import lang_instruction

logger = logging.getLogger(__name__)


# ── 공통 Tool 호출 래퍼 ───────────────────────────────────────────────────────

def call_tool(tool_fn, args: dict) -> dict:
    try:
        raw = tool_fn.invoke(args)
        return json.loads(raw) if isinstance(raw, str) else raw
    except Exception as e:
        logger.error("[react] %s 실패 args=%s: %s", getattr(tool_fn, "name", "?"), args, e)
        return {"success": False, "error": str(e)}


# ── 이번 턴(마지막 HumanMessage 이후) 도구 실행 결과 추출 ────────────────────

def extract_turn_results(messages: list) -> dict[str, Any]:
    """
    현재 턴에서 호출된 tool 이름 → 마지막 결과 dict 를 반환합니다.
    여러 번 호출된 동일 툴은 마지막 결과로 덮어씁니다.
    """
    last_human = max(
        (i for i, m in enumerate(messages) if isinstance(m, HumanMessage)),
        default=0,
    )
    new_msgs = messages[last_human:]

    call_map: dict[str, str] = {}  # tool_call_id → tool_name
    for msg in new_msgs:
        if hasattr(msg, "tool_calls"):
            for tc in (msg.tool_calls or []):
                call_map[tc["id"]] = tc["name"]

    results: dict[str, Any] = {}
    for msg in new_msgs:
        if isinstance(msg, ToolMessage):
            name = call_map.get(msg.tool_call_id, "")
            if name:
                try:
                    results[name] = json.loads(msg.content) if isinstance(msg.content, str) else msg.content
                except Exception:
                    results[name] = {}
    return results


def extract_turn_args(messages: list) -> dict[str, dict]:
    """
    현재 턴에서 호출된 tool 이름 → args dict 를 반환합니다.
    """
    last_human = max(
        (i for i, m in enumerate(messages) if isinstance(m, HumanMessage)),
        default=0,
    )
    new_msgs = messages[last_human:]

    args_map: dict[str, dict] = {}
    for msg in new_msgs:
        if hasattr(msg, "tool_calls"):
            for tc in (msg.tool_calls or []):
                args_map[tc["name"]] = tc.get("args", {})
    return args_map


# ── 서브그래프 팩토리 ─────────────────────────────────────────────────────────

def build_react_subgraph(
    tools: list,
    system_fn,          # (state: AgentState) -> str
    finalize_fn,        # (state: AgentState) -> dict  — state update only (no messages)
) -> Any:
    """
    표준 ReAct 서브그래프를 생성합니다.

    흐름:
      agent_node → (tool_calls?) → tool_node → agent_node  (루프)
                                 → finalize_node → END
    """
    from langchain_core.messages import SystemMessage

    _llm       = llm_responder.bind_tools(tools)
    _tool_node = ToolNode(tools)

    def agent_node(state: AgentState) -> dict:
        system   = SystemMessage(content=system_fn(state))
        response = _llm.invoke([system] + state["messages"])
        return {"messages": [response]}

    def _route(state: AgentState) -> str:
        last = state["messages"][-1]
        return "tools" if (hasattr(last, "tool_calls") and last.tool_calls) else "finalize"

    def finalize_node(state: AgentState) -> dict:
        return finalize_fn(state)

    sg = StateGraph(AgentState)
    sg.add_node("agent",    agent_node)
    sg.add_node("tools",    _tool_node)
    sg.add_node("finalize", finalize_node)
    sg.set_entry_point("agent")
    sg.add_conditional_edges("agent", _route, {"tools": "tools", "finalize": "finalize"})
    sg.add_edge("tools",    "agent")
    sg.add_edge("finalize", END)
    return sg.compile()


def invoke_subgraph(subgraph, state: AgentState) -> dict:
    """
    서브그래프를 실행하고 새 메시지와 변경된 state 필드만 delta로 반환합니다.
    """
    original_len = len(state.get("messages", []))
    result       = subgraph.invoke(state)

    all_msgs = result.get("messages", [])
    new_msgs = all_msgs[original_len:]

    delta: dict = {"messages": new_msgs}
    for key in (
        "bim_data", "sensor_data", "report_data", "wbs_data", "safe_data",
        "bim_undo_stack", "bim_snapshot", "intent",
    ):
        val = result.get(key)
        if val is not None:
            delta[key] = val
    return delta
