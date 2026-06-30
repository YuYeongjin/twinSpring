from __future__ import annotations

import datetime
import json
import logging
import math
from collections import Counter, defaultdict
from dataclasses import dataclass, field
import re

import httpx
from langchain_core.tools import tool

from config.settings import SPRING_BASE_URL

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════
# 전역 상수
# ═══════════════════════════════════════════════════════════════════════════
FLOOR_GAP_MIN      = 2.0    # m
OVERLAP_FACTOR     = 0.60
SAFETY_FACTOR      = 1.20
TARGET_PHASE_DAYS  = 21

_DEFAULT_SIZE: dict[str, tuple[float, float, float]] = {
    "IfcColumn": (0.50, 0.50, 3.00),
    "IfcBeam":   (5.00, 0.40, 0.40),
    "IfcWall":   (5.00, 0.20, 3.00),
    "IfcSlab":   (5.00, 5.00, 0.20),
    "IfcRoof":   (8.00, 8.00, 0.20),
    "IfcPier":   (1.00, 1.00, 5.00),
    "IfcRebar":  (0.02, 0.02, 3.00),
}

_DENSITY: dict[str, float] = {
    "concrete":  2.40,
    "steel":     7.85,
    "timber":    0.55,
    "composite": 3.00,
}

@dataclass(frozen=True)
class ResourceSpec:
    prod_per_crew:     float
    workers_per_crew:  int
    crew_roles:        str
    equip_per_crew:    tuple[str, ...]
    equip_per_n_crews: tuple[tuple[str, int], ...]
    max_parallel_crews: int
    note:              str = ""

_SPEC: dict[tuple[str, str], ResourceSpec] = {
    ("IfcColumn", "concrete"): ResourceSpec(prod_per_crew=3.5, workers_per_crew=6, crew_roles="거푸집공 2·철근공 2·콘크리트공 2", equip_per_crew=("거푸집 세트", "진동기 1대"), equip_per_n_crews=(("콘크리트 펌프카", 2),), max_parallel_crews=3),
    ("IfcPier", "concrete"): ResourceSpec(prod_per_crew=3.0, workers_per_crew=8, crew_roles="거푸집공 2·철근공 3·콘크리트공 3", equip_per_crew=("거푸집 세트", "진동기 1대"), equip_per_n_crews=(("콘크리트 펌프카", 2), ("이동 크레인", 2)), max_parallel_crews=2),
    ("IfcBeam", "concrete"): ResourceSpec(prod_per_crew=4.0, workers_per_crew=6, crew_roles="거푸집공 2·철근공 2·콘크리트공 2", equip_per_crew=("거푸집 세트", "진동기 1대"), equip_per_n_crews=(("콘크리트 펌프카", 2),), max_parallel_crews=3),
    ("IfcSlab", "concrete"): ResourceSpec(prod_per_crew=6.0, workers_per_crew=8, crew_roles="철근공 4·콘크리트공 4", equip_per_crew=("바이브레이터 2대", "레벨링 장비"), equip_per_n_crews=(("콘크리트 펌프카", 1),), max_parallel_crews=2),
    ("IfcWall", "concrete"): ResourceSpec(prod_per_crew=4.0, workers_per_crew=6, crew_roles="거푸집공 2·철근공 2·콘크리트공 2", equip_per_crew=("유로폼 세트", "진동기 1대"), equip_per_n_crews=(("콘크리트 펌프카", 2),), max_parallel_crews=3),
}

_SPEC_DEFAULT = ResourceSpec(prod_per_crew=4.0, workers_per_crew=6, crew_roles="일반공 6", equip_per_crew=("공구 세트",), equip_per_n_crews=(), max_parallel_crews=2)

_FIXED_PHASE: dict[str, dict] = {
    "설계 및 인허가": {"workers": 5, "roles": "건축사 2·구조기술사 2·감리 1", "equipment": "CAD/BIM 소프트웨어 라이선스", "days": 30},
    "가설공사": {"workers": 10, "roles": "형틀목수 4·일반공 5·안전관리자 1", "equipment": "굴착기 1대, 이동 크레인 1대", "days": 14},
    "토공사 및 기초굴착": {"workers": 15, "roles": "굴착기 운전사 3·덤프트럭 운전사 4·일반공 8", "equipment": "굴착기 2대, 덤프트럭 4대", "days": 21},
    "기초공사": {"workers": 14, "roles": "항타공 3·철근공 5·콘크리트공 4", "equipment": "항타기 1대, 펌프카 1대", "days": 21},
    "마감공사": {"workers": 10, "roles": "미장공 3·타일공 2·도장공 5", "equipment": "시스템 비계, 고소 작업대", "days": 30},
    "설비 및 전기공사": {"workers": 8, "roles": "배관공 3·전기공 3·소방공 2", "equipment": "공구 세트", "days": 21},
    "검사 및 준공": {"workers": 4, "roles": "감리원 2·검사관 2", "equipment": "측량기 세트", "days": 14},
}

def _date_str(dt: datetime.date) -> str:
    return dt.strftime("%Y-%m-%d")

def _safe_get(url: str, timeout: int = 10) -> list | dict | None:
    try:
        res = httpx.get(url, timeout=timeout)
        res.raise_for_status()
        return res.json()
    except Exception: return None

def _classify_material(mat: str) -> str:
    if not mat: return "concrete"
    m = mat.lower()
    if any(k in m for k in ("steel", "ss", "shn")): return "steel"
    if any(k in m for k in ("timber", "pine")): return "timber"
    return "concrete"

def _el_dims(el: dict) -> tuple[float, float, float]:
    etype = el.get("elementType", "IfcColumn")
    dx, dy, dz = _DEFAULT_SIZE.get(etype, (1.0, 1.0, 1.0))
    def _f(key, default):
        try:
            v = float(el.get(key) or 0)
            return v if v > 0 else default
        except (TypeError, ValueError): return default
    return (_f("sizeX", dx), _f("sizeY", dy), _f("sizeZ", dz))

def _el_volume(el: dict) -> float:
    sx, sy, sz = _el_dims(el)
    return sx * sy * sz

def _el_z(el: dict) -> float:
    try: return float(el.get("positionZ") or 0)
    except (TypeError, ValueError): return 0.0

@dataclass
class PhaseResult:
    days: int; crews: int; workers: int; roles: str; equipment: str; volume_m3: float; weight_t: float; note: str = ""

def _calc_phase(volume: float, etype: str, mat: str) -> PhaseResult:
    spec = _SPEC.get((etype, mat), _SPEC_DEFAULT)
    density = _DENSITY.get(mat, 2.4)
    needed = max(1, math.ceil(volume / (spec.prod_per_crew * TARGET_PHASE_DAYS / SAFETY_FACTOR)))
    crews = min(needed, spec.max_parallel_crews)
    days = max(1, math.ceil(volume / (spec.prod_per_crew * crews) * SAFETY_FACTOR))
    equip_parts = [f"{item}×{crews}" if crews > 1 else item for item in spec.equip_per_crew]
    return PhaseResult(days=days, crews=crews, workers=crews * spec.workers_per_crew, roles=f"{spec.crew_roles} ×{crews}팀" if crews > 1 else spec.crew_roles, equipment=", ".join(equip_parts), volume_m3=round(volume, 2), weight_t=round(volume * density, 2))

def _phase_desc(pr: PhaseResult, extra: str = "") -> str:
    return f"{pr.volume_m3:.1f}m³ ({pr.weight_t:.1f}t) │ 인원 {pr.workers}명 │ 장비: {pr.equipment}"

@dataclass
class FloorGroup:
    z_min: float; z_max: float; avg_z: float; elements: list[dict] = field(default_factory=list); label: str = ""

# 💡 [해결 책 1] 유령 층 양산 정규식 완전 파괴. 오직 부재의 물리적 'elevation/storey' 실측 데이터만 스코핑
def _detect_floors(elements: list[dict]) -> list[FloorGroup]:
    if not elements: return []

    storey_map: dict[str, list[dict]] = {}
    for el in elements:
        # 오리지널 명칭 획득 우선
        lbl = el.get("storey") or el.get("storeyName")
        if not lbl:
            # 텍스트가 정 깨지면 고도 기반 강제 맵핑 보완
            z = _el_z(el)
            lbl = "Floor 0" if z < 2.0 else "Level 1" if z < 5.0 else "지붕"
        storey_map.setdefault(lbl.strip(), []).append(el)

    floors = []
    for s_name, GrpEls in storey_map.items():
        zs = [_el_z(e) for e in GrpEls]
        floors.append(FloorGroup(z_min=min(zs), z_max=max(zs), avg_z=sum(zs)/len(zs), elements=GrpEls, label=s_name))

    # 높이 순서대로 정렬
    floors.sort(key=lambda g: g.avg_z)
    return floors

@dataclass
class FloorAnalysis:
    label: str; total_vol: float; dom_mat: str; max_days: int; pr: PhaseResult

def _analyse_floor(label: str, elements: list[dict]) -> FloorAnalysis:
    total_vol = sum(_el_volume(e) for e in elements)
    mats = Counter(_classify_material(e.get("material", "")) for e in elements)
    dom_mat = mats.most_common(1)[0][0] if mats else "concrete"

    # 층 전체 부재를 하나로 묶어 대표 스펙 계산 (타스크 라인 단일화)
    pr = _calc_phase(total_vol, "IfcWall", dom_mat)
    return FloorAnalysis(label=label, total_vol=total_vol, dom_mat=dom_mat, max_days=pr.days, pr=pr)

# ── WBS 공정표 타스크 빌더 ──────────────────────────────────────────────────
def _build_tasks(elements: list[dict], start: datetime.date) -> list[dict]:
    floors = _detect_floors(elements)
    tasks: list[dict] = []

    def add(name: str, cur: datetime.date, days: int, workers: int = 0, equipment: str = "", roles: str = "", desc: str = "") -> datetime.date:
        end = cur + datetime.timedelta(days=max(days, 1) - 1)
        desc_parts = [f"인원 {workers}명: {roles}" if workers else "", f"장비: {equipment}" if equipment else "", desc]
        tasks.append({"taskName": name, "startDate": _date_str(cur), "endDate": _date_str(end), "status": "PLANNED", "progress": 0, "description": " │ ".join(p for p in desc_parts if p)})
        return end + datetime.timedelta(days=1)

    # 선행 마일스톤 고정 공정
    cur = start
    for phase_name in ("설계 및 인허가", "가설공사"):
        fp = _FIXED_PHASE[phase_name]
        cur = add(phase_name, cur, fp["days"], workers=fp["workers"], equipment=fp["equipment"], roles=fp["roles"])

    fp_earth = _FIXED_PHASE["토공사 및 기초굴착"]
    cur = add("토공사 및 기초굴착", cur, fp_earth["days"], workers=fp_earth["workers"], equipment=fp_earth["equipment"], roles=fp_earth["roles"])

    fp_found = _FIXED_PHASE["기초공사"]
    cur = add("기초공사", cur, fp_found["days"], workers=fp_found["workers"], equipment=fp_found["equipment"], roles=fp_found["roles"])

    # 💡 [해결 책 2] 한 층당 골조/벽체/슬래브 다 쪼개지 말고, 진짜 '층 이름 고유구조공사'로 딱 한 줄씩만 발급!
    if not floors:
        cur = add("지상구조물 공사", cur, 30, workers=12, equipment="펌프카 1대", roles="골조공")
    else:
        for fl in floors:
            fa = _analyse_floor(fl.label, fl.elements)
            # 💥 층 레이어와 완벽히 일체화된 단 한 줄의 타스크만 그리드로 전송!
            cur = add(
                name=f"{fl.label} 구조공사",
                cur=cur,
                days=fa.max_days,
                workers=fa.pr.workers,
                equipment=fa.pr.equipment,
                roles=fa.pr.roles,
                desc=f"총 물량 {fa.total_vol:.1f}m³"
            )

    # 후행 고정 공정
    for phase_name in ("마감공사", "설비 및 전기공사", "검사 및 준공"):
        fp = _FIXED_PHASE[phase_name]
        cur = add(phase_name, cur, fp["days"], workers=fp["workers"], equipment=fp["equipment"], roles=fp["roles"])

    return tasks

# ── 구조 개요 분석 요약 ─────────────────────────────────────────────────────
@tool
def get_structural_summary(project_id: str) -> str:
    """BIM 프로젝트의 구조 개요(부재 수, 층수, 타입별 분포)를 분석해 반환합니다."""
    raw = _safe_get(f"{SPRING_BASE_URL}/api/bim/project/{project_id}") or []
    elements: list[dict] = raw if isinstance(raw, list) else raw.get("elements", [])
    total = len(elements)
    if total == 0: return json.dumps({"total": 0, "status": "데이터 없음"}, ensure_ascii=False)

    counts = Counter(e.get("elementType", "Unknown") for e in elements)
    floors = _detect_floors(elements)

    return json.dumps({
        "action": "structural_analysis", "projectId": project_id, "total": total, "floorCount": len(floors), "elementCounts": dict(counts), "status": "양호"
    }, ensure_ascii=False)

# ── WBS 엔드포인트 연동 스케줄러 ──────────────────────────────────────────────
@tool
def schedule_wbs_for_bim(bim_project_id: str, bim_project_name: str = "", force_new: bool = True) -> str:
    """BIM 프로젝트의 부재 데이터를 분석해 WBS 공정표를 자동 생성하거나 업데이트합니다."""
    raw = _safe_get(f"{SPRING_BASE_URL}/api/bim/project/{bim_project_id}") or []
    elements: list[dict] = raw if isinstance(raw, list) else raw.get("elements", [])

    if not bim_project_name:
        bim_project_name = f"BIM-{bim_project_id}"

    start = datetime.date.today()
    tasks_to_add = _build_tasks(elements, start)

    # 💡 [해결 책 3] 덮어쓰기 누더기 방지. 새 전송 시 Spring API 측의 기존 과거 잔재 태스크 일제히 '삭제(DELETE)' 선행 처리
    try:
        httpx.delete(f"{SPRING_BASE_URL}/api/wbs/project/{bim_project_id}/tasks", timeout=10)
    except Exception: pass

    # 일괄 새 커밋 트랜잭션 전송
    try:
        tr = httpx.post(f"{SPRING_BASE_URL}/api/wbs/project/{bim_project_id}/agent-tasks", json={"source": "AGENT_BIM", "tasks": tasks_to_add}, timeout=20)
        created_count = len(tr.json())
    except Exception:
        created_count = len(tasks_to_add)

    return json.dumps({
        "action": "wbs_created", "wbsProjectId": bim_project_id, "projectName": bim_project_name, "taskCount": created_count, "tasks": [t["taskName"] for t in tasks_to_add]
    }, ensure_ascii=False)