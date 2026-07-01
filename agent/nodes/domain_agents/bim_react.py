"""
BIM Domain Agent v2 — LLM Tool Calling (ReAct Pattern, 1단계)

변경 전: 키워드 정규식으로 tool 직접 호출
변경 후: LLM이 tool_calls 를 생성 → ToolNode 실행 → LLM 응답 (ReAct 루프)

특수 케이스 (Undo / Save / Restore)는 LLM 없이 사전 처리:
  - 상태(undo_stack, snapshot)에 직접 접근이 필요하고 LLM 판단이 불필요하기 때문
"""
from __future__ import annotations

import json
import logging
import re
import time as _time

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode

from config.state import AgentState
from config.llm_config import llm_responder
from config.lang_util import lang_instruction

logger = logging.getLogger(__name__)

# ── 특수 케이스 패턴 ──────────────────────────────────────────────────────────
_UNDO_PAT = re.compile(
    r"취소|되돌리|undo|ctrl.{0,3}z|이전\s*상태|되돌아"
    r"|取り消し|元に戻す|アンドゥ",
    re.I,
)
_SAVE_PAT = re.compile(
    r"저장|save|스냅샷|snapshot|백업|backup"
    r"|保存|スナップショット|バックアップ",
    re.I,
)
_RESTORE_PAT = re.compile(
    r"복원|restore|되돌려|저장\s*(상태|시점|된\s*상태)로"
    r"|復元|リストア|元の状態に",
    re.I,
)

# chart 갱신이 필요한 tool 이름들
_CHART_TOOLS = {
    "create_bim_element", "delete_bim_element", "create_composite_structure",
    "transform_bim_elements", "translate_bim_elements", "translate_selected_elements",
    "restore_bim_from_snapshot",
}

# undo 레코드를 추적할 tool 이름들
_UNDO_TRACKED = {
    "create_bim_element",
    "translate_bim_elements",
    "translate_selected_elements",
    "transform_bim_elements",
}

_LANG_MSGS = {
    "undo_none":    {"ko": "취소할 작업이 없습니다.", "en": "No actions to undo.", "ja": "取り消す操作がありません。"},
    "save_ok":      {"ko": "BIM 상태를 저장했습니다.", "en": "BIM state saved.", "ja": "BIM状態を保存しました。"},
    "save_fail":    {"ko": "저장에 실패했습니다.", "en": "Failed to save.", "ja": "保存に失敗しました。"},
    "restore_none": {"ko": "저장된 스냅샷이 없습니다. '저장해줘'로 먼저 저장하세요.",
                     "en": "No saved snapshot. Please save first.",
                     "ja": "保存されたスナップショットがありません。先に保存してください。"},
    "restore_ok":   {"ko": "저장된 BIM 상태로 복원했습니다.", "en": "Restored from saved snapshot.", "ja": "保存したBIM状態に復元しました。"},
    "restore_fail": {"ko": "복원에 실패했습니다.", "en": "Failed to restore.", "ja": "復元に失敗しました。"},
}


def _t(key: str, lang: str) -> str:
    return _LANG_MSGS[key].get(lang, _LANG_MSGS[key]["ko"])


# ── Tool 호출 래퍼 ─────────────────────────────────────────────────────────────
def _call(tool_fn, args: dict) -> dict:
    try:
        raw = tool_fn.invoke(args)
        return json.loads(raw) if isinstance(raw, str) else raw
    except Exception as e:
        logger.error("[bim_react] %s 실패 args=%s: %s", tool_fn.name, args, e)
        return {"success": False, "error": str(e)}


# ── Chart 데이터 갱신 ─────────────────────────────────────────────────────────
def _fetch_chart(proj_id: str) -> dict | None:
    try:
        from tools.bim_tools import get_bim_full_stats
        from nodes.domain_agents.bim import _fetch_stats_chart
        return _fetch_stats_chart(get_bim_full_stats, proj_id)
    except Exception:
        logger.error("[bim_react] chart fetch 실패", exc_info=True)
        return None


# ── Undo 레코드 추출 ──────────────────────────────────────────────────────────
def _extract_undo_records(messages: list) -> list[dict]:
    """이번 턴 메시지에서 undo 역연산 레코드를 생성합니다."""
    call_map: dict[str, dict] = {}
    for msg in messages:
        if hasattr(msg, "tool_calls"):
            for tc in (msg.tool_calls or []):
                call_map[tc["id"]] = {"name": tc["name"], "args": tc.get("args", {})}

    records = []
    now = _time.time()

    for msg in messages:
        if not isinstance(msg, ToolMessage):
            continue
        tc = call_map.get(msg.tool_call_id, {})
        name = tc.get("name", "")
        if name not in _UNDO_TRACKED:
            continue
        try:
            result = json.loads(msg.content) if isinstance(msg.content, str) else {}
        except Exception:
            continue
        if not result.get("success"):
            continue

        args = tc.get("args", {})

        if name == "create_bim_element":
            eid = result.get("elementId", "")
            if eid:
                records.append({
                    "desc": f"부재 생성 {eid}",
                    "inverse_tool": "delete_bim_element",
                    "inverse_args": {"element_id": str(eid)},
                    "ts": now,
                })

        elif name == "translate_bim_elements":
            dx = float(args.get("delta_x", 0))
            dy = float(args.get("delta_y", 0))
            dz = float(args.get("delta_z", 0))
            records.append({
                "desc": f"전체 이동 (ΔX={dx},ΔY={dy},ΔZ={dz})",
                "inverse_tool": "translate_bim_elements",
                "inverse_args": {
                    "project_id": args.get("project_id"),
                    "delta_x": -dx, "delta_y": -dy, "delta_z": -dz,
                },
                "ts": now,
            })

        elif name == "translate_selected_elements":
            dx = float(args.get("delta_x", 0))
            dy = float(args.get("delta_y", 0))
            dz = float(args.get("delta_z", 0))
            records.append({
                "desc": f"선택 이동 (ΔX={dx},ΔY={dy},ΔZ={dz})",
                "inverse_tool": "translate_selected_elements",
                "inverse_args": {
                    "project_id": args.get("project_id"),
                    "element_ids": args.get("element_ids", []),
                    "delta_x": -dx, "delta_y": -dy, "delta_z": -dz,
                },
                "ts": now,
            })

        elif name == "transform_bim_elements":
            drx = float(args.get("delta_rot_x", 0))
            dry = float(args.get("delta_rot_y", 0))
            drz = float(args.get("delta_rot_z", 0))
            sx  = float(args.get("scale_x", 1))
            sy  = float(args.get("scale_y", 1))
            sz  = float(args.get("scale_z", 1))
            records.append({
                "desc": f"변환 (회전 ΔZ={drz}°, 크기 ×{sx})",
                "inverse_tool": "transform_bim_elements",
                "inverse_args": {
                    "project_id":  args.get("project_id"),
                    "element_ids": args.get("element_ids"),
                    "delta_rot_x": -drx, "delta_rot_y": -dry, "delta_rot_z": -drz,
                    "scale_x": round(1 / sx, 4) if sx not in (0, 1) else 1.0,
                    "scale_y": round(1 / sy, 4) if sy not in (0, 1) else 1.0,
                    "scale_z": round(1 / sz, 4) if sz not in (0, 1) else 1.0,
                },
                "ts": now,
            })

    return records


# ── 특수 케이스 핸들러 (LLM 없이 직접 처리) ───────────────────────────────────
def _handle_undo(state: AgentState) -> dict:
    from tools.bim_tools import (
        transform_bim_elements, translate_bim_elements,
        translate_selected_elements, delete_bim_element,
    )
    _TOOL_MAP = {
        "transform_bim_elements":      transform_bim_elements,
        "translate_bim_elements":      translate_bim_elements,
        "translate_selected_elements": translate_selected_elements,
        "delete_bim_element":          delete_bim_element,
    }

    messages   = state.get("messages", [])
    text       = messages[-1].content if messages else ""
    lang       = state.get("lang", "ko")
    undo_stack = list(state.get("bim_undo_stack") or [])
    proj_id    = str(state.get("bim_project_id") or "1")

    n_m = re.search(r'(\d+)\s*번', text)
    n   = min(int(n_m.group(1)) if n_m else 1, len(undo_stack))

    if n == 0:
        return {"messages": [AIMessage(content=_t("undo_none", lang))]}

    undone       = []
    needs_chart  = False
    for _ in range(n):
        rec     = undo_stack.pop()
        tool_fn = _TOOL_MAP.get(rec.get("inverse_tool", ""))
        if tool_fn:
            res = _call(tool_fn, rec.get("inverse_args", {}))
            undone.append({"desc": rec.get("desc", ""), "success": res.get("success", False)})
            if res.get("success"):
                needs_chart = True
        else:
            undone.append({"desc": rec.get("desc", ""), "success": False})

    ok   = sum(1 for u in undone if u["success"])
    msgs = {
        "ko": f"{ok}개 작업을 취소했습니다.",
        "en": f"Undone {ok} action(s).",
        "ja": f"{ok}件の操作を取り消しました。",
    }
    out: dict = {
        "messages":       [AIMessage(content=msgs.get(lang, msgs["ko"]))],
        "bim_undo_stack": undo_stack,
    }
    if needs_chart:
        chart = _fetch_chart(proj_id)
        if chart:
            out["bim_data"] = chart
    return out


def _handle_save(state: AgentState) -> dict:
    from tools.bim_tools import snapshot_bim_project
    proj_id = str(state.get("bim_project_id") or "1")
    lang    = state.get("lang", "ko")

    result = _call(snapshot_bim_project, {"project_id": proj_id})
    if result.get("success"):
        new_snap = result.get("elements")
        cnt      = len(new_snap or [])
        msgs = {
            "ko": f"{_t('save_ok', 'ko')} ({cnt}개 부재)",
            "en": f"{_t('save_ok', 'en')} ({cnt} elements)",
            "ja": f"{_t('save_ok', 'ja')} ({cnt}件の部材)",
        }
        return {
            "messages":     [AIMessage(content=msgs.get(lang, msgs["ko"]))],
            "bim_snapshot": new_snap,
        }
    return {"messages": [AIMessage(content=_t("save_fail", lang))]}


def _handle_restore(state: AgentState) -> dict:
    from tools.bim_tools import restore_bim_from_snapshot
    proj_id  = str(state.get("bim_project_id") or "1")
    lang     = state.get("lang", "ko")
    bim_snap = state.get("bim_snapshot")

    if not bim_snap:
        return {"messages": [AIMessage(content=_t("restore_none", lang))]}

    result = _call(restore_bim_from_snapshot, {"project_id": proj_id, "elements": bim_snap})
    out: dict = {
        "messages": [AIMessage(content=_t(
            "restore_ok" if result.get("success") else "restore_fail", lang
        ))]
    }
    if result.get("success"):
        chart = _fetch_chart(proj_id)
        if chart:
            out["bim_data"] = chart
    return out


# ── ReAct 서브그래프 ──────────────────────────────────────────────────────────
def _build_system(state: AgentState) -> str:
    proj_id    = state.get("bim_project_id", "1")
    lang       = state.get("lang", "ko")
    sel_ids    = state.get("selected_element_ids") or []
    undo_count = len(state.get("bim_undo_stack") or [])
    has_snap   = bool(state.get("bim_snapshot"))
    rag_ctx    = state.get("rag_context") or ""

    lines = [
        "당신은 BIM(Building Information Modeling) 전문 AI입니다.",
        f"현재 project_id: {proj_id}  — 모든 BIM tool 호출 시 반드시 이 값을 사용하세요.",
        f"현재 선택된 부재 IDs: {sel_ids if sel_ids else '없음'}",
        f"실행 취소 가능 작업 수: {undo_count}",
        f"저장된 스냅샷: {'있음' if has_snap else '없음'}",
    ]
    if rag_ctx:
        lines.append(f"\n관련 문서:\n{rag_ctx}")
    note = lang_instruction(lang)
    if note:
        lines.append(note)
    return "\n".join(lines)


def _make_subgraph():
    from tools.bim_tools import (
        list_bim_projects, get_bim_stats, get_bim_full_stats,
        create_bim_element, delete_bim_element, create_bim_project, create_composite_structure,
        transform_bim_elements, translate_bim_elements, translate_selected_elements,
        list_bim_layers, create_bim_layer, set_bim_layer_visibility,
        assign_elements_to_layer, delete_bim_layer,
        snapshot_bim_project, restore_bim_from_snapshot,
        get_drone_analysis_info, get_structural_analysis, get_ifc_import_guide,
    )

    _tools = [
        list_bim_projects, get_bim_stats, get_bim_full_stats,
        create_bim_element, delete_bim_element, create_bim_project, create_composite_structure,
        transform_bim_elements, translate_bim_elements, translate_selected_elements,
        list_bim_layers, create_bim_layer, set_bim_layer_visibility,
        assign_elements_to_layer, delete_bim_layer,
        snapshot_bim_project, restore_bim_from_snapshot,
        get_drone_analysis_info, get_structural_analysis, get_ifc_import_guide,
    ]

    _llm       = llm_responder.bind_tools(_tools)
    _tool_node = ToolNode(_tools)

    def agent_node(state: AgentState) -> dict:
        system   = SystemMessage(content=_build_system(state))
        response = _llm.invoke([system] + state["messages"])
        return {"messages": [response]}

    def _route(state: AgentState) -> str:
        last = state["messages"][-1]
        if hasattr(last, "tool_calls") and last.tool_calls:
            return "tools"
        return "finalize"

    def finalize_node(state: AgentState) -> dict:
        """tool 실행 결과에서 undo 레코드, chart data, snapshot 을 추출해 state 를 갱신합니다."""
        messages = state.get("messages", [])
        proj_id  = str(state.get("bim_project_id") or "1")

        # 이번 턴(마지막 HumanMessage 이후)의 메시지만 처리
        last_human = max(
            (i for i, m in enumerate(messages) if isinstance(m, HumanMessage)),
            default=0,
        )
        new_msgs = messages[last_human:]

        # tool_call_id → tool 이름 매핑
        call_map: dict[str, str] = {}
        for msg in new_msgs:
            if hasattr(msg, "tool_calls"):
                for tc in (msg.tool_calls or []):
                    call_map[tc["id"]] = tc["name"]

        # snapshot 갱신
        new_snap = state.get("bim_snapshot")
        for msg in new_msgs:
            if isinstance(msg, ToolMessage) and call_map.get(msg.tool_call_id) == "snapshot_bim_project":
                try:
                    r = json.loads(msg.content) if isinstance(msg.content, str) else {}
                    if r.get("success") and r.get("elements"):
                        new_snap = r["elements"]
                except Exception:
                    pass

        # undo 레코드 추출 및 스택 갱신
        new_records = _extract_undo_records(new_msgs)
        undo_stack  = list(state.get("bim_undo_stack") or [])
        undo_stack.extend(new_records)
        undo_stack  = undo_stack[-50:]

        # chart 갱신 필요 여부 확인
        needs_chart = any(
            call_map.get(m.tool_call_id) in _CHART_TOOLS
            for m in new_msgs
            if isinstance(m, ToolMessage)
        )
        bim_data = _fetch_chart(proj_id) if needs_chart else None

        out: dict = {"bim_undo_stack": undo_stack}
        if new_snap != state.get("bim_snapshot"):
            out["bim_snapshot"] = new_snap
        if bim_data:
            out["bim_data"] = bim_data
        return out

    sg = StateGraph(AgentState)
    sg.add_node("agent",    agent_node)
    sg.add_node("tools",    _tool_node)
    sg.add_node("finalize", finalize_node)
    sg.set_entry_point("agent")
    sg.add_conditional_edges("agent", _route, {"tools": "tools", "finalize": "finalize"})
    sg.add_edge("tools",    "agent")
    sg.add_edge("finalize", END)
    return sg.compile()


_bim_subgraph = _make_subgraph()


# ── 메인 진입점 ───────────────────────────────────────────────────────────────
def run_bim_react_agent(state: AgentState) -> dict:
    logger.info("[NODE] ▶ bim_react_agent 진입")
    messages = state.get("messages", [])
    text     = messages[-1].content if messages and hasattr(messages[-1], "content") else ""

    # 특수 케이스: LLM 없이 직접 처리
    if _UNDO_PAT.search(text):
        logger.info("[bim_react] → undo 직접 처리")
        return _handle_undo(state)
    if _SAVE_PAT.search(text) and not _RESTORE_PAT.search(text):
        logger.info("[bim_react] → save 직접 처리")
        return _handle_save(state)
    if _RESTORE_PAT.search(text):
        logger.info("[bim_react] → restore 직접 처리")
        return _handle_restore(state)

    # 일반 쿼리: LLM tool calling (ReAct 루프)
    logger.info("[bim_react] → LLM tool calling 진입")
    original_len = len(messages)
    result       = _bim_subgraph.invoke(state)

    # 서브그래프가 추가한 메시지만 delta로 반환 (중복 방지)
    all_msgs  = result.get("messages", [])
    new_msgs  = all_msgs[original_len:]

    delta: dict = {"messages": new_msgs}
    for key in ("bim_data", "bim_undo_stack", "bim_snapshot"):
        val = result.get(key)
        if val is not None:
            delta[key] = val
    return delta
