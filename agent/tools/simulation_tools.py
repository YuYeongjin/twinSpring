"""
Simulation Agent 도구 모음 — 굴착기 시뮬레이션 제어

SimulationAgent 가 create_react_agent 를 통해 호출하는 @tool 함수들.
Spring Boot /api/simulation/excavator 엔드포인트와 통신합니다.
"""

import json
import httpx
from langchain_core.tools import tool
from config import SPRING_BASE_URL

EXCAVATOR_ID = "EX-001"

# 프리셋 정의 (SimulationDashboard.js PRESETS 와 동기화)
_PRESETS = {
    "IDLE":   {"boomAngle": 35,  "armAngle": 60,  "bucketAngle": -25, "swingAngle": 0,  "operationMode": "IDLE"},
    "DIG":    {"boomAngle": 5,   "armAngle": 100, "bucketAngle": 10,  "swingAngle": 0,  "operationMode": "DIG"},
    "DUMP":   {"boomAngle": 65,  "armAngle": 20,  "bucketAngle": -80, "swingAngle": 90, "operationMode": "DUMP"},
    "TRAVEL": {"boomAngle": 20,  "armAngle": 60,  "bucketAngle": -30, "swingAngle": 0,  "operationMode": "TRAVEL"},
}

_DEFAULT_STATE = {
    "excavatorId": EXCAVATOR_ID,
    "positionX": 0.0, "positionY": 0.0, "positionZ": 0.0,
    "bodyRotation": 0.0, "swingAngle": 0.0,
    "boomAngle": 35.0, "armAngle": 60.0, "bucketAngle": -25.0,
    "operationMode": "IDLE",
}


def _fetch_state() -> dict:
    try:
        res = httpx.get(
            f"{SPRING_BASE_URL}/api/simulation/excavator",
            params={"excavatorId": EXCAVATOR_ID},
            timeout=5,
        )
        res.raise_for_status()
        return res.json()
    except Exception:
        return dict(_DEFAULT_STATE)


def _put_state(payload: dict) -> tuple[bool, str]:
    try:
        res = httpx.put(
            f"{SPRING_BASE_URL}/api/simulation/excavator",
            json=payload,
            timeout=5,
        )
        res.raise_for_status()
        return True, "success"
    except Exception as e:
        return False, str(e)


# ── Tools ─────────────────────────────────────────────────────────────────────

@tool
def get_excavator_state() -> str:
    """
    굴착기 EX-001 의 현재 상태를 조회합니다.
    위치(X/Y/Z), 각도(붐/암/버킷/스윙/바디회전), 작동 모드를 반환합니다.
    """
    state = _fetch_state()
    return json.dumps({
        "excavatorId":  state.get("excavatorId", EXCAVATOR_ID),
        "position":     {"x": state.get("positionX", 0), "y": state.get("positionY", 0), "z": state.get("positionZ", 0)},
        "angles": {
            "boom":         state.get("boomAngle", 35),
            "arm":          state.get("armAngle", 60),
            "bucket":       state.get("bucketAngle", -25),
            "swing":        state.get("swingAngle", 0),
            "bodyRotation": state.get("bodyRotation", 0),
        },
        "operationMode": state.get("operationMode", "IDLE"),
        "availablePresets": list(_PRESETS.keys()),
    }, ensure_ascii=False)


@tool
def set_excavator_preset(preset: str) -> str:
    """
    굴착기에 작동 프리셋을 적용합니다.

    preset 선택지:
      IDLE   → 대기 자세 (붐35° 암60° 버킷-25° 스윙0°)
      DIG    → 굴착 자세 (붐5°  암100° 버킷10°  스윙0°)
      DUMP   → 덤핑 자세 (붐65° 암20°  버킷-80° 스윙90°)
      TRAVEL → 이동 자세 (붐20° 암60°  버킷-30° 스윙0°)
    """
    preset = preset.upper().strip()
    if preset not in _PRESETS:
        return json.dumps({
            "success": False,
            "error": f"유효하지 않은 프리셋: {preset}. 선택지: {list(_PRESETS.keys())}",
        })
    current = _fetch_state()
    payload = {**current, **_PRESETS[preset], "excavatorId": EXCAVATOR_ID}
    ok, msg = _put_state(payload)
    angles = _PRESETS[preset]
    return json.dumps({
        "success":  ok,
        "preset":   preset,
        "angles":   {k: v for k, v in angles.items() if "Angle" in k or k == "swingAngle"},
        "message":  f"{preset} 프리셋 적용 {'완료' if ok else '실패: ' + msg}",
    }, ensure_ascii=False)


@tool
def set_excavator_angles(
    boom_angle: float | None = None,
    arm_angle: float | None = None,
    bucket_angle: float | None = None,
    swing_angle: float | None = None,
    body_rotation: float | None = None,
) -> str:
    """
    굴착기 관절 각도를 개별 설정합니다 (단위: 도°).
    변경할 항목만 지정하면 됩니다 (나머지는 현재 상태 유지).

    boom_angle:    붐 각도 (0~90°)
    arm_angle:     암 각도 (0~150°)
    bucket_angle:  버킷 각도 (-90~90°)
    swing_angle:   상부 선회 각도 (-180~180°)
    body_rotation: 차체 회전 (-180~180°)
    """
    current = _fetch_state()
    payload = dict(current)
    payload["excavatorId"] = EXCAVATOR_ID
    changed = []

    if boom_angle is not None:
        payload["boomAngle"] = float(boom_angle)
        changed.append(f"붐:{boom_angle}°")
    if arm_angle is not None:
        payload["armAngle"] = float(arm_angle)
        changed.append(f"암:{arm_angle}°")
    if bucket_angle is not None:
        payload["bucketAngle"] = float(bucket_angle)
        changed.append(f"버킷:{bucket_angle}°")
    if swing_angle is not None:
        payload["swingAngle"] = float(swing_angle)
        changed.append(f"스윙:{swing_angle}°")
    if body_rotation is not None:
        payload["bodyRotation"] = float(body_rotation)
        changed.append(f"바디회전:{body_rotation}°")

    if not changed:
        return json.dumps({"success": False, "error": "변경할 각도를 하나 이상 지정하세요."})

    ok, msg = _put_state(payload)
    return json.dumps({
        "success": ok,
        "changed": changed,
        "message": "각도 업데이트 " + ("완료" if ok else f"실패: {msg}"),
    }, ensure_ascii=False)


@tool
def move_excavator(x: float, y: float = 0.0, z: float = 0.0) -> str:
    """
    굴착기를 지정한 좌표로 이동합니다.
    x, z 는 수평 위치 (m), y 는 높이 (보통 0).
    """
    current = _fetch_state()
    payload = dict(current)
    payload.update({"excavatorId": EXCAVATOR_ID, "positionX": float(x), "positionY": float(y), "positionZ": float(z)})
    ok, msg = _put_state(payload)
    return json.dumps({
        "success": ok,
        "position": {"x": x, "y": y, "z": z},
        "message":  f"위치 이동 {'완료' if ok else '실패: ' + msg}",
    }, ensure_ascii=False)


@tool
def reset_excavator() -> str:
    """
    굴착기를 초기 상태(IDLE 자세, 위치(0,0,0))로 리셋합니다.
    """
    try:
        res = httpx.post(
            f"{SPRING_BASE_URL}/api/simulation/excavator/reset",
            params={"excavatorId": EXCAVATOR_ID},
            timeout=5,
        )
        res.raise_for_status()
        return json.dumps({"success": True, "message": "굴착기 초기화 완료 (IDLE 자세, 위치 0,0,0)"})
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})


# ── 도구 목록 ──────────────────────────────────────────────────────────────────
SIMULATION_TOOLS = [
    get_excavator_state,
    set_excavator_preset,
    set_excavator_angles,
    move_excavator,
    reset_excavator,
]
