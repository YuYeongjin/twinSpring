"""
Node 2: RAG + Database 조회 노드 (Ollama - Llama 3.2 1B)

DB 데이터와 RAG 컨텍스트를 LLM에 전달할 때
1B 모델의 컨텍스트 한계(2048 토큰)를 고려해 데이터 양을 제한합니다.
"""

import re
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from state import AgentState
from llm import llm_chat
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

# 1B 모델 컨텍스트 절약: 시스템 프롬프트를 짧게 영어로
_SYSTEM = SystemMessage(content=(
    "You are a smart building assistant. "
    "Use the provided data to answer the question in Korean. "
    "Be concise and include key numbers."
))


def _detect_targets(text: str) -> list[str]:
    targets = [k for k, pat in _KEYWORDS.items() if pat.search(text)]
    return targets or ["sensor", "energy"]


def _fetch_db_context(targets: list[str]) -> str:
    parts = []
    if "sensor" in targets:
        rows = query_sensor_data(limit=3)   # 1B 모델 컨텍스트 절약: 3건
        parts.append(f"[Sensor]\n{_rows_to_text(rows)}")
    if "energy" in targets:
        rows = query_energy_data(limit=3)
        parts.append(f"[Energy]\n{_rows_to_text(rows)}")
    if "alert" in targets:
        rows = query_ems_alerts(limit=3)
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

    # 2. RAG 검색 (k=2로 제한해 토큰 절약)
    rag_context = search_as_text(user_text, k=2)

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
