"""
Test Domain Agent v2 — LLM Tool Calling (ReAct Pattern)
"""
from __future__ import annotations
import logging

from config.state import AgentState
from config.lang_util import lang_instruction
from nodes.react_utils import build_react_subgraph, invoke_subgraph

logger = logging.getLogger(__name__)


def _system(state: AgentState) -> str:
    lang  = state.get("lang", "ko")
    lines = [
        "당신은 충돌 감지 테스트 탭 전용 AI입니다.",
        "",
        "tool 선택 가이드:",
        "  - get_test_tab_guide  : 테스트 탭 전반 사용 안내",
        "  - get_keyboard_controls: 키보드 단축키·조작법 안내",
        "  - get_collision_log   : 충돌 감지 이력 조회",
    ]
    note = lang_instruction(lang)
    if note:
        lines.append(note)
    return "\n".join(lines)


def _finalize(state: AgentState) -> dict:
    return {}


def _make_subgraph():
    from tools.test_tools import get_test_tab_guide, get_keyboard_controls, get_collision_log
    return build_react_subgraph(
        tools=[get_test_tab_guide, get_keyboard_controls, get_collision_log],
        system_fn=_system,
        finalize_fn=_finalize,
    )


_subgraph = _make_subgraph()


def run_test_react_agent(state: AgentState) -> dict:
    logger.info("[NODE] ▶ test_react_agent 진입")
    return invoke_subgraph(_subgraph, state)
