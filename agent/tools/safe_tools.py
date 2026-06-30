"""
Safe Agent 도구 모음 — 안전 모니터링 탭

SafeAgent 가 create_react_agent 를 통해 호출하는 @tool 함수들.
Spring Boot /api/detection, /api/sensor 엔드포인트와 통신합니다.
"""

import json
import logging
import httpx
from langchain_core.tools import tool
from config.settings import SPRING_BASE_URL

logger = logging.getLogger(__name__)
_ERR = "처리 중 오류가 발생했습니다."


# ── Tools ─────────────────────────────────────────────────────────────────────

@tool
def list_safe_projects() -> str:
    """
    DB에 저장된 안전 모니터링 프로젝트 목록을 반환합니다.
    프로젝트 ID, 현장명, 위치, 상태를 포함합니다.
    """
    try:
        res = httpx.get(f"{SPRING_BASE_URL}/api/safe/projects", timeout=10)
        res.raise_for_status()
        projects = res.json()
        return json.dumps({"projects": projects, "count": len(projects)}, ensure_ascii=False)
    except httpx.ConnectError:
        logger.error("[safe] list_safe_projects: Spring 연결 실패 (%s)", SPRING_BASE_URL, exc_info=True)
        return json.dumps({"error": _ERR})
    except Exception:
        logger.error("[safe] list_safe_projects 실패", exc_info=True)
        return json.dumps({"error": _ERR})


@tool
def get_detection_server_status() -> str:
    """
    YOLO 감지 서버(Python) 의 온라인/오프라인 상태를 확인합니다.
    서버가 오프라인이면 Spring 기본 색상 감지 모드로 동작합니다.
    """
    try:
        res = httpx.get(f"{SPRING_BASE_URL}/api/detection/health", timeout=5)
        online = res.status_code == 200
        return json.dumps({
            "online":      online,
            "mode":        "YOLO (Python)" if online else "Spring 기본 색상 감지",
            "description": "Python YOLO 서버 활성 중" if online else
                           "Python 감지 서버 오프라인 — Spring 기본 모드 (정확도 낮음)",
        })
    except Exception:
        return json.dumps({
            "online":      False,
            "mode":        "Spring 기본 색상 감지",
            "description": "감지 서버에 연결할 수 없습니다.",
        })


@tool
def get_recent_detections(limit: int = 10) -> str:
    """
    최근 감지 이벤트 로그를 조회합니다.
    헬멧 미착용, 출입 제한 구역 침입, 안전 감지 기록 등을 반환합니다.
    limit 은 1~50 범위 (기본 10건).
    """
    limit = max(1, min(limit, 50))
    try:
        res = httpx.get(
            f"{SPRING_BASE_URL}/api/detection/logs",
            params={"limit": limit},
            timeout=8,
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
            return json.dumps({"count": 0, "records": [], "note": "감지 로그 API 미구현"})
        return json.dumps({"error": f"HTTP {e.response.status_code}"})
    except Exception:
        logger.error("[safe] get_recent_detections 실패", exc_info=True)
        return json.dumps({"error": _ERR, "records": []})


@tool
def get_safety_stats() -> str:
    """
    안전 모니터링 통계 요약을 반환합니다.
    총 스캔 횟수, 위험 감지 수, 헬멧 미착용 수, 출입 제한 위반 수를 포함합니다.
    """
    try:
        res = httpx.get(f"{SPRING_BASE_URL}/api/detection/stats", timeout=8)
        res.raise_for_status()
        return json.dumps(res.json(), ensure_ascii=False, default=str)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            return json.dumps({
                "note":       "통계 API 미구현 — 감지 서버 활성화 후 이용 가능",
                "totalScans": 0,
                "dangerCount": 0,
                "helmetViolations": 0,
                "areaViolations":   0,
            })
        return json.dumps({"error": f"HTTP {e.response.status_code}"})
    except Exception:
        logger.error("[safe] get_safety_stats 실패", exc_info=True)
        return json.dumps({"error": _ERR})


@tool
def get_safe_tab_guide() -> str:
    """
    Safe 탭(안전 모니터링) 사용법과 기능을 설명합니다.
    카메라 설정, 실시간 감지 방법, 3D 시각화, 로그 확인 방법을 안내합니다.
    """
    guide = {
        "name": "Safe 탭 — AI 안전 모니터링",
        "description": (
            "웹캠 영상을 실시간 분석하여 헬멧 미착용·출입 제한 구역 침입을 감지합니다. "
            "YOLO 기반 Python 서버(정밀) 또는 Spring 기본 색상 감지(간이)로 동작합니다."
        ),
        "requirements": [
            "브라우저에서 카메라 권한 허용 필요",
            "HTTPS 환경 (HTTP 에서는 카메라 API 차단됨)",
        ],
        "detection_classes": {
            "no-hard-hat / no-helmet": "⛑ 헬멧 미착용 → DANGER",
            "restricted / danger-zone":  "🚫 출입 제한 구역 침입 → DANGER",
            "person / worker":            "👷 작업자 감지 (안전)",
        },
        "steps": [
            "1. '카메라 시작' 버튼 클릭 → 브라우저 권한 허용",
            "2. '▶ 실시간 감지' 클릭 → 5초마다 자동 분석",
            "3. 위반 감지 시 빨간 ⚠ DANGER 배너 표시",
            "4. '⬡ 생성' 클릭 → 감지된 객체를 3D 씬에 시각화",
            "5. '📋 감지 로그' 에서 이력·통계 확인",
        ],
        "k8s_notes": [
            "K8s 배포 시 HTTPS Ingress 필수 (06-ingress.yaml 참조)",
            "Permissions-Policy: camera=(self) 헤더 필요",
        ],
    }
    return json.dumps(guide, ensure_ascii=False)


# ── 도구 목록 ──────────────────────────────────────────────────────────────────
SAFE_TOOLS = [
    list_safe_projects,
    get_detection_server_status,
    get_recent_detections,
    get_safety_stats,
    get_safe_tab_guide,
]
