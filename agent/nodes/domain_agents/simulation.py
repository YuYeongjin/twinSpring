"""
Simulation Domain Agent — LLM 없음, Tool 전용 디스패처

기존 simulation_agent.py 의 Direct Dispatch 로직을 그대로 이식.
시방서 검색은 rag_node 가 처리하므로 search_excavation_specs 는 제거.
"""
from __future__ import annotations

import re
import json
import logging

from config.state import AgentState

logger = logging.getLogger(__name__)

_PRESET_MAP = [
    (re.compile(r"\bidle\b|대기\s*자세|아이들|待機姿勢", re.I), "IDLE"),
    (re.compile(r"\bdig\b|굴착\s*자세|掘削姿勢",           re.I), "DIG"),
    (re.compile(r"\bdump\b|덤핑\s*자세|ダンプ姿勢",         re.I), "DUMP"),
    (re.compile(r"\btravel\b|이동\s*자세|走行姿勢",         re.I), "TRAVEL"),
]
_ANGLE_FIELDS = [
    ("boom_angle",    re.compile(r"붐|boom|ブーム",                              re.I)),
    ("arm_angle",     re.compile(r"(?:^|[^암])암(?!\s*반)|(?<!\w)arm(?!\w)|アーム", re.I)),
    ("bucket_angle",  re.compile(r"버킷|bucket|バケット",                          re.I)),
    ("swing_angle",   re.compile(r"스윙|swing|선회|スイング",                       re.I)),
    ("body_rotation", re.compile(r"바디.?회전|body.?rot|차체.?회전",               re.I)),
]
_RESET_PAT = re.compile(r"초기화|리셋|\breset\b|원위치|リセット|初期化", re.I)
_STATE_PAT = re.compile(r"상태|현재|조회|확인|보여|\bstatus\b|\bcurrent\b|\bshow\b|現在|状態|確認", re.I)
_EARTH_PAT = re.compile(r"토공|earthwork|토적|굴착량|掘削量", re.I)
_NUM_PAT   = re.compile(r"-?\d+(?:\.\d+)?")


def _invoke(tool_fn, args: dict) -> dict:
    try:
        raw = tool_fn.invoke(args)
        return json.loads(raw) if isinstance(raw, str) else raw
    except Exception as e:
        logger.error("[simulation] %s 실패: %s", tool_fn.name, e)
        return {"success": False, "error": str(e)}


def run_simulation_agent(state: AgentState) -> dict:
    from tools.simulation_tools import (
        get_excavator_state, set_excavator_preset, set_excavator_angles,
        move_excavator, reset_excavator, get_earthwork_summary,
    )

    messages = state.get("messages", [])
    text     = messages[-1].content if messages and hasattr(messages[-1], "content") else ""

    if _RESET_PAT.search(text):
        result = _invoke(reset_excavator, {})
        return {"tool_results": {"tool": "reset_excavator", "data": result}}

    for pat, preset in _PRESET_MAP:
        if pat.search(text):
            result = _invoke(set_excavator_preset, {"preset": preset})
            return {"tool_results": {"tool": "set_excavator_preset", "data": result}}

    nums = _NUM_PAT.findall(text)
    if nums:
        params = {}
        for field, pat in _ANGLE_FIELDS:
            m = pat.search(text)
            if m:
                # 키워드 직후에서 가장 가까운 숫자 추출, 없으면 첫 번째 숫자 사용
                after = _NUM_PAT.search(text[m.end():])
                params[field] = float(after.group()) if after else float(nums[0])
        if params:
            result = _invoke(set_excavator_angles, params)
            return {"tool_results": {"tool": "set_excavator_angles", "data": result}}

        x_m = re.search(r"x\s*[=:]\s*(-?\d+(?:\.\d+)?)", text, re.I)
        z_m = re.search(r"z\s*[=:]\s*(-?\d+(?:\.\d+)?)", text, re.I)
        if x_m or z_m:
            result = _invoke(move_excavator, {
                "x": float(x_m.group(1)) if x_m else 0.0,
                "z": float(z_m.group(1)) if z_m else 0.0,
            })
            return {"tool_results": {"tool": "move_excavator", "data": result}}

    if _EARTH_PAT.search(text):
        result = _invoke(get_earthwork_summary, {})
        return {"tool_results": {"tool": "get_earthwork_summary", "data": result}}

    if _STATE_PAT.search(text):
        result = _invoke(get_excavator_state, {})
        return {"tool_results": {"tool": "get_excavator_state", "data": result}}

    # 매칭 없음 — tool_results 비워 responder가 rag_context만으로 답하게 함
    return {"tool_results": {}}
