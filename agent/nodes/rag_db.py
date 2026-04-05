"""
Node 2: RAG + Database 조회 노드 (Ollama - gemma3:12b)
"""

import re
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from state import AgentState
from llm_config import llm_chat
from tools.db_tool import (
    query_sensor_data,
    query_energy_data,
    query_ems_alerts,
    query_ems_thresholds,
)
from tools.rag_tool import search_as_text

_KEYWORDS = {
    "sensor":    re.compile(r"센서|온도|습도|dht|sensor|temperature|humidity", re.I),
    "energy":    re.compile(r"에너지|전력|전압|전류|kwh|kw|energy|power|voltage", re.I),
    "alert":     re.compile(r"알림|경보|alert|alarm|경고|위험|critical|warning", re.I),
    "threshold": re.compile(r"임계|threshold|기준값|설정값", re.I),
}

_SYSTEM = SystemMessage(content=(
    "당신은 스마트 빌딩 디지털 트윈 어시스턴트입니다. "
    "제공된 데이터를 바탕으로 한국어로 명확하고 구체적으로 답변하세요. "
    "수치 데이터를 포함하여 답변하세요."
))


def _detect_targets(text: str) -> list[str]:
    targets = [k for k, pat in _KEYWORDS.items() if pat.search(text)]
    return targets or ["sensor", "energy"]


def _fetch_db_context(targets: list[str]) -> str:
    parts = []
    if "sensor" in targets:
        rows = query_sensor_data(limit=5)
        parts.append(f"[Sensor]\n{_rows_to_text(rows)}")
    if "energy" in targets:
        rows = query_energy_data(limit=5)
        parts.append(f"[Energy]\n{_rows_to_text(rows)}")
    if "alert" in targets:
        rows = query_ems_alerts(limit=5)
        parts.append(f"[Alerts]\n{_rows_to_text(rows)}")
    if "threshold" in targets:
        rows = query_ems_thresholds()
        parts.append(f"[Thresholds]\n{_rows_to_text(rows)}")
    return "\n\n".join(parts) if parts else "No data found."


def _rows_to_text(rows: list[dict]) -> str:
    if not rows:
        return "empty"
    headers = list(rows[0].keys())
    lines = [" | ".join(headers)]
    for row in rows:
        lines.append(" | ".join(str(v) for v in row.values()))
    return "\n".join(lines)


def rag_db_node(state: AgentState) -> dict:
    last_message = state["messages"][-1]
    user_text = last_message.content if hasattr(last_message, "content") else str(last_message)

    # 1. DB 조회
    targets = _detect_targets(user_text)
    db_context = _fetch_db_context(targets)

    # 2. RAG 검색
    rag_context = search_as_text(user_text, k=3)

    # 3. 컨텍스트를 간결하게 조합
    combined = f"Data:\n{db_context}\n\nDocs:\n{rag_context}"

    try:
        response = llm_chat.invoke([
            _SYSTEM,
            HumanMessage(content=f"{combined}\n\nQuestion: {user_text}"),
        ])
        content = response.content.strip()
    except Exception as e:
        content = f"데이터 조회 후 응답 생성 중 오류가 발생했습니다: {e}"

    return {
        "messages": [AIMessage(content=content)],
        "query_result": db_context,
        "context": rag_context,
    }
