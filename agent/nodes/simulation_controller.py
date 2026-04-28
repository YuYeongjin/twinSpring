"""
Node: Simulation Controller 노드

굴착기 시뮬레이션 제어:
- 상태 조회 (getState)
- 프리셋 적용 (setPreset: IDLE / DIG / DUMP / TRAVEL)
- 관절 각도 설정 (setAngles)
- 위치 이동 (setPosition)
- 전체 초기화 (reset)
"""

import json
import re
import httpx
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from state import AgentState
from llm_config import llm_precise
from config import SPRING_BASE_URL

EXCAVATOR_ID = "EX-001"

# ── 프리셋 정의 (SimulationDashboard.js의 PRESETS와 동일) ─────────
PRESETS: dict[str, dict] = {
    "IDLE":   {"boomAngle": 35,  "armAngle": 60,  "bucketAngle": -25, "swingAngle": 0,  "operationMode": "IDLE"},
    "DIG":    {"boomAngle": 5,   "armAngle": 100, "bucketAngle": 10,  "swingAngle": 0,  "operationMode": "DIG"},
    "DUMP":   {"boomAngle": 65,  "armAngle": 20,  "bucketAngle": -80, "swingAngle": 90, "operationMode": "DUMP"},
    "TRAVEL": {"boomAngle": 20,  "armAngle": 60,  "bucketAngle": -30, "swingAngle": 0,  "operationMode": "TRAVEL"},
}

PRESET_KOR = {"IDLE": "대기", "DIG": "굴착", "DUMP": "덤핑", "TRAVEL": "이동"}

# 관절 한국어 이름 매핑
ANGLE_KOR = {
    "boomAngle":    "붐",
    "armAngle":     "암",
    "bucketAngle":  "버킷",
    "swingAngle":   "선회",
    "bodyRotation": "차체 회전",
}

# ── LLM 시스템 프롬프트 ───────────────────────────────────────────

_SYSTEM_PROMPT = SystemMessage(content="""굴착기 시뮬레이션 제어 명령을 JSON으로 파싱하세요. JSON만 출력하세요.

액션 목록:
- getState   : 현재 굴착기 상태 조회
- setPreset  : 프리셋 적용 (preset: IDLE / DIG / DUMP / TRAVEL)
- setAngles  : 특정 관절 각도 설정 (단위: 도°)
- setPosition: 굴착기 위치 이동
- reset      : 전체 초기화

setAngles 사용 필드: boomAngle, armAngle, bucketAngle, swingAngle, bodyRotation
setPosition 사용 필드: positionX, positionY, positionZ

출력 예시:
{"action":"setPreset","preset":"DIG"}
{"action":"setAngles","boomAngle":45,"armAngle":90}
{"action":"setPosition","positionX":5,"positionZ":3}
{"action":"getState"}
{"action":"reset"}

모르는 값은 포함하지 마세요. JSON만 출력하세요.""")


# ── 유틸 ─────────────────────────────────────────────────────────

def _extract_json(text: str) -> dict | None:
    text = re.sub(r"```(?:json)?", "", text).strip().rstrip("`").strip()
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group())
    except Exception:
        return None


def _detect_preset(text: str) -> str | None:
    t = text.lower().replace(" ", "")
    for preset, keywords in [
        ("IDLE",   ["idle", "대기", "아이들", "대기자세", "대기모드"]),
        ("DIG",    ["dig", "굴착자세", "굴착모드", "굴착"]),
        ("DUMP",   ["dump", "덤핑자세", "덤핑모드", "덤핑"]),
        ("TRAVEL", ["travel", "이동자세", "이동모드"]),
    ]:
        if any(kw in t for kw in keywords):
            return preset
    return None


# ── Spring API 호출 ───────────────────────────────────────────────

def _get_current_state() -> dict | None:
    try:
        res = httpx.get(
            f"{SPRING_BASE_URL}/api/simulation/excavator",
            params={"excavatorId": EXCAVATOR_ID},
            timeout=5,
        )
        res.raise_for_status()
        return res.json()
    except Exception:
        return None


def _update_state(payload: dict) -> tuple[bool, dict | None]:
    try:
        res = httpx.put(
            f"{SPRING_BASE_URL}/api/simulation/excavator",
            json=payload,
            timeout=5,
        )
        res.raise_for_status()
        return True, res.json()
    except Exception:
        return False, None


def _reset_state() -> bool:
    try:
        res = httpx.post(
            f"{SPRING_BASE_URL}/api/simulation/excavator/reset",
            params={"excavatorId": EXCAVATOR_ID},
            timeout=5,
        )
        res.raise_for_status()
        return True
    except Exception:
        return False


# ── 기본 상태 (서버 미응답 시 fallback) ───────────────────────────
_DEFAULT_STATE = {
    "excavatorId":  EXCAVATOR_ID,
    "positionX": 0.0, "positionY": 0.0, "positionZ": 0.0,
    "bodyRotation": 0.0, "swingAngle": 0.0,
    "boomAngle": 35.0, "armAngle": 60.0, "bucketAngle": -25.0,
    "operationMode": "IDLE",
}


# ── 노드 함수 ─────────────────────────────────────────────────────

def simulation_controller_node(state: AgentState) -> dict:
    last_message = state["messages"][-1]
    user_text = last_message.content if hasattr(last_message, "content") else str(last_message)
    sim_project_id = state.get("simulation_project_id")

    # ── 1. 빠른 키워드 분류 ──────────────────────────────────────
    text_lower = user_text.lower().replace(" ", "")

    # 초기화 요청
    if re.search(r"초기화|리셋|reset|원위치", user_text, re.IGNORECASE):
        action = {"action": "reset"}

    # 프리셋 키워드 직접 감지
    elif (preset := _detect_preset(user_text)) and re.search(r"설정|변경|바꿔|적용|해줘|모드", user_text, re.IGNORECASE):
        action = {"action": "setPreset", "preset": preset}

    # 상태 조회 (변경 키워드 없이 확인만)
    elif (
        re.search(r"상태|현재|조회|확인|알려|보여|어떻게|각도|위치", user_text, re.IGNORECASE)
        and not re.search(r"설정|변경|바꿔|조정|맞춰|이동", user_text, re.IGNORECASE)
    ):
        action = {"action": "getState"}

    else:
        # ── 2. LLM 파싱 ─────────────────────────────────────────
        try:
            resp = llm_precise.invoke([
                _SYSTEM_PROMPT,
                HumanMessage(content=user_text),
            ])
            action = _extract_json(resp.content) or {"action": "getState"}
        except Exception:
            action = {"action": "getState"}

    # ── 3. 현재 상태 로드 (PUT 요청에 전체 필드 필요) ────────────
    current = _get_current_state() or dict(_DEFAULT_STATE)

    act = action.get("action", "getState")

    # ── 4. 액션 실행 ─────────────────────────────────────────────

    if act == "getState":
        project_line = f"📁 프로젝트: {sim_project_id}\n" if sim_project_id else ""
        reply = (
            f"🚜 굴착기 {EXCAVATOR_ID} 현재 상태\n"
            f"{project_line}\n"
            f"📍 위치  X={current.get('positionX', 0):.1f}  Y={current.get('positionY', 0):.1f}  Z={current.get('positionZ', 0):.1f}\n"
            f"🔄 차체 회전:  {current.get('bodyRotation', 0):.1f}°\n"
            f"⚙️ 선회각:    {current.get('swingAngle', 0):.1f}°\n"
            f"💪 붐 각도:   {current.get('boomAngle', 0):.1f}°\n"
            f"🦾 암 각도:   {current.get('armAngle', 0):.1f}°\n"
            f"🪣 버킷 각도: {current.get('bucketAngle', 0):.1f}°\n"
            f"🏷 작동 모드: {current.get('operationMode', 'IDLE')}\n\n"
            "사용 가능한 프리셋: IDLE(대기) / DIG(굴착) / DUMP(덤핑) / TRAVEL(이동)"
        )
        return {"messages": [AIMessage(content=reply)]}

    elif act == "reset":
        ok = _reset_state()
        if ok:
            reply = (
                "✅ 굴착기가 초기 상태로 리셋되었습니다.\n\n"
                "📍 위치: (0, 0, 0)\n"
                "💪 붐: 35° | 🦾 암: 60° | 🪣 버킷: -25°\n"
                "🏷 모드: IDLE"
            )
        else:
            reply = "⚠️ 초기화 요청을 전송했습니다. 서버 응답이 없으면 시뮬레이션 뷰에서 수동으로 초기화하세요."
        return {"messages": [AIMessage(content=reply)]}

    elif act == "setPreset":
        preset_name = (action.get("preset") or "IDLE").upper()
        if preset_name not in PRESETS:
            preset_name = "IDLE"
        preset_data = PRESETS[preset_name]
        payload = {**current, **preset_data, "excavatorId": EXCAVATOR_ID}
        ok, _ = _update_state(payload)
        kor = PRESET_KOR.get(preset_name, preset_name)
        angles = preset_data
        if ok:
            reply = (
                f"✅ {kor}({preset_name}) 자세로 설정되었습니다.\n\n"
                f"💪 붐: {angles['boomAngle']}°  "
                f"🦾 암: {angles['armAngle']}°  "
                f"🪣 버킷: {angles['bucketAngle']}°  "
                f"🔄 선회: {angles['swingAngle']}°"
            )
        else:
            reply = (
                f"⚠️ {kor}({preset_name}) 프리셋 요청을 전송했습니다. "
                "시뮬레이션 뷰에서 변경을 확인하세요."
            )
        return {"messages": [AIMessage(content=reply)]}

    elif act == "setAngles":
        payload = dict(current)
        payload["excavatorId"] = EXCAVATOR_ID
        changed: list[str] = []
        for field, kor in ANGLE_KOR.items():
            if field in action and action[field] is not None:
                payload[field] = float(action[field])
                changed.append(f"{kor}: {action[field]}°")
        if not changed:
            return {"messages": [AIMessage(content=(
                "변경할 각도 정보를 찾지 못했습니다.\n"
                "예) '붐 각도를 45도로 설정해줘' / '암 90도, 버킷 -20도로 변경해줘'"
            ))]}
        ok, _ = _update_state(payload)
        summary = " | ".join(changed)
        if ok:
            reply = f"✅ 관절 각도가 설정되었습니다.\n\n{summary}"
        else:
            reply = f"⚠️ 각도 설정 요청을 전송했습니다.\n\n{summary}"
        return {"messages": [AIMessage(content=reply)]}

    elif act == "setPosition":
        payload = dict(current)
        payload["excavatorId"] = EXCAVATOR_ID
        changed: list[str] = []
        for field, axis in [("positionX", "X"), ("positionY", "Y"), ("positionZ", "Z")]:
            if field in action and action[field] is not None:
                payload[field] = float(action[field])
                changed.append(f"{axis}: {action[field]}")
        if not changed:
            return {"messages": [AIMessage(content=(
                "이동할 위치 정보를 찾지 못했습니다.\n"
                "예) '위치를 x=5, z=3으로 이동해줘'"
            ))]}
        ok, _ = _update_state(payload)
        summary = " | ".join(changed)
        if ok:
            reply = f"✅ 굴착기 위치가 이동되었습니다.\n\n{summary}"
        else:
            reply = f"⚠️ 위치 이동 요청을 전송했습니다.\n\n{summary}"
        return {"messages": [AIMessage(content=reply)]}

    else:
        return {"messages": [AIMessage(content=(
            "🚜 굴착기 시뮬레이션 제어 안내\n\n"
            "• **상태 조회** — '굴착기 현재 상태 알려줘'\n"
            "• **프리셋 적용** — 'DIG 자세로 설정해줘' / 'IDLE 모드로 변경'\n"
            "  IDLE(대기) / DIG(굴착) / DUMP(덤핑) / TRAVEL(이동)\n"
            "• **각도 설정** — '붐 각도 45도로 설정해줘'\n"
            "• **위치 이동** — 'x=5, z=3 위치로 이동해줘'\n"
            "• **초기화** — '굴착기 초기화해줘'"
        ))]}
