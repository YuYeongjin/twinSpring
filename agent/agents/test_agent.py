"""
Test Agent — 충돌 테스트 탭 전문 에이전트

담당:
  - Test 탭 기능 설명·사용법 안내
  - 키보드 조작법 안내
  - 충돌 로그 조회
"""

from langchain_core.messages import SystemMessage, AIMessage
from langgraph.prebuilt import create_react_agent

from llm_config import llm_chat
from tools.test_tools import TEST_TOOLS
from lang_util import detect_lang, lang_instruction


# ── 시스템 프롬프트 ────────────────────────────────────────────────────────────
_SYSTEM = SystemMessage(content=(
    "You are a Test Tab (Collision Test) specialist for a BIM Digital Twin platform. "
    "You help users understand and use the collision test feature. "
    "\n\nTool usage guidelines:"
    "\n- get_test_tab_guide: use for general questions about the Test tab."
    "\n- get_keyboard_controls: use specifically for keyboard shortcut questions."
    "\n- get_collision_log: use when asked about past collision events or history."
    "\n\nProvide clear, structured answers with keyboard shortcuts and step-by-step instructions."
    "\nInclude markdown formatting (bold keys, bullet lists) for readability."
))

# ReAct 에이전트
_react_agent = create_react_agent(
    model=llm_chat,
    tools=TEST_TOOLS,
    prompt=_SYSTEM,
)


def run_test_agent(state: dict) -> dict:
    """Test Agent 실행 엔트리포인트."""
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
        "intent":   "tab_guide",
    }
