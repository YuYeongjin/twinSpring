"""
Simulation Agent 도구 모음 — 굴착기 시뮬레이션 제어

SimulationAgent 가 create_react_agent 를 통해 호출하는 @tool 함수들.
Spring Boot /api/simulation/excavator 엔드포인트와 통신합니다.
"""
from __future__ import annotations
from typing import Optional

import json
import logging
import httpx
from langchain_core.tools import tool
from config.settings import SPRING_BASE_URL

logger = logging.getLogger(__name__)
_ERR = "처리 중 오류가 발생했습니다."

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
    except Exception:
        logger.error("[sim] _put_state 실패", exc_info=True)
        return False, _ERR


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
    boom_angle: Optional[float] = None,
    arm_angle: Optional[float] = None,
    bucket_angle: Optional[float] = None,
    swing_angle: Optional[float] = None,
    body_rotation: Optional[float] = None,
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
    except Exception:
        logger.error("[sim] reset_excavator 실패", exc_info=True)
        return json.dumps({"success": False, "error": _ERR})


@tool
def get_earthwork_summary() -> str:
    """
    굴착기 EX-001의 현재 상태와 토공 정보를 조회합니다.
    위치, 각도, 작동 모드, 지형 저장 여부를 반환합니다.
    토공량(굴착량·성토량) 누계는 시뮬레이션 프론트엔드에서 실시간 관리됩니다.
    """
    state = _fetch_state()
    return json.dumps({
        "excavatorId":    state.get("excavatorId", EXCAVATOR_ID),
        "position":       {"x": state.get("positionX", 0), "y": state.get("positionY", 0), "z": state.get("positionZ", 0)},
        "operationMode":  state.get("operationMode", "IDLE"),
        "angles": {
            "boom":   state.get("boomAngle", 35),
            "arm":    state.get("armAngle", 60),
            "bucket": state.get("bucketAngle", -25),
            "swing":  state.get("swingAngle", 0),
        },
        "note": (
            "토공량(총 굴착량·성토량) 누계와 굴착 구역(토질·암반·수중) 정보는 "
            "SimulationDashboard UI에서 실시간으로 관리됩니다. "
            "구체적인 수치는 화면 우측 패널의 Earthwork Log 섹션을 확인하세요."
        ),
    }, ensure_ascii=False)


@tool
def search_excavation_specs(query: str) -> str:
    """
    굴착·토공 관련 KCS/KDS 시방서 조문을 검색합니다.
    토공 시공기준, 암반 굴착, 수중 굴착, 비탈면 안정, 토적 계산,
    흙막이·지보공, 날씨별 시공 제한 등에 대해 검색할 수 있습니다.

    예시 query:
      "암반 굴착 기계굴착 한계 KCS"
      "비탈면 경사 기준 굴착깊이"
      "우천 시 토공 시공 제한"
      "토공량 팽창계수 체적 계산"
    """
    from tools.construction_rag_tool import search_construction_docs

    base = "토공 굴착 시공기준 KCS 11 20 토공일반 "
    full_query = (base + query.strip())[:250]

    try:
        docs = search_construction_docs(full_query, k=4)
    except Exception:
        logger.error("[sim] search_excavation_specs RAG 검색 실패", exc_info=True)
        return json.dumps({"error": _ERR}, ensure_ascii=False)

    results = []
    seen: set[str] = set()
    for doc in docs:
        text = doc.page_content.strip()
        if not text or text in seen:
            continue
        seen.add(text)
        meta = doc.metadata
        source = f"{meta.get('code', '')} {meta.get('title', '')}".strip() or meta.get("source", "알 수 없음")
        results.append({"source": source, "content": text[:400]})

    return json.dumps({
        "query":    full_query,
        "count":    len(results),
        "results":  results,
        "note": "KCS/KDS 건설 시방서 기반 검색 결과입니다.",
    }, ensure_ascii=False)


# ── 도구 목록 ──────────────────────────────────────────────────────────────────
SIMULATION_TOOLS = [
    get_excavator_state,
    set_excavator_preset,
    set_excavator_angles,
    move_excavator,
    reset_excavator,
    get_earthwork_summary,
    search_excavation_specs,
]
