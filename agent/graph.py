"""
LangGraph Multi-Agent 그래프 정의 (AtoA 구조)

흐름:
  START → supervisor → (route_by_next_agent)
            ├─ sensor_agent      → END
            ├─ bim_agent         → END
            ├─ simulation_agent  → END
            ├─ safe_agent        → END
            ├─ test_agent        → END
            ├─ rag_agent         → END  ← 건설 공정서·시방서 검색
            ├─ wbs_agent         → END  ← WBS 현장 프로젝트·공정 관리
            ├─ tab_guide         → END
            └─ chat              → END

각 전문 에이전트는 create_react_agent(ReAct 루프)로 동작하며
도구를 자율적으로 선택·호출합니다.
"""

from langgraph.graph import StateGraph, START, END

from config.state import AgentState
from nodes.supervisor import supervisor_node, route_by_next_agent

# ── 전문 에이전트 ──────────────────────────────────────────────────────────────
from agents.sensor_agent import run_sensor_agent
from agents.bim_agent import run_bim_agent
from agents.simulation_agent import run_simulation_agent
from agents.safe_agent import run_safe_agent
from agents.test_agent import run_test_agent
from agents.rag_agent import run_rag_agent          # 건설 공정서·시방서 RAG
from agents.wbs_agent import run_wbs_agent          # WBS 현장 프로젝트·공정 관리

# ── 레거시 노드 (tab_guide · chat 은 기존 구현 유지) ─────────────────────────
from nodes.tab_guide import tab_guide_node
from nodes.chat import chat_node


def build_graph():
    builder = StateGraph(AgentState)

    # ── 노드 등록 ──────────────────────────────────────────────────────────────
    builder.add_node("supervisor",        supervisor_node)      # 라우팅 판단
    builder.add_node("sensor_agent",      run_sensor_agent)     # 온습도 센서
    builder.add_node("bim_agent",         run_bim_agent)        # BIM 전문 에이전트
    builder.add_node("simulation_agent",  run_simulation_agent) # 굴착기 시뮬레이션
    builder.add_node("safe_agent",        run_safe_agent)       # 안전 모니터링
    builder.add_node("test_agent",        run_test_agent)       # 충돌 테스트 탭
    builder.add_node("rag_agent",         run_rag_agent)        # 건설 공정서·시방서
    builder.add_node("wbs_agent",         run_wbs_agent)        # WBS 현장 프로젝트·공정
    builder.add_node("tab_guide",         tab_guide_node)       # 일반 탭 안내
    builder.add_node("chat",              chat_node)            # 일반 대화

    # ── 엣지 정의 ──────────────────────────────────────────────────────────────
    builder.add_edge(START, "supervisor")

    # supervisor → 전문 에이전트 (조건부 라우팅)
    builder.add_conditional_edges(
        "supervisor",
        route_by_next_agent,
        {
            "sensor_agent":     "sensor_agent",
            "bim_agent":        "bim_agent",
            "simulation_agent": "simulation_agent",
            "safe_agent":       "safe_agent",
            "test_agent":       "test_agent",
            "rag_agent":        "rag_agent",
            "wbs_agent":        "wbs_agent",
            "tab_guide":        "tab_guide",
            "chat":             "chat",
        },
    )

    # 각 에이전트 → END
    builder.add_edge("sensor_agent",     END)
    builder.add_edge("bim_agent",        END)
    builder.add_edge("simulation_agent", END)
    builder.add_edge("safe_agent",       END)
    builder.add_edge("test_agent",       END)
    builder.add_edge("rag_agent",        END)
    builder.add_edge("wbs_agent",        END)
    builder.add_edge("tab_guide",        END)
    builder.add_edge("chat",             END)

    return builder.compile()


graph = build_graph()
