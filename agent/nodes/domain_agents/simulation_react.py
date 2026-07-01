"""
Simulation Domain Agent v2 — LLM Tool Calling (ReAct Pattern)
"""
from __future__ import annotations
import logging

from config.state import AgentState
from config.lang_util import lang_instruction
from nodes.react_utils import build_react_subgraph, invoke_subgraph

logger = logging.getLogger(__name__)


def _system(state: AgentState) -> str:
    lang   = state.get("lang", "ko")
    sim_id = state.get("simulation_project_id", "")
    lines  = [
        "당신은 굴착기(Excavator) 시뮬레이션 제어 AI입니다.",
        "사용자의 자연어 명령을 해석해 적절한 tool을 호출하세요.",
        f"현재 simulation_project_id: {sim_id or '없음'}",
        "",
        "tool 선택 가이드:",
        "  - get_excavator_state  : 현재 굴착기 상태·각도 조회",
        "  - set_excavator_preset : IDLE/DIG/DUMP/TRAVEL 자세 프리셋 적용",
        "  - set_excavator_angles : boom/arm/bucket/swing/body_rotation 각도 직접 설정",
        "  - move_excavator       : x/z 좌표로 이동",
        "  - reset_excavator      : 초기 상태로 리셋",
        "  - get_earthwork_summary: 토공량·굴착량 요약 조회",
    ]
    note = lang_instruction(lang)
    if note:
        lines.append(note)
    return "\n".join(lines)


def _finalize(state: AgentState) -> dict:
    return {}   # 시뮬레이션은 별도 차트 데이터 없음


def _make_subgraph():
    from tools.simulation_tools import (
        get_excavator_state, set_excavator_preset, set_excavator_angles,
        move_excavator, reset_excavator, get_earthwork_summary,
    )
    return build_react_subgraph(
        tools=[
            get_excavator_state, set_excavator_preset, set_excavator_angles,
            move_excavator, reset_excavator, get_earthwork_summary,
        ],
        system_fn=_system,
        finalize_fn=_finalize,
    )


_subgraph = _make_subgraph()


def run_simulation_react_agent(state: AgentState) -> dict:
    logger.info("[NODE] ▶ simulation_react_agent 진입")
    return invoke_subgraph(_subgraph, state)
