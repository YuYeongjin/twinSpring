"""
BIM Agent 도구 모음

담당 도메인:
  - BIM 부재 CRUD (create_bim_element / create_composite_structure / delete_bim_element / create_bim_project)
  - BIM 프로젝트·부재 통계 조회 (list_bim_projects / get_bim_stats)
  - 드론 사진 분석 안내, 구조 해석 조회, IFC 파일 가져오기 안내
"""
from __future__ import annotations
from typing import Optional

import json
import uuid
import httpx
from langchain_core.tools import tool
from tools.db_tool import (
    query_bim_projects,
    query_bim_element_stats,
    query_bim_total_count,
)
from config.settings import SPRING_BASE_URL

# ── 기본 부재 크기 ─────────────────────────────────────────────────────────────
_DEFAULT_SIZES = {
    "IfcColumn": (0.5, 3.0, 0.5),
    "IfcBeam":   (5.0, 0.4, 0.4),
    "IfcWall":   (5.0, 3.0, 0.2),
    "IfcSlab":   (5.0, 0.2, 5.0),
    "IfcPier":   (1.0, 5.0, 1.0),
}

# ── Tools ─────────────────────────────────────────────────────────────────────

@tool
def list_bim_projects() -> str:
    """
    DB에 저장된 BIM 프로젝트 목록을 반환합니다.
    각 프로젝트의 ID, 이름, 구조 유형을 포함합니다.
    """
    projects = query_bim_projects()
    if not projects:
        return json.dumps({"projects": [], "count": 0})
    return json.dumps({"projects": projects, "count": len(projects)}, ensure_ascii=False)


@tool
def get_bim_stats(project_id: str) -> str:
    """
    특정 BIM 프로젝트의 부재 타입별 통계를 반환합니다.
    project_id 는 list_bim_projects 로 확인한 ID 를 사용합니다.
    """
    stats = query_bim_element_stats(project_id)
    total = query_bim_total_count(project_id)
    return json.dumps({
        "projectId": project_id,
        "stats":     stats,
        "total":     total,
    }, ensure_ascii=False)


@tool
def create_bim_element(
    project_id: str,
    element_type: str,
    material: str,
    position_x: float,
    position_y: float,
    position_z: float,
    size_x: Optional[float] = None,
    size_y: Optional[float] = None,
    size_z: Optional[float] = None,
) -> str:
    """
    BIM 프로젝트에 단일 부재를 생성합니다.

    element_type: IfcColumn | IfcBeam | IfcWall | IfcSlab | IfcPier
    material: Concrete | Steel | Timber | Composite
    position_x/y/z: 배치 좌표 (미터 단위)
    size_x/y/z: 크기 (지정하지 않으면 기본값 적용)

    성공 시 생성된 elementId 반환, 실패 시 오류 메시지 반환.
    """
    defaults = _DEFAULT_SIZES.get(element_type, (0.5, 3.0, 0.5))
    payload = {
        "elementId":   "ELEM-" + uuid.uuid4().hex[:8].upper(),
        "projectId":   project_id,
        "elementType": element_type,
        "material":    material or "Concrete",
        "positionX":   round(float(position_x), 3),
        "positionY":   round(float(position_y), 3),
        "positionZ":   round(float(position_z), 3),
        "sizeX":       round(float(size_x if size_x is not None else defaults[0]), 3),
        "sizeY":       round(float(size_y if size_y is not None else defaults[1]), 3),
        "sizeZ":       round(float(size_z if size_z is not None else defaults[2]), 3),
    }
    try:
        res = httpx.post(f"{SPRING_BASE_URL}/api/bim/element", json=payload, timeout=10)
        res.raise_for_status()
        return json.dumps({"success": True, "elementId": payload["elementId"],
                           "message": f"{element_type} 부재 생성 완료"}, ensure_ascii=False)
    except httpx.ConnectError:
        return json.dumps({"success": False, "error": f"Spring 서버 연결 실패 ({SPRING_BASE_URL})"})
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})


@tool
def delete_bim_element(element_id: str) -> str:
    """
    elementId 로 지정된 BIM 부재를 삭제합니다.
    element_id 는 사용자가 선택한 부재 ID 또는 get_bim_stats 로 확인한 ID 를 사용합니다.
    """
    try:
        res = httpx.delete(f"{SPRING_BASE_URL}/api/bim/element/{element_id}", timeout=10)
        res.raise_for_status()
        return json.dumps({"success": True, "message": f"부재 {element_id} 삭제 완료"}, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})


@tool
def create_bim_project(project_name: str, structure_type: str = "Building") -> str:
    """
    새 BIM 프로젝트를 생성합니다.
    structure_type: 'Building' 또는 'Bridge' (기본값 Building)
    """
    payload = {"projectName": project_name, "structureType": structure_type}
    try:
        res = httpx.post(f"{SPRING_BASE_URL}/api/bim/project", json=payload, timeout=10)
        res.raise_for_status()
        data = res.json()
        return json.dumps({"success": True, "projectId": data.get("projectId"),
                           "projectName": project_name}, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})


# ── 복합 구조물 템플릿 ────────────────────────────────────────────────────────
_COMPOSITE_TEMPLATES: dict[str, dict] = {
    "pier":           {"name": "교각 구조", "desc": "기초슬래브+기둥2+캡보"},
    "building_frame": {"name": "건물 골조", "desc": "슬래브+기둥4+보4"},
    "bridge_span":    {"name": "교량 경간", "desc": "교각2+주형보+슬래브"},
    "incheon_bridge": {"name": "인천대교",  "desc": "사장교 케이블+교각+상판 33개 요소"},
    "leaning_tower":  {"name": "피사의 사탑","desc": "5층 팔각형 기울어진 탑"},
    "eiffel_tower":   {"name": "에펠탑",    "desc": "3층 철골 타워+첨탑"},
    "pyramid":        {"name": "피라미드",  "desc": "9단 계단식 슬래브"},
}


@tool
def create_composite_structure(
    project_id: str,
    composite_type: str,
    base_x: float = 0.0,
    base_y: float = 0.0,
    base_z: float = 0.0,
) -> str:
    """
    복합 구조물을 BIM 프로젝트에 일괄 생성합니다.

    composite_type 선택지:
      pier           → 교각 구조 (기초+기둥+캡보, 4요소)
      building_frame → 건물 골조 (슬래브+기둥+보, 9요소)
      bridge_span    → 교량 경간 (교각+주형+슬래브, 8요소)
      incheon_bridge → 인천대교 사장교 (33요소)
      leaning_tower  → 피사의 사탑 (46요소)
      eiffel_tower   → 에펠탑 (20요소)
      pyramid        → 이집트 피라미드 (9요소)

    base_x/y/z: 구조물 기준점 좌표 (기본 0, 0, 0)
    """
    # 실제 요소 데이터는 Spring Boot 에서 composite type 기반으로 처리
    payload = {
        "projectId":     project_id,
        "compositeType": composite_type,
        "baseX":         round(float(base_x), 3),
        "baseY":         round(float(base_y), 3),
        "baseZ":         round(float(base_z), 3),
    }
    try:
        res = httpx.post(f"{SPRING_BASE_URL}/api/bim/composite", json=payload, timeout=30)
        res.raise_for_status()
        tmpl = _COMPOSITE_TEMPLATES.get(composite_type, {})
        return json.dumps({
            "success":       True,
            "compositeType": composite_type,
            "name":          tmpl.get("name", composite_type),
            "message":       f"{tmpl.get('name', composite_type)} 구조물 생성 완료",
        }, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})


@tool
def get_drone_analysis_info() -> str:
    """
    드론 사진 분석 기능에 대한 설명을 반환합니다.
    드론 탭의 기능, 사용법, 지원 포맷 등을 안내합니다.
    BIM 탭 → '드론 사진 분석' 버튼으로 접근합니다.
    """
    info = {
        "feature": "드론 사진 → 2D 도면 · BIM 변환",
        "description": (
            "항공 사진에서 등고선·토공량을 자동 분석하고 BIM 프로젝트로 변환합니다. "
            "Gaussian Blur + Marching Squares 알고리즘으로 등고선을 추출합니다."
        ),
        "supported_formats": ["JPG", "PNG", "TIFF", "WebP"],
        "recommended_input": "정사영상(Orthophoto) / DSM / DEM",
        "steps": [
            "1. BIM 탭 상단 '드론 사진 분석' 버튼 클릭",
            "2. 항공 사진 업로드 (드래그 또는 클릭)",
            "3. 실세계 크기(가로·세로 m), 고도 범위(최저·최고) 설정",
            "4. 등고선 간격·해상도 설정 후 '분석 시작' 클릭",
            "5. 분석 결과 확인: 등고선 도면, 토공량(절토/성토) 계산",
            "6. 'BIM 프로젝트로 변환' 으로 폴리라인 BIM 프로젝트 생성",
        ],
        "output": "등고선 도면 + 토공량 + BIM 프로젝트 자동 생성",
        "spring_api": "/api/drone/analyze",
    }
    return json.dumps(info, ensure_ascii=False)


@tool
def get_structural_analysis(project_id: str) -> str:
    """
    특정 BIM 프로젝트의 구조 해석 결과를 조회합니다.
    하중 분배, 부재 응력, 처짐 추정치를 반환합니다.
    결과가 없으면 안내 메시지를 반환합니다.
    """
    try:
        res = httpx.get(
            f"{SPRING_BASE_URL}/api/bim/structural/{project_id}",
            timeout=15,
        )
        res.raise_for_status()
        data = res.json()
        return json.dumps(data, ensure_ascii=False)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            return json.dumps({
                "available": False,
                "message": (
                    f"프로젝트 {project_id} 의 구조 해석 결과가 없습니다. "
                    "BIM 뷰어에서 '구조 해석' 탭을 열어 계산을 실행하세요."
                ),
            }, ensure_ascii=False)
        return json.dumps({"available": False, "error": str(e)})
    except Exception as e:
        return json.dumps({"available": False, "error": str(e)})


@tool
def get_ifc_import_guide() -> str:
    """
    IFC 파일 가져오기 기능에 대한 안내를 반환합니다.
    Revit, Civil3D, ArchiCAD 등에서 내보낸 IFC 파일을 가져오는 방법을 설명합니다.
    """
    guide = {
        "feature":     "IFC 프로젝트 가져오기",
        "description": "Revit, Civil3D, IFC 2x3/IFC4 파일을 3D BIM 뷰어로 가져옵니다.",
        "supported":   ["IFC 2x3", "IFC 4", "Revit IFC", "Civil3D IFC", "ArchiCAD IFC"],
        "max_size":    "20 MB",
        "steps": [
            "1. BIM 프로젝트 목록 상단 '📥 IFC 프로젝트 추가' 버튼 클릭",
            "2. .ifc 파일 드래그 또는 클릭 선택",
            "3. 프로젝트 이름·구조 유형 입력",
            "4. '분석 중...' → 요소 감지 완료 후 '📥 가져오기' 클릭",
            "5. BIM 뷰어에서 3D 모델 확인 (카메라 자동 맞춤)",
        ],
        "unit_handling": "mm/cm 단위 IFC 파일은 자동으로 m 로 변환됩니다.",
        "spring_api":    "/api/bim/ifc/import",
        "notes": [
            "카메라 맞춤 버튼(⊡)으로 모델 전체를 화면에 맞출 수 있습니다.",
            "TOP/ISO/FRT 등 뷰 프리셋 버튼으로 표준 BIM 뷰를 전환할 수 있습니다.",
        ],
    }
    return json.dumps(guide, ensure_ascii=False)


# ── 도구 목록 ──────────────────────────────────────────────────────────────────
BIM_TOOLS = [
    list_bim_projects,
    get_bim_stats,
    create_bim_element,
    delete_bim_element,
    create_bim_project,
    create_composite_structure,
    get_drone_analysis_info,
    get_structural_analysis,
    get_ifc_import_guide,
]
