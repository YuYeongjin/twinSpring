"""
Supervisor 기반 LangGraph 워크플로우

흐름:
  START
    → router_node   (llama3.2:1b — 도메인 분류, need_rag 판단)
    → [need_rag=True] rag_node (Shared RAG 검색)
    → domain_agent_node (LLM 없음, tool 직접 호출)
    → responder_node (qwen2.5:3b — 최종 자연어 응답 생성)
    → END

  chat 도메인은 domain_agent 없이 responder_node 로 직행합니다.
"""
from __future__ import annotations

import logging

from langgraph.graph import StateGraph, START, END

from config.state    import AgentState

logger = logging.getLogger(__name__)
from nodes.router    import router_node
from nodes.rag       import rag_node
from nodes.responder import responder_node
from nodes.domain_agents import (
    run_bim_agent, run_sensor_agent, run_simulation_agent,
    run_safe_agent, run_wbs_agent, run_test_agent, run_orchestrator_agent,
    run_bim_wbs_agent,
)
from nodes.tab_guide import tab_guide_node

# chat 도메인은 responder_node 가 직접 처리
_DOMAIN_TO_NODE: dict[str, str] = {
    "bim":          "bim_agent",
    "sensor":       "sensor_agent",
    "simulation":   "simulation_agent",
    "safe":         "safe_agent",
    "wbs":          "wbs_agent",
    "test":         "test_agent",
    "orchestrator": "orchestrator",
    "tab_guide":    "tab_guide",
    "bim_wbs":      "bim_wbs_agent",
}


def _after_router(state: AgentState) -> str:
    """router → RAG 또는 domain agent 또는 responder(chat)."""
    if state.get("need_rag"):
        logger.info("[GRAPH] router → rag_node (need_rag=True, domain=%s)", state.get("domain"))
        return "rag_node"
    domain = state.get("domain", "chat")
    next_node = _DOMAIN_TO_NODE.get(domain, "responder_node")
    logger.info("[GRAPH] router → %s", next_node)
    return next_node


def _after_rag(state: AgentState) -> str:
    """rag → domain agent 또는 responder(chat)."""
    domain = state.get("domain", "chat")
    next_node = _DOMAIN_TO_NODE.get(domain, "responder_node")
    logger.info("[GRAPH] rag → %s", next_node)
    return next_node


def build_graph():
    builder = StateGraph(AgentState)

    # ── 노드 등록 ──────────────────────────────────────────────────────────────
    builder.add_node("router_node",      router_node)
    builder.add_node("rag_node",         rag_node)
    builder.add_node("bim_agent",        run_bim_agent)
    builder.add_node("sensor_agent",     run_sensor_agent)
    builder.add_node("simulation_agent", run_simulation_agent)
    builder.add_node("safe_agent",       run_safe_agent)
    builder.add_node("wbs_agent",        run_wbs_agent)
    builder.add_node("test_agent",       run_test_agent)
    builder.add_node("orchestrator",     run_orchestrator_agent)
    builder.add_node("tab_guide",        tab_guide_node)
    builder.add_node("bim_wbs_agent",    run_bim_wbs_agent)
    builder.add_node("responder_node",   responder_node)

    # ── 엣지 ──────────────────────────────────────────────────────────────────
    builder.add_edge(START, "router_node")

    # router → rag or domain or responder
    _router_targets = {
        "rag_node":        "rag_node",
        "bim_agent":       "bim_agent",
        "sensor_agent":    "sensor_agent",
        "simulation_agent":"simulation_agent",
        "safe_agent":      "safe_agent",
        "wbs_agent":       "wbs_agent",
        "test_agent":      "test_agent",
        "orchestrator":    "orchestrator",
        "tab_guide":       "tab_guide",
        "bim_wbs_agent":   "bim_wbs_agent",
        "responder_node":  "responder_node",  # chat
    }
    builder.add_conditional_edges("router_node", _after_router, _router_targets)

    # rag → domain or responder
    _rag_targets = {k: v for k, v in _router_targets.items() if k != "rag_node"}
    builder.add_conditional_edges("rag_node", _after_rag, _rag_targets)

    # domain agents → responder
    for node in ("bim_agent", "sensor_agent", "simulation_agent",
                 "safe_agent", "wbs_agent", "test_agent", "orchestrator", "tab_guide",
                 "bim_wbs_agent"):
        builder.add_edge(node, "responder_node")

    builder.add_edge("responder_node", END)

    return builder.compile()


graph = build_graph()
