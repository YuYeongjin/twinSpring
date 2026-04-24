"""
Node 2: RAG + Database 조회 노드 (Ollama - gemma3:12b)
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


def _fmt_time(val) -> str:
    """timestamp → 'HH:MM' 문자열 변환 (datetime / str 모두 처리)"""
    if val is None:
        return ""
    if isinstance(val, datetime):
        return val.strftime("%H:%M")
    try:
        return datetime.fromisoformat(str(val)).strftime("%H:%M")
    except Exception:
        return str(val)[:16]


def _fetch_db_context(targets: list[str]) -> tuple[str, dict]:
    """DB 조회 결과를 (텍스트 컨텍스트, 구조화 딕셔너리) 형태로 반환"""
    parts = []
    structured: dict = {}

    if "sensor" in targets:
        rows = query_sensor_data(limit=20)
        parts.append(f"[Sensor]\n{_rows_to_text(rows)}")
        structured["sensor"] = [
            {
                "time": _fmt_time(r.get("timestamp")),
                "temperature": _safe_float(r.get("temperature") or r.get("temp")),
                "humidity": _safe_float(r.get("humidity")),
            }
            for r in reversed(rows)   # 오래된 것부터 표시
        ]
        if rows:
            latest = rows[0]
            structured["latest"] = {
                "temperature": _safe_float(latest.get("temperature") or latest.get("temp")),
                "humidity": _safe_float(latest.get("humidity")),
                "timestamp": _fmt_time(latest.get("timestamp")),
            }

  
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

    # 1. DB 조회 (텍스트 + 구조화 데이터)
    targets = _detect_targets(user_text)
    db_context, sensor_data = _fetch_db_context(targets)

    # 2. RAG 검색
    rag_context = search_as_text(user_text, k=3)

    # 3. 컨텍스트 조합
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
        "sensor_data": sensor_data,
    }
