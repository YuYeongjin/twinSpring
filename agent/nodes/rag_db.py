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

    if "energy" in targets:
        rows = query_energy_data(limit=20)
        parts.append(f"[Energy]\n{_rows_to_text(rows)}")
        if rows:
            # 에너지 필드는 테이블 구조에 따라 다를 수 있으므로 첫 번째 행 키 기준
            sample = rows[0]
            kw_key   = next((k for k in sample if "kw" in k.lower() and "kwh" not in k.lower()), None)
            kwh_key  = next((k for k in sample if "kwh" in k.lower()), None)
            volt_key = next((k for k in sample if "volt" in k.lower() or "voltage" in k.lower()), None)
            amp_key  = next((k for k in sample if "amp" in k.lower() or "current" in k.lower()), None)
            structured["energy"] = [
                {
                    "time": _fmt_time(r.get("timestamp")),
                    "kw":      _safe_float(r.get(kw_key))   if kw_key   else None,
                    "kwh":     _safe_float(r.get(kwh_key))  if kwh_key  else None,
                    "voltage": _safe_float(r.get(volt_key)) if volt_key else None,
                    "current": _safe_float(r.get(amp_key))  if amp_key  else None,
                }
                for r in reversed(rows)
            ]

    if "alert" in targets:
        rows = query_ems_alerts(limit=10)
        parts.append(f"[Alerts]\n{_rows_to_text(rows)}")
        structured["alerts"] = [
            {
                "time":     _fmt_time(r.get("created_at") or r.get("timestamp")),
                "message":  str(r.get("message") or r.get("alert_message") or ""),
                "severity": str(r.get("severity") or r.get("level") or "info"),
            }
            for r in rows
        ]

    if "threshold" in targets:
        rows = query_ems_thresholds()
        parts.append(f"[Thresholds]\n{_rows_to_text(rows)}")
        structured["thresholds"] = [dict(r) for r in rows]

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
