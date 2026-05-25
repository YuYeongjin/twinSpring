"""
Safe Agent — 안전 모니터링 전문 에이전트

담당:
  - 감지 서버 상태 확인
  - 최근 감지 이벤트 조회
  - 안전 통계 요약
  - Safe 탭 사용법 안내
"""

from langchain_core.messages import SystemMessage, AIMessage
from langgraph.prebuilt import create_react_agent

from llm_config import llm_chat
from tools.safe_tools import SAFE_TOOLS
from lang_util import detect_lang, lang_instruction


# ── 시스템 프롬프트 ────────────────────────────────────────────────────────────
_SYSTEM = SystemMessage(content=(
    "You are a Safety Monitoring AI for a construction Digital Twin platform. "
    "You monitor helmet violations, restricted area intrusions, and safety statistics. "
    "\n\nTool usage guidelines:"
    "\n- get_detection_server_status: check if YOLO detection server is online."
    "\n- get_recent_detections: retrieve recent safety violation events."
    "\n- get_safety_stats: get overall safety statistics (total scans, violations)."
    "\n- get_safe_tab_guide: explain how to use the Safe tab (camera, detection, 3D visualization)."
    "\n\nAlways check server status first before reporting detection results."
    "\nHighlight danger events clearly with appropriate emojis (⚠️ for danger, ✅ for safe)."
))

# ReAct 에이전트
_react_agent = create_react_agent(
    model=llm_chat,
    tools=SAFE_TOOLS,
    state_modifier=_SYSTEM,
)


def run_safe_agent(state: dict) -> dict:
    """Safe Agent 실행 엔트리포인트."""
    messages = state.get("messages", [])

    recent_text = " ".join(m.content for m in messages[-5:] if hasattr(m, "content"))
    lang = detect_lang(recent_text)
    note = lang_instruction(lang)

    agent_messages = messages
    if note:
        from langchain_core.messages import SystemMessage as SM
        agent_messages = [SM(content=note)] + list(messages)

    result = _react_agent.invoke({"messages": agent_messages})

    last    = result["messages"][-1]
    content = last.content if hasattr(last, "content") else ""

    return {
        "messages": [AIMessage(content=content)],
        "intent":   "safe",
    }
