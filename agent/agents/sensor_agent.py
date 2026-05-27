"""
Sensor Agent — 온습도 데이터 조회 전문 에이전트

담당:
  - 실시간 온도·습도 조회
  - 최근 N건 이력 조회
  - 건물 문서 RAG 검색 (알림 임계값, 관리 기준)

LangGraph create_react_agent 패턴으로 구현.
필요한 도구를 자율적으로 선택·호출하고 최종 답변을 생성합니다.
"""
from __future__ import annotations

import json
from langchain_core.messages import SystemMessage, AIMessage
from langgraph.prebuilt import create_react_agent

from config.llm_config import llm_chat
from tools.sensor_tools import SENSOR_TOOLS
from config.lang_util import detect_lang, lang_instruction


# ── 시스템 프롬프트 ────────────────────────────────────────────────────────────
_SYSTEM = SystemMessage(content=(
    "You are a Smart Building Sensor Data Specialist.\n\n"

    "CRITICAL RULE: You MUST call a tool FIRST before responding. Never answer without tool data.\n\n"

    "Tool selection (pick one immediately):\n"
    "- User asks about current/latest value → call get_latest_sensor()\n"
    "- User asks about graph/chart/history/trend/그래프/이력 → call get_sensor_history(limit=20)\n"
    "- User asks about threshold/standard/문서 → call search_building_knowledge(query)\n"
    "- Default (any sensor question) → call get_sensor_history(limit=20)\n\n"

    "DO NOT ask the user for clarification. Call the most appropriate tool immediately.\n\n"

    "After getting tool results:\n"
    "- State the key numbers (temperature °C, humidity %) concisely.\n"
    "- 2-3 sentences maximum.\n"
    "- If no data found, say so in one sentence."
))

# ReAct 에이전트 (compile once, reuse)
_react_agent = create_react_agent(
    model=llm_chat,
    tools=SENSOR_TOOLS,
    prompt=_SYSTEM,
)


def run_sensor_agent(state: dict) -> dict:
    """
    Sensor Agent 실행 엔트리포인트.
    state["messages"] 를 입력받아 최종 AI 응답과 구조화 데이터를 반환합니다.
    """
    messages = state.get("messages", [])

    # 언어 감지
    recent_text = " ".join(
        m.content for m in messages[-5:] if hasattr(m, "content")
    )
    lang = detect_lang(recent_text)
    note = lang_instruction(lang)

    # 언어 지시를 시스템 메시지로 추가
    agent_messages = messages
    if note:
        from langchain_core.messages import SystemMessage as SM
        agent_messages = [SM(content=note)] + list(messages)

    # ReAct 루프 실행
    result = _react_agent.invoke({"messages": agent_messages})

    # 최종 AI 응답 추출
    last_msg = result["messages"][-1]
    content = last_msg.content if hasattr(last_msg, "content") else ""

    # 구조화 데이터 추출 (tool 결과에서 sensor_data 파싱)
    sensor_data = _extract_sensor_data(result["messages"])

    return {
        "messages":    [AIMessage(content=content)],
        "intent":      "sensor_agent",
        "sensor_data": sensor_data,
    }


def _extract_sensor_data(messages: list) -> dict | None:
    """
    ReAct 루프의 tool 결과 메시지에서 sensor_data 구조체를 추출합니다.
    프론트엔드 차트 렌더링용 데이터를 반환합니다.
    """
    sensor_data: dict = {}
    for msg in messages:
        # ToolMessage 는 content 가 JSON 문자열
        if hasattr(msg, "content") and isinstance(msg.content, str):
            try:
                data = json.loads(msg.content)
                if isinstance(data, dict):
                    if "records" in data:
                        # get_sensor_history 결과
                        sensor_data["sensor"] = data["records"]
                        if data.get("latest"):
                            sensor_data["latest"] = data["latest"]
                    elif "temperature" in data or "humidity" in data:
                        # get_latest_sensor 결과
                        sensor_data["latest"] = data
            except (json.JSONDecodeError, TypeError):
                pass
    return sensor_data if sensor_data else None
