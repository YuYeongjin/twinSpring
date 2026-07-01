"""
Supervisor 기반 LangGraph 워크플로우 v2 — 전 도메인 LLM Tool Calling

흐름:
  START
    → router_node   (llama3.2:1b — 도메인 분류, need_rag 판단)
    → [need_rag=True] rag_node (Shared RAG 검색)
    → domain_react_agent  (각 도메인별 ReAct 서브그래프 — LLM 직접 응답)
    → END

  chat 도메인은 domain_agent 없이 responder_node 로 직행합니다.
  tab_guide 는 별도 처리 후 responder_node 경유합니다.
"""
from __future__ import annotations

import logging

from langgraph.graph import StateGraph, START, END

from config.state    import AgentState
from nodes.router    import router_node
from nodes.rag       import rag_node
from nodes.responder import responder_node
from nodes.tab_guide import tab_guide_node
from nodes.domain_agents import (
    # v2 — LLM Tool Calling
    run_bim_react_agent,
    run_sensor_react_agent,
    run_simulation_react_agent,
    run_safe_react_agent,
    run_wbs_react_agent,
    run_test_react_agent,
    run_orchestrator_react_agent,
    run_bim_wbs_react_agent,
)

logger = logging.getLogger(__name__)


# ── Checkpointer 초기화 (PostgreSQL → MemorySaver 폴백) ───────────────────────
def _create_checkpointer():
    try:
        import psycopg
        from langgraph.checkpoint.postgres import PostgresSaver
        from config.settings import (
            VECTOR_DB_HOST, VECTOR_DB_PORT, VECTOR_DB_NAME,
            VECTOR_DB_USER, VECTOR_DB_PASSWORD,
        )
        conn = psycopg.connect(
            f"host={VECTOR_DB_HOST} port={VECTOR_DB_PORT} "
            f"dbname={VECTOR_DB_NAME} user={VECTOR_DB_USER} "
            f"password={VECTOR_DB_PASSWORD}",
            autocommit=True,
        )
        cp = PostgresSaver(conn)
        cp.setup()   # 체크포인트 테이블 자동 생성
        logger.info("[GRAPH] PostgreSQL Checkpointer 초기화 완료")
        return cp
    except Exception as e:
        logger.warning("[GRAPH] PostgreSQL Checkpointer 실패, MemorySaver 사용: %s", e)
        from langgraph.checkpoint.memory import MemorySaver
        return MemorySaver()


checkpointer = _create_checkpointer()

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

# ReAct 에이전트 — responder 없이 직접 END
_REACT_NODES = {
    "bim_agent", "sensor_agent", "simulation_agent", "safe_agent",
    "wbs_agent", "test_agent", "orchestrator", "bim_wbs_agent",
}


def _after_router(state: AgentState) -> str:
    if state.get("need_rag"):
        logger.info("[GRAPH] router → rag_node (domain=%s)", state.get("domain"))
        return "rag_node"
    domain    = state.get("domain", "chat")
    next_node = _DOMAIN_TO_NODE.get(domain, "responder_node")
    logger.info("[GRAPH] router → %s", next_node)
    return next_node


def _after_rag(state: AgentState) -> str:
    domain    = state.get("domain", "chat")
    next_node = _DOMAIN_TO_NODE.get(domain, "responder_node")
    logger.info("[GRAPH] rag → %s", next_node)
    return next_node


def build_graph():
    builder = StateGraph(AgentState)

    # ── 노드 등록 ──────────────────────────────────────────────────────────────
    builder.add_node("router_node",      router_node)
    builder.add_node("rag_node",         rag_node)
    builder.add_node("responder_node",   responder_node)    # chat 전용
    builder.add_node("tab_guide",        tab_guide_node)    # tab_guide → responder 유지

    # v2 ReAct 도메인 에이전트
    builder.add_node("bim_agent",        run_bim_react_agent)
    builder.add_node("sensor_agent",     run_sensor_react_agent)
    builder.add_node("simulation_agent", run_simulation_react_agent)
    builder.add_node("safe_agent",       run_safe_react_agent)
    builder.add_node("wbs_agent",        run_wbs_react_agent)
    builder.add_node("test_agent",       run_test_react_agent)
    builder.add_node("orchestrator",     run_orchestrator_react_agent)
    builder.add_node("bim_wbs_agent",    run_bim_wbs_react_agent)

    # ── 엣지 ──────────────────────────────────────────────────────────────────
    builder.add_edge(START, "router_node")

    _all_targets = {
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
    builder.add_conditional_edges("router_node", _after_router, _all_targets)

    _rag_targets = {k: v for k, v in _all_targets.items() if k != "rag_node"}
    builder.add_conditional_edges("rag_node", _after_rag, _rag_targets)

    # ReAct 에이전트: LLM이 직접 응답 생성 → END
    for node in _REACT_NODES:
        builder.add_edge(node, END)

    # tab_guide 는 responder 경유 유지 (UI 안내 특성상 별도 포맷 필요)
    builder.add_edge("tab_guide",      "responder_node")
    builder.add_edge("responder_node", END)

    return builder.compile(checkpointer=checkpointer)


graph = build_graph()
