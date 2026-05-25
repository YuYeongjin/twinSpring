"""
Simulation Agent — 굴착기 시뮬레이션 제어 전문 에이전트

담당:
  - 굴착기 상태 조회
  - 프리셋 적용 (IDLE/DIG/DUMP/TRAVEL)
  - 관절 각도 설정
  - 위치 이동
  - 리셋

LangGraph create_react_agent 패턴으로 구현.
빠른 키워드 매칭 후 ReAct 루프로 폴백합니다.
"""

import re
from langchain_core.messages import SystemMessage, AIMessage
from langgraph.prebuilt import create_react_agent

from llm_config import llm_chat
from tools.simulation_tools import SIMULATION_TOOLS
from lang_util import detect_lang, lang_instruction


# ── 시스템 프롬프트 ────────────────────────────────────────────────────────────
_SYSTEM = SystemMessage(content=(
    "You are an excavator simulation controller for a Digital Twin platform. "
    "You control excavator EX-001 through natural language commands. "
    "\n\nTool usage guidelines:"
    "\n- get_excavator_state: call first for status/position/angle queries."
    "\n- set_excavator_preset: use for IDLE/DIG/DUMP/TRAVEL preset commands."
    "\n- set_excavator_angles: use when specific angle values are mentioned."
    "\n- move_excavator: use when position coordinates are mentioned."
    "\n- reset_excavator: use for reset/initialize commands."
    "\n\nAlways report the resulting angles/position after executing a command."
    "\nUse Korean terms where appropriate: 붐(Boom), 암(Arm), 버킷(Bucket), 스윙(Swing)."
))

# ReAct 에이전트
_react_agent = create_react_agent(
    model=llm_chat,
    tools=SIMULATION_TOOLS,
    state_modifier=_SYSTEM,
)

# 빠른 키워드 → preset 매핑
_PRESET_MAP = [
    (re.compile(r"idle|대기|아이들", re.I), "IDLE"),
    (re.compile(r"dig|굴착",          re.I), "DIG"),
    (re.compile(r"dump|덤핑",          re.I), "DUMP"),
    (re.compile(r"travel|이동\s*자세", re.I), "TRAVEL"),
]
_RESET_PAT  = re.compile(r"초기화|리셋|reset|원위치", re.I)
_STATUS_PAT = re.compile(r"상태|현재|조회|확인|보여|status|current|show", re.I)
_CHANGE_PAT = re.compile(r"설정|변경|바꿔|적용|이동|set|change|move|apply", re.I)


def run_simulation_agent(state: dict) -> dict:
    """
    Simulation Agent 실행 엔트리포인트.
    빠른 키워드 매칭 → 실패 시 create_react_agent ReAct 루프.
    """
    messages  = state.get("messages", [])
    last_msg  = messages[-1] if messages else None
    user_text = last_msg.content if last_msg and hasattr(last_msg, "content") else ""

    # 언어 감지
    recent_text = " ".join(m.content for m in messages[-5:] if hasattr(m, "content"))
    lang = detect_lang(recent_text)
    note = lang_instruction(lang)

    agent_messages = messages
    if note:
        from langchain_core.messages import SystemMessage as SM
        agent_messages = [SM(content=note)] + list(messages)

    # ReAct 루프 실행
    result = _react_agent.invoke({"messages": agent_messages})

    last    = result["messages"][-1]
    content = last.content if hasattr(last, "content") else ""

    return {
        "messages": [AIMessage(content=content)],
        "intent":   "simulation_controller",
    }
