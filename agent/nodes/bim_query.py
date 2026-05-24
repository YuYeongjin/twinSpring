"""
Node: BIM Query node

Dedicated node for querying BIM project lists, element statistics, and element composition.
- LLM summarizes results in English
- Returns structured JSON in bim_data field for frontend charts/tables
"""

import re
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from state import AgentState
from llm_config import llm_chat
from tools.db_tool import (
    query_bim_projects,
    query_bim_element_stats,
    query_bim_total_count,
)
from lang_util import detect_lang, lang_instruction

# Base system prompt — language instruction is appended dynamically per request
_SYSTEM_BASE = (
    "You are a BIM data analysis assistant. "
    "Answer clearly and specifically based on the provided BIM data. "
    "Include numerical values such as element counts, types, and ratios. "
    "Use markdown tables when appropriate."
)

# Project ID mention pattern
_PROJECT_ID_PAT = re.compile(r"[a-f0-9\-]{8,}", re.I)

# Element type English mapping
_TYPE_EN = {
    "IfcColumn": "Column",
    "IfcBeam":   "Beam",
    "IfcWall":   "Wall",
    "IfcSlab":   "Slab",
    "IfcPier":   "Pier",
}


def _rows_to_table(rows: list[dict]) -> str:
    if not rows:
        return "(no data)"
    headers = list(rows[0].keys())
    lines = ["| " + " | ".join(headers) + " |",
             "| " + " | ".join(["---"] * len(headers)) + " |"]
    for row in rows:
        lines.append("| " + " | ".join(str(v) for v in row.values()) + " |")
    return "\n".join(lines)


def bim_query_node(state: AgentState) -> dict:
    last_message = state["messages"][-1]
    user_text = last_message.content if hasattr(last_message, "content") else str(last_message)
    project_id = state.get("bim_project_id")

    # Build language-aware system message
    recent_text = " ".join(
        msg.content for msg in state["messages"][-5:]
        if hasattr(msg, "content")
    )
    lang = detect_lang(recent_text)
    note = lang_instruction(lang)
    system_content = _SYSTEM_BASE + (" " + note if note else "")
    _SYSTEM = SystemMessage(content=system_content)

    bim_data: dict = {}
    context_parts = []

    # 1. Query project list
    projects = query_bim_projects()
    bim_data["projects"] = projects
    context_parts.append(f"[BIM Project List]\n{_rows_to_table(projects)}")

    # 2. Query specific project statistics
    target_id = project_id
    if not target_id:
        # Map by project name from user message
        for p in projects:
            name = (p.get("projectName") or "").lower()
            pid = p.get("projectId") or ""
            if name and name in user_text.lower():
                target_id = pid
                break
        if not target_id and projects:
            # Auto-select if only one project exists and none specified
            if len(projects) == 1:
                target_id = projects[0].get("projectId")

    if target_id:
        stats = query_bim_element_stats(target_id)
        total = query_bim_total_count(target_id)
        bim_data["stats"] = stats
        bim_data["total"] = total
        bim_data["targetProjectId"] = target_id

        # Add English element type names
        for s in stats:
            s["elementTypeEn"] = _TYPE_EN.get(s.get("elementType", ""), s.get("elementType", ""))

        proj_name = next(
            (p.get("projectName") for p in projects if p.get("projectId") == target_id),
            target_id,
        )
        context_parts.append(
            f"[{proj_name} Element Stats — Total: {total}]\n{_rows_to_table(stats)}"
        )

    combined = "\n\n".join(context_parts)

    try:
        response = llm_chat.invoke([
            _SYSTEM,
            HumanMessage(content=f"{combined}\n\nQuestion: {user_text}"),
        ])
        content = response.content.strip()
    except Exception as e:
        content = f"An error occurred while generating a response after BIM data query: {e}"

    return {
        "messages": [AIMessage(content=content)],
        "query_result": combined,
        "bim_data": bim_data,
    }
