"""
LangGraph 그래프 정의

흐름:
  START → analyze → (route_by_intent) → rag_db               → END
                                       → bim_builder          → END
                                       → bim_query            → END
                                       → simulation_controller → END
                                       → chat                 → END
"""

from langgraph.graph import StateGraph, START, END
from state import AgentState
from nodes.analyzer import analyze_node, route_by_intent
from nodes.rag_db import rag_db_node
from nodes.bim_builder import bim_builder_node
from nodes.bim_query import bim_query_node
from nodes.chat import chat_node
from nodes.simulation_controller import simulation_controller_node


def build_graph():
    builder = StateGraph(AgentState)

    # 노드 등록
    builder.add_node("analyze",               analyze_node)               # Node 1: 프롬프트 분석
    builder.add_node("rag_db",                rag_db_node)                # Node 2: RAG + DB 조회
    builder.add_node("bim_builder",           bim_builder_node)           # Node 3: BIM 요소 생성/수정/삭제
    builder.add_node("bim_query",             bim_query_node)             # Node 4: BIM 프로젝트/부재 통계 조회
    builder.add_node("simulation_controller", simulation_controller_node) # Node 5: 굴착기 시뮬레이션 제어
    builder.add_node("chat",                  chat_node)                  # Node 6: 일반 대화

    # 엣지 연결
    builder.add_edge(START, "analyze")

    # 조건부 엣지: analyze → 각 노드
    builder.add_conditional_edges(
        "analyze",
        route_by_intent,
        {
            "rag_db":               "rag_db",
            "bim_builder":          "bim_builder",
            "bim_query":            "bim_query",
            "simulation_controller": "simulation_controller",
            "chat":                 "chat",
        },
    )

    builder.add_edge("rag_db",               END)
    builder.add_edge("bim_builder",          END)
    builder.add_edge("bim_query",            END)
    builder.add_edge("simulation_controller", END)
    builder.add_edge("chat",                 END)

    return builder.compile()


graph = build_graph()
