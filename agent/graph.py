"""
LangGraph graph definition

Flow:
  START → analyze → (route_by_intent) → rag_db               → END
                                       → bim_builder          → END
                                       → bim_query            → END
                                       → simulation_controller → END
                                       → tab_guide            → END
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
from nodes.tab_guide import tab_guide_node


def build_graph():
    builder = StateGraph(AgentState)

    builder.add_node("analyze",               analyze_node)               # Node 1: prompt analysis
    builder.add_node("rag_db",                rag_db_node)                # Node 2: RAG + DB query
    builder.add_node("bim_builder",           bim_builder_node)           # Node 3: BIM element create/edit/delete
    builder.add_node("bim_query",             bim_query_node)             # Node 4: BIM project/element stats query
    builder.add_node("simulation_controller", simulation_controller_node) # Node 5: excavator simulation control
    builder.add_node("tab_guide",             tab_guide_node)             # Node 6: dashboard tab info & usage guide
    builder.add_node("chat",                  chat_node)                  # Node 7: general conversation

    builder.add_edge(START, "analyze")

    # Conditional edge: analyze → each node
    builder.add_conditional_edges(
        "analyze",
        route_by_intent,
        {
            "rag_db":                "rag_db",
            "bim_builder":           "bim_builder",
            "bim_query":             "bim_query",
            "simulation_controller": "simulation_controller",
            "tab_guide":             "tab_guide",
            "chat":                  "chat",
        },
    )

    builder.add_edge("rag_db",               END)
    builder.add_edge("bim_builder",          END)
    builder.add_edge("bim_query",            END)
    builder.add_edge("simulation_controller", END)
    builder.add_edge("tab_guide",            END)
    builder.add_edge("chat",                 END)

    return builder.compile()


graph = build_graph()
