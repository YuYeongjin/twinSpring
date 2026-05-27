"""
Node: Simulation Controller node

Excavator simulation control:
- Status query (getState)
- Preset application (setPreset: IDLE / DIG / DUMP / TRAVEL)
- Joint angle setting (setAngles)
- Position movement (setPosition)
- Full reset (reset)
"""
from __future__ import annotations

import json
import re
import httpx
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from config.state import AgentState
from config.llm_config import llm_precise
from config.settings import SPRING_BASE_URL
from config.lang_util import detect_lang, translate_reply

EXCAVATOR_ID = "EX-001"

# Presets (same as SimulationDashboard.js PRESETS)
PRESETS: dict[str, dict] = {
    "IDLE":   {"boomAngle": 35,  "armAngle": 60,  "bucketAngle": -25, "swingAngle": 0,  "operationMode": "IDLE"},
    "DIG":    {"boomAngle": 5,   "armAngle": 100, "bucketAngle": 10,  "swingAngle": 0,  "operationMode": "DIG"},
    "DUMP":   {"boomAngle": 65,  "armAngle": 20,  "bucketAngle": -80, "swingAngle": 90, "operationMode": "DUMP"},
    "TRAVEL": {"boomAngle": 20,  "armAngle": 60,  "bucketAngle": -30, "swingAngle": 0,  "operationMode": "TRAVEL"},
}

PRESET_EN = {"IDLE": "Idle", "DIG": "Digging", "DUMP": "Dumping", "TRAVEL": "Traveling"}

# Joint English name mapping
ANGLE_EN = {
    "boomAngle":    "Boom",
    "armAngle":     "Arm",
    "bucketAngle":  "Bucket",
    "swingAngle":   "Swing",
    "bodyRotation": "Body Rotation",
}

# LLM system prompt
_SYSTEM_PROMPT = SystemMessage(content="""Parse excavator simulation control commands into JSON. Output JSON only.

Actions:
- getState   : Query current excavator status
- setPreset  : Apply preset (preset: IDLE / DIG / DUMP / TRAVEL)
- setAngles  : Set specific joint angles (unit: degrees)
- setPosition: Move excavator position
- reset      : Full reset

setAngles fields: boomAngle, armAngle, bucketAngle, swingAngle, bodyRotation
setPosition fields: positionX, positionY, positionZ

Output examples:
{"action":"setPreset","preset":"DIG"}
{"action":"setAngles","boomAngle":45,"armAngle":90}
{"action":"setPosition","positionX":5,"positionZ":3}
{"action":"getState"}
{"action":"reset"}

Do not include unknown values. Output JSON only.""")


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


# Default state (fallback when server is not responding)
_DEFAULT_STATE = {
    "excavatorId":  EXCAVATOR_ID,
    "positionX": 0.0, "positionY": 0.0, "positionZ": 0.0,
    "bodyRotation": 0.0, "swingAngle": 0.0,
    "boomAngle": 35.0, "armAngle": 60.0, "bucketAngle": -25.0,
    "operationMode": "IDLE",
}


def _simulation_controller_impl(state: AgentState) -> dict:
    last_message = state["messages"][-1]
    user_text = last_message.content if hasattr(last_message, "content") else str(last_message)
    sim_project_id = state.get("simulation_project_id")

    # 1. Fast keyword classification
    text_lower = user_text.lower().replace(" ", "")

    # Reset request
    if re.search(r"초기화|리셋|reset|원위치", user_text, re.IGNORECASE):
        action = {"action": "reset"}

    # Direct preset keyword detection
    elif (preset := _detect_preset(user_text)) and re.search(r"설정|변경|바꿔|적용|해줘|모드|set|apply|change", user_text, re.IGNORECASE):
        action = {"action": "setPreset", "preset": preset}

    # Status query (check only, no change keyword)
    elif (
        re.search(r"상태|현재|조회|확인|알려|보여|어떻게|각도|위치|status|current|query|check|show|angle|position", user_text, re.IGNORECASE)
        and not re.search(r"설정|변경|바꿔|조정|맞춰|이동|set|change|move|adjust", user_text, re.IGNORECASE)
    ):
        action = {"action": "getState"}

    else:
        # 2. LLM parsing
        try:
            resp = llm_precise.invoke([
                _SYSTEM_PROMPT,
                HumanMessage(content=user_text),
            ])
            action = _extract_json(resp.content) or {"action": "getState"}
        except Exception:
            action = {"action": "getState"}

    # 3. Load current state (full fields required for PUT)
    current = _get_current_state() or dict(_DEFAULT_STATE)

    act = action.get("action", "getState")

    # 4. Execute action

    if act == "getState":
        project_line = f"📁 Project: {sim_project_id}\n" if sim_project_id else ""
        reply = (
            f"🚜 Excavator {EXCAVATOR_ID} — Current Status\n"
            f"{project_line}\n"
            f"📍 Position  X={current.get('positionX', 0):.1f}  Y={current.get('positionY', 0):.1f}  Z={current.get('positionZ', 0):.1f}\n"
            f"🔄 Body Rotation:  {current.get('bodyRotation', 0):.1f}°\n"
            f"⚙️ Swing Angle:    {current.get('swingAngle', 0):.1f}°\n"
            f"💪 Boom Angle:     {current.get('boomAngle', 0):.1f}°\n"
            f"🦾 Arm Angle:      {current.get('armAngle', 0):.1f}°\n"
            f"🪣 Bucket Angle:   {current.get('bucketAngle', 0):.1f}°\n"
            f"🏷 Operation Mode: {current.get('operationMode', 'IDLE')}\n\n"
            "Available presets: IDLE / DIG / DUMP / TRAVEL"
        )
        return {"messages": [AIMessage(content=reply)]}

    elif act == "reset":
        ok = _reset_state()
        if ok:
            reply = (
                "✅ Excavator has been reset to initial state.\n\n"
                "📍 Position: (0, 0, 0)\n"
                "💪 Boom: 35° | 🦾 Arm: 60° | 🪣 Bucket: -25°\n"
                "🏷 Mode: IDLE"
            )
        else:
            reply = "⚠️ Reset request sent. If the server does not respond, reset manually from the simulation view."
        return {"messages": [AIMessage(content=reply)]}

    elif act == "setPreset":
        preset_name = (action.get("preset") or "IDLE").upper()
        if preset_name not in PRESETS:
            preset_name = "IDLE"
        preset_data = PRESETS[preset_name]
        payload = {**current, **preset_data, "excavatorId": EXCAVATOR_ID}
        ok, _ = _update_state(payload)
        en = PRESET_EN.get(preset_name, preset_name)
        angles = preset_data
        if ok:
            reply = (
                f"✅ Set to {en} ({preset_name}) pose.\n\n"
                f"💪 Boom: {angles['boomAngle']}°  "
                f"🦾 Arm: {angles['armAngle']}°  "
                f"🪣 Bucket: {angles['bucketAngle']}°  "
                f"🔄 Swing: {angles['swingAngle']}°"
            )
        else:
            reply = (
                f"⚠️ {en} ({preset_name}) preset request sent. "
                "Please verify the change in the simulation view."
            )
        return {"messages": [AIMessage(content=reply)]}

    elif act == "setAngles":
        payload = dict(current)
        payload["excavatorId"] = EXCAVATOR_ID
        changed: list[str] = []
        for field, en in ANGLE_EN.items():
            if field in action and action[field] is not None:
                payload[field] = float(action[field])
                changed.append(f"{en}: {action[field]}°")
        if not changed:
            return {"messages": [AIMessage(content=(
                "Could not find angle information to update.\n"
                "Example: 'Set boom angle to 45 degrees' / 'Change arm to 90° and bucket to -20°'"
            ))]}
        ok, _ = _update_state(payload)
        summary = " | ".join(changed)
        if ok:
            reply = f"✅ Joint angles updated.\n\n{summary}"
        else:
            reply = f"⚠️ Angle update request sent.\n\n{summary}"
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
                "Could not find position information to move to.\n"
                "Example: 'Move to position x=5, z=3'"
            ))]}
        ok, _ = _update_state(payload)
        summary = " | ".join(changed)
        if ok:
            reply = f"✅ Excavator position updated.\n\n{summary}"
        else:
            reply = f"⚠️ Position update request sent.\n\n{summary}"
        return {"messages": [AIMessage(content=reply)]}

    else:
        return {"messages": [AIMessage(content=(
            "🚜 Excavator Simulation Control Guide\n\n"
            "• **Status query** — 'Show excavator current status'\n"
            "• **Apply preset** — 'Set to DIG pose' / 'Change to IDLE mode'\n"
            "  IDLE / DIG / DUMP / TRAVEL\n"
            "• **Set angles** — 'Set boom angle to 45 degrees'\n"
            "• **Move position** — 'Move to position x=5, z=3'\n"
            "• **Reset** — 'Reset excavator'"
        ))]}


def simulation_controller_node(state: AgentState) -> dict:
    """
    Multi-language entry point.
    Runs _simulation_controller_impl, then translates the reply to the user's language.
    Language is detected from the last 5 messages for robustness.
    """
    recent_text = " ".join(
        msg.content for msg in state["messages"][-5:]
        if hasattr(msg, "content")
    )
    lang = detect_lang(recent_text)

    result = _simulation_controller_impl(state)

    if lang != "en" and result.get("messages"):
        result = {
            **result,
            "messages": [
                AIMessage(content=translate_reply(msg.content, lang))
                if (hasattr(msg, "content") and msg.content) else msg
                for msg in result["messages"]
            ],
        }
    return result
