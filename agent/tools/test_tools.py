"""
Test Agent 도구 모음 — 충돌 테스트 탭

TestAgent 가 create_react_agent 를 통해 호출하는 @tool 함수들.
충돌 테스트 탭 안내, 키보드 조작법, 충돌 로그 조회를 지원합니다.
"""

import json
import httpx
from langchain_core.tools import tool
from config import SPRING_BASE_URL


# ── Tools ─────────────────────────────────────────────────────────────────────

@tool
def get_test_tab_guide() -> str:
    """
    Test 탭(충돌 테스트) 의 기능과 사용 방법을 설명합니다.
    키보드 조작법, Auto Mode, 충돌 감지 방법 등을 안내합니다.
    """
    guide = {
        "name":        "Test 탭 — 충돌 테스트 (Beta)",
        "description": (
            "키보드로 굴착기를 조종하여 BIM 건물 부재와의 실시간 충돌을 감지합니다. "
            "충돌 부재가 빨간색으로 하이라이트됩니다."
        ),
        "features": [
            "실시간 3D 충돌 감지 (굴착기 암 관절 ↔ BIM 부재)",
            "키보드 조종 (W/S/A/D/Q/E/R/F/T/G/Y/H)",
            "Auto Mode: 5단계 굴착-덤핑 자동 사이클",
            "충돌 부재 빨간 하이라이트 + 경고 배너",
            "충돌 로그 (시간·부재 ID·유형 기록)",
            "상태 모니터 (관절 각도·위치·충돌 횟수)",
        ],
        "keyboard_controls": {
            "W / S":  "앞으로 이동 / 뒤로 이동",
            "A / D":  "차체 좌회전 / 우회전",
            "Q / E":  "상부 좌선회 / 우선회",
            "R / F":  "붐 올리기 / 내리기",
            "T / G":  "암 뻗기 / 굽히기",
            "Y / H":  "버킷 열기 / 닫기",
            "Space":  "비상 정지",
        },
        "steps": [
            "1. 왼쪽 패널에서 BIM 프로젝트 선택 (건물이 투명 오버레이로 표시)",
            "2. 키보드로 굴착기 조종",
            "3. Auto Mode 토글 → 자동 굴착-덤핑 사이클",
            "4. 충돌 감지 시 빨간 배너 + 부재 하이라이트",
            "5. 왼쪽 패널 충돌 로그에서 이력 확인",
            "6. ↺ 버튼 또는 'Reset' 으로 기본 자세 복귀",
        ],
        "tips": [
            "Auto Mode 는 실제 굴착 시나리오를 자동으로 반복합니다.",
            "충돌 감지 범위는 굴착기 암 관절 3개 지점으로 계산됩니다.",
        ],
    }
    return json.dumps(guide, ensure_ascii=False)


@tool
def get_keyboard_controls() -> str:
    """
    Test 탭에서 굴착기를 키보드로 조종하는 단축키 목록을 반환합니다.
    """
    controls = {
        "movement": {
            "W":     "앞으로 이동",
            "S":     "뒤로 이동",
            "A":     "차체 좌회전",
            "D":     "차체 우회전",
        },
        "upper_body": {
            "Q":     "상부 구조 좌선회 (Swing Left)",
            "E":     "상부 구조 우선회 (Swing Right)",
        },
        "joints": {
            "R":     "붐(Boom) 올리기",
            "F":     "붐(Boom) 내리기",
            "T":     "암(Arm) 뻗기",
            "G":     "암(Arm) 굽히기",
            "Y":     "버킷(Bucket) 열기",
            "H":     "버킷(Bucket) 닫기",
        },
        "other": {
            "Space": "비상 정지",
            "↺":     "기본 자세(IDLE) 복귀",
        },
        "tip": "Auto Mode 버튼으로 자동 굴착 사이클을 실행할 수 있습니다.",
    }
    return json.dumps(controls, ensure_ascii=False)


@tool
def get_collision_log(limit: int = 10) -> str:
    """
    최근 충돌 이벤트 로그를 조회합니다.
    어떤 BIM 부재와 언제 충돌했는지 기록을 반환합니다.
    limit 은 1~50 범위 (기본 10건).
    """
    limit = max(1, min(limit, 50))
    try:
        res = httpx.get(
            f"{SPRING_BASE_URL}/api/simulation/collision-log",
            params={"limit": limit},
            timeout=5,
        )
        res.raise_for_status()
        data = res.json()
        records = data if isinstance(data, list) else data.get("logs", [])
        return json.dumps({
            "count":   len(records),
            "records": records[:limit],
        }, ensure_ascii=False, default=str)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            return json.dumps({"count": 0, "records": [], "note": "충돌 로그 API 미구현 또는 기록 없음"})
        return json.dumps({"error": f"HTTP {e.response.status_code}"})
    except Exception as e:
        return json.dumps({"error": str(e), "records": []})


# ── 도구 목록 ──────────────────────────────────────────────────────────────────
TEST_TOOLS = [
    get_test_tab_guide,
    get_keyboard_controls,
    get_collision_log,
]
