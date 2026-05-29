"""
Simulation Agent — 굴착기 시뮬레이션 제어 전문 에이전트

qwen2.5:3b 등 소형 모델은 tool calling이 불안정하므로
키워드 기반으로 의도를 파악해 도구를 직접 호출합니다 (Direct Dispatch).
시방서 검색 등 복잡한 질의만 ReAct 루프로 폴백합니다.
"""

import re
import json
from langchain_core.messages import SystemMessage, AIMessage, HumanMessage
from langgraph.prebuilt import create_react_agent

from config.llm_config import llm_precise
from tools.simulation_tools import (
    SIMULATION_TOOLS,
    get_excavator_state, set_excavator_preset, set_excavator_angles,
    move_excavator, reset_excavator, get_earthwork_summary,
)
from config.lang_util import detect_lang, lang_instruction


# ── ReAct (시방서 검색 등 복잡한 질의 전용) ───────────────────────────────────
_SYSTEM = SystemMessage(content=(
    "You are an excavator simulation controller and earthwork specialist.\n"
    "Use tools to answer questions about excavation specs, earthwork volume, and KCS/KDS standards.\n"
    "Match the language of the user's input.\n"
))

_react_agent = create_react_agent(
    model=llm_precise,
    tools=SIMULATION_TOOLS,
    prompt=_SYSTEM,
)

_TOOL_MAP = {t.name: t for t in SIMULATION_TOOLS}


# ── 직접 디스패치 패턴 ─────────────────────────────────────────────────────────
_PRESET_MAP = [
    (re.compile(r"\bidle\b|대기\s*자세|아이들|待機姿勢", re.I), "IDLE"),
    (re.compile(r"\bdig\b|굴착\s*자세|掘削姿勢", re.I), "DIG"),
    (re.compile(r"\bdump\b|덤핑\s*자세|ダンプ姿勢", re.I), "DUMP"),
    (re.compile(r"\btravel\b|이동\s*자세|走行姿勢", re.I), "TRAVEL"),
]

_ANGLE_FIELDS = [
    ("boom_angle",    re.compile(r"붐|boom|ブーム", re.I)),
    ("arm_angle",     re.compile(r"(?:^|[^암])암(?!\s*반)|(?<!\w)arm(?!\w)|アーム", re.I)),
    ("bucket_angle",  re.compile(r"버킷|bucket|バケット", re.I)),
    ("swing_angle",   re.compile(r"스윙|swing|선회|スイング", re.I)),
    ("body_rotation", re.compile(r"바디.?회전|body.?rot|차체.?회전", re.I)),
]

_RESET_PAT = re.compile(r"초기화|리셋|\breset\b|원위치|リセット|初期化", re.I)
_STATE_PAT = re.compile(r"상태|현재|조회|확인|보여|\bstatus\b|\bcurrent\b|\bshow\b|現在|状態|確認", re.I)
_EARTH_PAT = re.compile(r"토공|earthwork|토적|굴착량|掘削量", re.I)
_SPEC_PAT  = re.compile(r"시방서|시공.?기준|KCS|KDS|仕様書|規格|spec\s*search", re.I)

_NUM_PAT   = re.compile(r"-?\d+(?:\.\d+)?")


# ── 직접 디스패치 ──────────────────────────────────────────────────────────────

def _direct_dispatch(user_text: str) -> tuple[str | None, str]:
    """
    키워드 매칭으로 적절한 tool을 직접 호출.
    (tool_name, result_json) 반환. tool_name=None 이면 ReAct 폴백.
    """
    # 1. 초기화
    if _RESET_PAT.search(user_text):
        return "reset_excavator", reset_excavator.invoke({})

    # 2. 프리셋 (숫자 없이 자세 이름만 있을 때)
    for pat, preset in _PRESET_MAP:
        if pat.search(user_text):
            return "set_excavator_preset", set_excavator_preset.invoke({"preset": preset})

    # 3. 각도 설정 (관절 이름 + 숫자)
    nums = _NUM_PAT.findall(user_text)
    if nums:
        params = {}
        for field, pat in _ANGLE_FIELDS:
            if pat.search(user_text):
                params[field] = float(nums[0])
        if params:
            return "set_excavator_angles", set_excavator_angles.invoke(params)

        # 위치 이동 (x= z= 형식)
        x_m = re.search(r"x\s*[=:]\s*(-?\d+(?:\.\d+)?)", user_text, re.I)
        z_m = re.search(r"z\s*[=:]\s*(-?\d+(?:\.\d+)?)", user_text, re.I)
        if x_m or z_m:
            return "move_excavator", move_excavator.invoke({
                "x": float(x_m.group(1)) if x_m else 0.0,
                "z": float(z_m.group(1)) if z_m else 0.0,
            })

    # 4. 상태 조회
    if _STATE_PAT.search(user_text):
        return "get_excavator_state", get_excavator_state.invoke({})

    # 5. 토공 정보
    if _EARTH_PAT.search(user_text):
        return "get_earthwork_summary", get_earthwork_summary.invoke({})

    # 시방서·복잡한 질의 → ReAct 폴백
    return None, ""


# ── 응답 포맷터 (LLM 불필요) ───────────────────────────────────────────────────

def _fmt(tool_name: str, result_json: str, lang: str) -> str:
    """Tool 결과 JSON을 사용자 언어로 간결하게 포맷 (LLM 없음)."""
    try:
        r = json.loads(result_json)
    except Exception:
        return result_json

    ok = r.get("success", True)

    # ── 오류 응답 ──
    if not ok:
        err = r.get("error", r.get("message", "unknown error"))
        return {"ko": f"실패: {err}", "ja": f"失敗: {err}"}.get(lang, f"Failed: {err}")

    # ── 상태 조회 ──
    if tool_name == "get_excavator_state":
        a    = r.get("angles", {})
        p    = r.get("position", {})
        mode = r.get("operationMode", "IDLE")
        bm, am, bk, sw = a.get("boom", 0), a.get("arm", 0), a.get("bucket", 0), a.get("swing", 0)
        px, pz = p.get("x", 0), p.get("z", 0)
        if lang == "ko":
            return (f"굴착기 EX-001 현재 상태\n"
                    f"• 모드: {mode}\n"
                    f"• 붐 {bm}°  암 {am}°  버킷 {bk}°  스윙 {sw}°\n"
                    f"• 위치: X={px}  Z={pz}")
        if lang == "ja":
            return (f"掘削機 EX-001 現在状態\n"
                    f"• モード: {mode}\n"
                    f"• ブーム {bm}°  アーム {am}°  バケット {bk}°  スイング {sw}°\n"
                    f"• 位置: X={px}  Z={pz}")
        return (f"Excavator EX-001 Status\n"
                f"• Mode: {mode}\n"
                f"• Boom {bm}°  Arm {am}°  Bucket {bk}°  Swing {sw}°\n"
                f"• Position: X={px}  Z={pz}")

    # ── 프리셋 ──
    if tool_name == "set_excavator_preset":
        preset = r.get("preset", "")
        names = {
            "ko": {"IDLE": "대기", "DIG": "굴착", "DUMP": "덤핑", "TRAVEL": "이동"},
            "ja": {"IDLE": "待機", "DIG": "掘削", "DUMP": "ダンプ", "TRAVEL": "走行"},
        }
        if lang == "ko":
            return f"굴착기 EX-001이 {names['ko'].get(preset, preset)} 자세({preset})로 변경되었습니다."
        if lang == "ja":
            return f"掘削機 EX-001 が{names['ja'].get(preset, preset)}姿勢({preset})に変更されました。"
        return f"Excavator EX-001 changed to {preset} position."

    # ── 각도 설정 ──
    if tool_name == "set_excavator_angles":
        changed = r.get("changed", [])
        parts   = ", ".join(changed)
        if lang == "ko": return f"각도 업데이트 완료: {parts}"
        if lang == "ja": return f"角度更新完了: {parts}"
        return f"Angles updated: {parts}"

    # ── 위치 이동 ──
    if tool_name == "move_excavator":
        pos = r.get("position", {})
        if lang == "ko": return f"이동 완료 → X={pos.get('x',0)}, Z={pos.get('z',0)}"
        if lang == "ja": return f"移動完了 → X={pos.get('x',0)}, Z={pos.get('z',0)}"
        return f"Moved to X={pos.get('x',0)}, Z={pos.get('z',0)}"

    # ── 초기화 ──
    if tool_name == "reset_excavator":
        if lang == "ko": return "굴착기 EX-001이 초기 상태(IDLE)로 리셋되었습니다."
        if lang == "ja": return "掘削機 EX-001 を初期状態(IDLE)にリセットしました。"
        return "Excavator EX-001 has been reset to initial state (IDLE)."

    # ── 토공 요약 ──
    if tool_name == "get_earthwork_summary":
        note = r.get("note", "")
        if lang == "ko": return f"토공 정보를 조회했습니다.\n{note}"
        if lang == "ja": return f"土工情報を取得しました。\n{note}"
        return f"Earthwork summary retrieved.\n{note}"

    return r.get("message", result_json)


# ── raw tool call 폴백 (ReAct 폴백에서 소형 모델 오출력 처리) ─────────────────

def _has_raw_tool_calls(content: str) -> bool:
    return bool(re.search(r'[">]\s*\{\s*"name"\s*:\s*"[a-z_]+"', content))


def _extract_tool_calls(content: str) -> list[dict]:
    results = []
    for m in re.finditer(
        r'\{\s*"name"\s*:\s*"(\w+)"\s*,\s*"arguments"\s*:\s*(\{[^}]*\})\s*\}',
        content, re.DOTALL,
    ):
        try:
            results.append({"name": m.group(1), "args": json.loads(m.group(2))})
        except Exception:
            pass
    if not results:
        for m in re.finditer(r'"name"\s*:\s*"(\w+)"', content):
            name = m.group(1)
            if name in _TOOL_MAP:
                results.append({"name": name, "args": {}})
    return results


def _react_fallback(content: str, agent_messages: list, lang: str) -> str:
    calls = _extract_tool_calls(content)
    if not calls:
        return content
    results = []
    for tc in calls:
        fn = _TOOL_MAP.get(tc["name"])
        if fn:
            try:
                results.append((tc["name"], fn.invoke(tc["args"])))
            except Exception as e:
                results.append((tc["name"], json.dumps({"success": False, "error": str(e)})))
    if not results:
        return content
    # 첫 번째 주요 tool 결과를 포맷
    return _fmt(results[0][0], results[0][1], lang)


# ── 에이전트 엔트리포인트 ──────────────────────────────────────────────────────

def run_simulation_agent(state: dict) -> dict:
    messages  = state.get("messages", [])
    last_msg  = messages[-1] if messages else None
    user_text = (last_msg.content if last_msg and hasattr(last_msg, "content") else "").strip()

    recent_text = " ".join(m.content for m in messages[-5:] if hasattr(m, "content"))
    lang = detect_lang(recent_text)

    # ── 1. 직접 디스패치 (시뮬레이션 제어 명령) ──
    tool_name, result_json = _direct_dispatch(user_text)
    if tool_name is not None:
        content = _fmt(tool_name, result_json, lang)
        return {"messages": [AIMessage(content=content)], "intent": "simulation_controller"}

    # ── 2. ReAct 폴백 (시방서·복잡한 질의) ──
    note = lang_instruction(lang)
    agent_messages = ([SystemMessage(content=note)] + list(messages)) if note else list(messages)

    result  = _react_agent.invoke({"messages": agent_messages})
    last    = result["messages"][-1]
    content = last.content if hasattr(last, "content") else ""

    if _has_raw_tool_calls(content):
        content = _react_fallback(content, agent_messages, lang)

    return {"messages": [AIMessage(content=content)], "intent": "simulation_controller"}
