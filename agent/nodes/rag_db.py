"""
Node 2: RAG + Database query node (Ollama - gemma3:12b)
"""

import re
from datetime import datetime
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from state import AgentState
from llm_config import llm_chat
from tools.db_tool import (
    query_sensor_data,
)
from tools.rag_tool import search_as_text
from lang_util import detect_lang, lang_instruction

_KEYWORDS = {
    "sensor":    re.compile(r"센서|온도|습도|dht|sensor|temperature|humidity", re.I),
    "alert":     re.compile(r"알림|경보|alert|alarm|경고|위험|critical|warning", re.I),
    "threshold": re.compile(r"임계|threshold|기준값|설정값", re.I),
}

# Base system prompt — language instruction is appended dynamically per request
_SYSTEM_BASE = (
    "You are a Smart Building Digital Twin assistant. "
    "Answer clearly and specifically based on the provided data. "
    "Include numerical values in your answers."
)


def _detect_targets(text: str) -> list[str]:
    targets = [k for k, pat in _KEYWORDS.items() if pat.search(text)]
    return targets or ["sensor"]


def _fmt_time(val) -> str:
    """Convert timestamp to 'HH:MM' string (handles both datetime and str)"""
    if val is None:
        return ""
    if isinstance(val, datetime):
        return val.strftime("%H:%M")
    try:
        return datetime.fromisoformat(str(val)).strftime("%H:%M")
    except Exception:
        return str(val)[:16]


def _fetch_db_context(targets: list[str]) -> tuple[str, dict]:
    """Return DB query result as (text context, structured dict)"""
    parts = []
    structured: dict = {}

    if "sensor" in targets:
        try:
            rows = query_sensor_data(limit=20)
        except Exception as e:
            rows = []
            parts.append(f"[Sensor] DB unavailable: {e}")

        if rows:
            parts.append(f"[Sensor]\n{_rows_to_text(rows)}")
            structured["sensor"] = [
                {
                    "time": _fmt_time(r.get("timestamp")),
                    "temperature": _safe_float(r.get("temperature") or r.get("temp")),
                    "humidity": _safe_float(r.get("humidity")),
                }
                for r in reversed(rows)   # oldest first
            ]
            latest = rows[0]
            structured["latest"] = {
                "temperature": _safe_float(latest.get("temperature") or latest.get("temp")),
                "humidity": _safe_float(latest.get("humidity")),
                "timestamp": _fmt_time(latest.get("timestamp")),
            }
        elif not parts:
            parts.append("[Sensor] No sensor data found in DB.")

    context_text = "\n\n".join(parts) if parts else "No data found."
    return context_text, structured


def _rows_to_text(rows: list[dict]) -> str:
    if not rows:
        return "empty"
    headers = list(rows[0].keys())
    lines = [" | ".join(headers)]
    for row in rows:
        lines.append(" | ".join(str(v) for v in row.values()))
    return "\n".join(lines)


def _safe_float(val) -> float | None:
    if val is None:
        return None
    try:
        return round(float(val), 2)
    except (TypeError, ValueError):
        return None


def rag_db_node(state: AgentState) -> dict:
    last_message = state["messages"][-1]
    user_text = last_message.content if hasattr(last_message, "content") else str(last_message)

    # Detect language from recent context for robustness
    recent_text = " ".join(
        msg.content for msg in state["messages"][-5:]
        if hasattr(msg, "content")
    )
    lang = detect_lang(recent_text)
    note = lang_instruction(lang)
    system_content = _SYSTEM_BASE + (" " + note if note else "")
    system = SystemMessage(content=system_content)

    # 1. DB query (text + structured data)
    targets = _detect_targets(user_text)
    db_context, sensor_data = _fetch_db_context(targets)

    # 2. RAG search
    rag_context = search_as_text(user_text, k=3)

    # 3. Combine context
    combined = f"Data:\n{db_context}\n\nDocs:\n{rag_context}"

    try:
        response = llm_chat.invoke([
            system,
            HumanMessage(content=f"{combined}\n\nQuestion: {user_text}"),
        ])
        content = response.content.strip()
    except Exception as e:
        content = f"An error occurred while generating a response after data query: {e}"

    return {
        "messages": [AIMessage(content=content)],
        "query_result": db_context,
        "context": rag_context,
        "sensor_data": sensor_data,
    }
