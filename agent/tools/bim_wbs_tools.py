"""
BIM-WBS Bridge Tools  (v3 — 물량·재료·인력·장비 통합 공기 산정)

────────────────────────────────────────────────────────────────────────────
공기 산정 원리
────────────────────────────────────────────────────────────────────────────

1. 층 감지 (Floor Detection)
   ‑ positionZ 간격 ≥ 2.0m → 새 층, avg_z < 0.5m → 지하(B1,B2…)

2. 물량 산출 (Quantity Take-off)
   ‑ 부재 부피 = sizeX × sizeY × sizeZ  (미입력 시 타입별 기본값)
   ‑ 철골 중량 = 부피 × 밀도(7.85 t/m³)

3. 크루 산정 (Crew Sizing)
   ‑ 목표 공기 21일 기준 → 필요 크루 수 자동 계산
   ‑ needed_crews = ceil(volume / (prod_per_crew × 21 / SAFETY_FACTOR))
   ‑ actual_crews  = min(needed_crews, max_parallel_crews)  ← 공간·장비 상한
   ‑ actual_days   = ceil(volume / (prod_per_crew × actual_crews) × SAFETY_FACTOR)

4. 인력·장비 산출
   ‑ 총 인원 = actual_crews × workers_per_crew
   ‑ 크루당 장비(진동기·용접기 등)는 크루 수에 비례
   ‑ 공유 장비(펌프카·타워 크레인)는 N크루당 1대로 산정

5. 층별 병렬 시공 (Overlap Factor 0.60)
   ‑ N+1층 골조 착수 = N층 골조 착수 + ceil(N층 기간 × 0.60)

6. 고정 선·후행 공정 (인력·장비 사전 정의)
   선행: 설계(5명) → 가설(10명+굴착기) → 토공(15명+굴착기·덤프트럭) → 기초
   후행: 마감(8명+비계) → 설비·전기(8명, 마감 70% 착수) → 준공(3명)
────────────────────────────────────────────────────────────────────────────
"""
from __future__ import annotations

import datetime
import json
import logging
import math
from collections import Counter, defaultdict
from dataclasses import dataclass, field

import httpx
from langchain_core.tools import tool

from config.settings import SPRING_BASE_URL

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════
# 전역 상수
# ═══════════════════════════════════════════════════════════════════════════

FLOOR_GAP_MIN      = 2.0    # m  — 이 이상 Z 간격 → 새 층
OVERLAP_FACTOR     = 0.60   # 다음 층 골조 착수 시점
SAFETY_FACTOR      = 1.20   # 공기 여유율 (기상·반입)
TARGET_PHASE_DAYS  = 21     # 크루 수 산정 기준 목표 공기 (일)

_DEFAULT_SIZE: dict[str, tuple[float, float, float]] = {
    "IfcColumn": (0.50, 0.50, 3.00),
    "IfcBeam":   (5.00, 0.40, 0.40),
    "IfcWall":   (5.00, 0.20, 3.00),
    "IfcSlab":   (5.00, 5.00, 0.20),
    "IfcPier":   (1.00, 1.00, 5.00),
    "IfcRebar":  (0.02, 0.02, 3.00),
}

_DENSITY: dict[str, float] = {
    "concrete":  2.40,
    "steel":     7.85,
    "timber":    0.55,
    "composite": 3.00,
}

# ═══════════════════════════════════════════════════════════════════════════
# ResourceSpec — 부재 종류×재료별 크루·장비 설정
# ═══════════════════════════════════════════════════════════════════════════

@dataclass(frozen=True)
class ResourceSpec:
    prod_per_crew:     float       # m³/크루·일
    workers_per_crew:  int         # 1 크루 인원
    crew_roles:        str         # 역할 요약 (display용)
    equip_per_crew:    tuple[str, ...]   # 크루당 1세트 장비
    equip_per_n_crews: tuple[tuple[str, int], ...]  # (장비명, N크루당 1대)
    max_parallel_crews: int        # 물리적 최대 동시 크루
    note:              str = ""    # 기타 메모


# (부재 타입, 재료) → ResourceSpec
_SPEC: dict[tuple[str, str], ResourceSpec] = {

    # ── 콘크리트 기둥·교각 ──────────────────────────────────────────────
    ("IfcColumn", "concrete"): ResourceSpec(
        prod_per_crew=3.5,
        workers_per_crew=6,
        crew_roles="거푸집공 2·철근공 2·콘크리트공 2",
        equip_per_crew=("거푸집 세트", "진동기 1대"),
        equip_per_n_crews=(("콘크리트 펌프카", 2),),
        max_parallel_crews=3,
    ),
    ("IfcPier", "concrete"): ResourceSpec(
        prod_per_crew=3.0,
        workers_per_crew=8,
        crew_roles="거푸집공 2·철근공 3·콘크리트공 3",
        equip_per_crew=("거푸집 세트", "진동기 1대"),
        equip_per_n_crews=(("콘크리트 펌프카", 2), ("이동 크레인", 2)),
        max_parallel_crews=2,
        note="대형 교각은 수중 콘크리트 타설 고려",
    ),

    # ── 콘크리트 보 ────────────────────────────────────────────────────
    ("IfcBeam", "concrete"): ResourceSpec(
        prod_per_crew=4.0,
        workers_per_crew=6,
        crew_roles="거푸집공 2·철근공 2·콘크리트공 2",
        equip_per_crew=("거푸집 세트", "진동기 1대"),
        equip_per_n_crews=(("콘크리트 펌프카", 2),),
        max_parallel_crews=3,
    ),

    # ── 콘크리트 슬래브 ─────────────────────────────────────────────────
    ("IfcSlab", "concrete"): ResourceSpec(
        prod_per_crew=6.0,
        workers_per_crew=8,
        crew_roles="철근공 4·콘크리트공 4",
        equip_per_crew=("바이브레이터 2대", "레벨링 장비"),
        equip_per_n_crews=(("콘크리트 펌프카", 1),),
        max_parallel_crews=2,
        note="대형 슬래브는 야간 연속 타설 검토",
    ),

    # ── 콘크리트 벽체 ────────────────────────────────────────────────────
    ("IfcWall", "concrete"): ResourceSpec(
        prod_per_crew=4.0,
        workers_per_crew=6,
        crew_roles="거푸집공 2·철근공 2·콘크리트공 2",
        equip_per_crew=("유로폼 세트", "진동기 1대"),
        equip_per_n_crews=(("콘크리트 펌프카", 2),),
        max_parallel_crews=3,
    ),

    # ── 철골 기둥 ────────────────────────────────────────────────────────
    ("IfcColumn", "steel"): ResourceSpec(
        prod_per_crew=1.5 / 7.85,   # ≈ 0.191 m³/day (= 1.5 t/day)
        workers_per_crew=5,
        crew_roles="용접공 2·조립공 2·신호수 1",
        equip_per_crew=("용접기 2대", "볼팅 공구 세트"),
        equip_per_n_crews=(("타워 크레인", 99),),  # 99 = 항상 1대 (공유)
        max_parallel_crews=2,
        note="타워 크레인 1대 공유; 크레인 양중 일정 별도 조율 필요",
    ),
    ("IfcPier", "steel"): ResourceSpec(
        prod_per_crew=1.2 / 7.85,
        workers_per_crew=6,
        crew_roles="용접공 3·조립공 2·신호수 1",
        equip_per_crew=("용접기 2대",),
        equip_per_n_crews=(("대형 이동 크레인", 99),),
        max_parallel_crews=1,
        note="해상/수중 교각 시 특수 장비 별도 검토",
    ),

    # ── 철골 보 ──────────────────────────────────────────────────────────
    ("IfcBeam", "steel"): ResourceSpec(
        prod_per_crew=2.0 / 7.85,   # ≈ 0.255 m³/day
        workers_per_crew=5,
        crew_roles="용접공 2·조립공 2·신호수 1",
        equip_per_crew=("용접기 2대", "고장력 볼트 세트"),
        equip_per_n_crews=(("타워 크레인", 99),),
        max_parallel_crews=2,
    ),

    # ── 철골 슬래브 (데크플레이트) ──────────────────────────────────────
    ("IfcSlab", "steel"): ResourceSpec(
        prod_per_crew=2.5 / 7.85,   # ≈ 0.318 m³/day
        workers_per_crew=6,
        crew_roles="데크공 3·용접공 2·신호수 1",
        equip_per_crew=("핀 용접기 1대",),
        equip_per_n_crews=(("타워 크레인", 99),),
        max_parallel_crews=2,
    ),

    # ── 철골 벽체 (커튼월·스틸 월) ──────────────────────────────────────
    ("IfcWall", "steel"): ResourceSpec(
        prod_per_crew=1.5 / 7.85,
        workers_per_crew=5,
        crew_roles="용접공 2·조립공 2·신호수 1",
        equip_per_crew=("용접기 2대",),
        equip_per_n_crews=(("이동 크레인", 2),),
        max_parallel_crews=2,
    ),

    # ── 목재 기둥·보 ────────────────────────────────────────────────────
    ("IfcColumn", "timber"): ResourceSpec(
        prod_per_crew=2.0,
        workers_per_crew=4,
        crew_roles="목수 3·신호수 1",
        equip_per_crew=("전동 공구 세트",),
        equip_per_n_crews=(("이동 크레인(25t)", 2),),
        max_parallel_crews=2,
    ),
    ("IfcBeam", "timber"): ResourceSpec(
        prod_per_crew=2.5,
        workers_per_crew=4,
        crew_roles="목수 3·신호수 1",
        equip_per_crew=("전동 공구 세트",),
        equip_per_n_crews=(("이동 크레인(25t)", 2),),
        max_parallel_crews=2,
    ),
    ("IfcSlab", "timber"): ResourceSpec(
        prod_per_crew=3.5,
        workers_per_crew=5,
        crew_roles="목수 4·신호수 1",
        equip_per_crew=("전동 공구 세트", "못 박기 총"),
        equip_per_n_crews=(),
        max_parallel_crews=2,
    ),
    ("IfcWall", "timber"): ResourceSpec(
        prod_per_crew=2.5,
        workers_per_crew=4,
        crew_roles="목수 3·신호수 1",
        equip_per_crew=("전동 공구 세트",),
        equip_per_n_crews=(),
        max_parallel_crews=2,
    ),

    # ── 복합재 (기본값 — RC 기준) ────────────────────────────────────────
    ("IfcColumn", "composite"): ResourceSpec(
        prod_per_crew=2.5,
        workers_per_crew=7,
        crew_roles="철골공 3·콘크리트공 2·조립공 2",
        equip_per_crew=("용접기 2대",),
        equip_per_n_crews=(("타워 크레인", 99), ("콘크리트 펌프카", 2)),
        max_parallel_crews=2,
    ),
    ("IfcBeam", "composite"): ResourceSpec(
        prod_per_crew=3.0,
        workers_per_crew=7,
        crew_roles="철골공 3·콘크리트공 2·조립공 2",
        equip_per_crew=("용접기 2대",),
        equip_per_n_crews=(("타워 크레인", 99), ("콘크리트 펌프카", 2)),
        max_parallel_crews=2,
    ),
    ("IfcSlab", "composite"): ResourceSpec(
        prod_per_crew=4.5,
        workers_per_crew=7,
        crew_roles="데크공 3·콘크리트공 3·신호수 1",
        equip_per_crew=("핀 용접기 1대", "바이브레이터"),
        equip_per_n_crews=(("콘크리트 펌프카", 1),),
        max_parallel_crews=2,
    ),
    ("IfcWall", "composite"): ResourceSpec(
        prod_per_crew=3.0,
        workers_per_crew=7,
        crew_roles="철골공 3·콘크리트공 2·거푸집공 2",
        equip_per_crew=("용접기 1대", "진동기 1대"),
        equip_per_n_crews=(("콘크리트 펌프카", 2),),
        max_parallel_crews=2,
    ),
}

# 기본 스펙 (매핑에 없는 경우)
_SPEC_DEFAULT = ResourceSpec(
    prod_per_crew=4.0,
    workers_per_crew=6,
    crew_roles="일반공 6",
    equip_per_crew=("공구 세트",),
    equip_per_n_crews=(),
    max_parallel_crews=2,
)

# 고정 공정별 인력·장비 (부피 무관)
_FIXED_PHASE: dict[str, dict] = {
    "설계 및 인허가": {
        "workers": 5,
        "roles":   "건축사 2·구조기술사 2·감리 1",
        "equipment": "CAD/BIM 소프트웨어 라이선스",
        "days": 30,
    },
    "가설공사": {
        "workers": 10,
        "roles":   "형틀목수 4·일반공 5·안전관리자 1",
        "equipment": "굴착기(0.6m³) 1대, 이동 크레인(25t) 1대, 컨테이너 사무소",
        "days": 14,
    },
    "토공사 및 기초굴착": {
        "workers": 15,
        "roles":   "굴착기 운전사 3·덤프트럭 운전사 4·측량사 1·일반공 7",
        "equipment": "굴착기(0.9m³) 2대, 덤프트럭(15t) 4대, 측량기, 항타기",
        "days": 21,   # 교각 없을 때 기본값
    },
    "기초공사": {
        "workers": 14,
        "roles":   "항타공 3·철근공 5·콘크리트공 4·측량사 1·안전관리자 1",
        "equipment": "항타기 1대, 콘크리트 펌프카 1대, 오거 드릴, 진동기 2대",
        "days": 21,   # 피어 기반으로 조정
    },
    "마감공사": {
        "workers": 10,
        "roles":   "미장공 3·타일공 2·도장공 2·창호공 2·안전관리자 1",
        "equipment": "시스템 비계, 믹서 1대, 고소 작업대(1~2대)",
        "days": 30,   # 면적 기반으로 조정
    },
    "설비 및 전기공사": {
        "workers": 8,
        "roles":   "배관공 3·전기공 3·소방공 2",
        "equipment": "배관·전기 공구 세트, 고소 작업차 1대",
        "days": 21,
    },
    "검사 및 준공": {
        "workers": 4,
        "roles":   "감리원 2·검사관 1·측량사 1",
        "equipment": "측량기, 내화 시험 장비, 열화상 카메라",
        "days": 14,
    },
}

# ═══════════════════════════════════════════════════════════════════════════
# 헬퍼 함수
# ═══════════════════════════════════════════════════════════════════════════

def _date_str(dt: datetime.date) -> str:
    return dt.strftime("%Y-%m-%d")


def _safe_get(url: str, timeout: int = 10) -> list | dict | None:
    try:
        res = httpx.get(url, timeout=timeout)
        res.raise_for_status()
        return res.json()
    except Exception:
        logger.warning("[bim_wbs] GET %s 실패", url, exc_info=True)
        return None


def _classify_material(mat: str) -> str:
    if not mat:
        return "concrete"
    m = mat.lower()
    if any(k in m for k in ("steel", "ss", "shn", "grade", "stainless")):
        return "steel"
    if any(k in m for k in ("timber", "pine", "oak", "glulam", "clt", "lvl")):
        return "timber"
    if any(k in m for k in ("composite", "frp", "carbon", "fiber")):
        return "composite"
    return "concrete"


def _el_dims(el: dict) -> tuple[float, float, float]:
    etype = el.get("elementType", "IfcColumn")
    dx, dy, dz = _DEFAULT_SIZE.get(etype, (1.0, 1.0, 1.0))

    def _f(key, default):
        try:
            v = float(el.get(key) or 0)
            return v if v > 0 else default
        except (TypeError, ValueError):
            return default

    return (_f("sizeX", dx), _f("sizeY", dy), _f("sizeZ", dz))


def _el_volume(el: dict) -> float:
    sx, sy, sz = _el_dims(el)
    return sx * sy * sz


def _el_z(el: dict) -> float:
    try:
        return float(el.get("positionZ") or 0)
    except (TypeError, ValueError):
        return 0.0


# ── 핵심: 크루 산정 + 인력·장비 계산 ─────────────────────────────────────────

@dataclass
class PhaseResult:
    days:      int
    crews:     int
    workers:   int
    roles:     str
    equipment: str
    volume_m3: float
    weight_t:  float
    note:      str = ""


def _calc_phase(volume: float, etype: str, mat: str) -> PhaseResult:
    """
    부피·부재 타입·재료 → 크루 수 자동 산정 후 공기·인력·장비 반환.
    """
    spec = _SPEC.get((etype, mat), _SPEC_DEFAULT)
    density = _DENSITY.get(mat, 2.4)

    # 크루 수 결정
    needed = max(1, math.ceil(
        volume / (spec.prod_per_crew * TARGET_PHASE_DAYS / SAFETY_FACTOR)
    ))
    crews   = min(needed, spec.max_parallel_crews)
    days    = max(1, math.ceil(volume / (spec.prod_per_crew * crews) * SAFETY_FACTOR))
    workers = crews * spec.workers_per_crew

    # 장비 목록 조합
    equip_parts: list[str] = []
    for item in spec.equip_per_crew:
        equip_parts.append(f"{item}×{crews}" if crews > 1 else item)
    for item_name, per_n in spec.equip_per_n_crews:
        count = max(1, math.ceil(crews / per_n))
        equip_parts.append(f"{item_name} {count}대")

    return PhaseResult(
        days=days,
        crews=crews,
        workers=workers,
        roles=f"{spec.crew_roles} ×{crews}팀" if crews > 1 else spec.crew_roles,
        equipment=", ".join(equip_parts) if equip_parts else "일반 공구",
        volume_m3=round(volume, 2),
        weight_t=round(volume * density, 2),
        note=spec.note,
    )


def _phase_desc(pr: PhaseResult, extra: str = "") -> str:
    """WBS task description 문자열 생성."""
    parts = [
        f"{pr.volume_m3:.1f}m³",
        f"({pr.weight_t:.1f}t)",
        f"│ 인원 {pr.workers}명({pr.crews}팀): {pr.roles}",
        f"│ 장비: {pr.equipment}",
    ]
    if pr.note:
        parts.append(f"│ ※{pr.note}")
    if extra:
        parts.append(f"│ {extra}")
    return " ".join(parts)


# ── 층 감지 ──────────────────────────────────────────────────────────────────

@dataclass
class FloorGroup:
    z_min: float
    z_max: float
    avg_z: float
    elements: list[dict] = field(default_factory=list)


def _detect_floors(elements: list[dict]) -> list[FloorGroup]:
    if not elements:
        return []
    sorted_els = sorted(elements, key=_el_z)
    groups: list[list[dict]] = [[sorted_els[0]]]
    for el in sorted_els[1:]:
        if _el_z(el) - _el_z(groups[-1][-1]) >= FLOOR_GAP_MIN:
            groups.append([el])
        else:
            groups[-1].append(el)
    floors = []
    for grp in groups:
        zs = [_el_z(e) for e in grp]
        floors.append(FloorGroup(
            z_min=min(zs), z_max=max(zs),
            avg_z=sum(zs) / len(zs),
            elements=grp,
        ))
    return floors


def _floor_label(idx: int, all_floors: list[FloorGroup]) -> str:
    above = [i for i, f in enumerate(all_floors) if f.avg_z >= 0.5]
    below = [i for i, f in enumerate(all_floors) if f.avg_z < 0.5]
    if idx in above:
        return f"{above.index(idx) + 1}층"
    n = len(below) - below.index(idx)
    return f"B{n}"


# ── 층별 분석 ─────────────────────────────────────────────────────────────────

@dataclass
class FloorAnalysis:
    label:     str
    frame:     PhaseResult | None   # 기둥+보+교각 합산
    slab:      PhaseResult | None
    wall:      PhaseResult | None
    dom_mat:   str
    total_workers: int
    total_equipment: str


def _analyse_floor(label: str, elements: list[dict]) -> FloorAnalysis:
    """층 내 부재를 타입×재료별로 집계해 각 공정 PhaseResult 계산."""

    # 타입별 재료별 부피 합산
    vol_by: dict[tuple[str, str], float] = defaultdict(float)
    for el in elements:
        etype = el.get("elementType", "Unknown")
        if etype not in ("IfcColumn", "IfcBeam", "IfcSlab", "IfcWall", "IfcPier"):
            continue
        mat = _classify_material(el.get("material", ""))
        vol_by[(etype, mat)] += _el_volume(el)

    # 골조(기둥+보+교각): 지배 재료로 통합 후 PhaseResult 계산
    frame_types = ("IfcColumn", "IfcBeam", "IfcPier")
    frame_vols: dict[str, float] = defaultdict(float)
    for (et, mat), vol in vol_by.items():
        if et in frame_types:
            frame_vols[mat] += vol

    frame_pr: PhaseResult | None = None
    if frame_vols:
        dom_frame_mat = max(frame_vols, key=frame_vols.get)
        # 골조 내 가장 느린 부재가 병목 → 대표 타입은 IfcColumn 사용
        frame_pr = _calc_phase(sum(frame_vols.values()), "IfcColumn", dom_frame_mat)

    # 슬래브
    slab_vols: dict[str, float] = defaultdict(float)
    for (et, mat), vol in vol_by.items():
        if et == "IfcSlab":
            slab_vols[mat] += vol
    slab_pr: PhaseResult | None = None
    if slab_vols:
        dom_slab_mat = max(slab_vols, key=slab_vols.get)
        slab_pr = _calc_phase(sum(slab_vols.values()), "IfcSlab", dom_slab_mat)

    # 벽체
    wall_vols: dict[str, float] = defaultdict(float)
    for (et, mat), vol in vol_by.items():
        if et == "IfcWall":
            wall_vols[mat] += vol
    wall_pr: PhaseResult | None = None
    if wall_vols:
        dom_wall_mat = max(wall_vols, key=wall_vols.get)
        wall_pr = _calc_phase(sum(wall_vols.values()), "IfcWall", dom_wall_mat)

    # 전체 지배 재료
    all_vols: dict[str, float] = defaultdict(float)
    for (_, mat), vol in vol_by.items():
        all_vols[mat] += vol
    dom_mat = max(all_vols, key=all_vols.get) if all_vols else "concrete"

    # 총 인원·장비 요약
    phases = [p for p in (frame_pr, slab_pr, wall_pr) if p]
    total_workers = sum(p.workers for p in phases)
    # 장비 중복 제거 (타워 크레인 등 공유 장비 단 1회 표시)
    equip_set: dict[str, int] = {}
    for p in phases:
        for item in p.equipment.split(", "):
            # "타워 크레인 1대" 형식 파싱
            name = item.rsplit(" ", 1)[0]
            try:
                cnt = int(item.rsplit(" ", 1)[-1].replace("대", ""))
            except ValueError:
                cnt = 1
            equip_set[name] = max(equip_set.get(name, 0), cnt)
    equip_str = ", ".join(
        f"{n} {c}대" if c > 1 else n
        for n, c in equip_set.items()
    )

    return FloorAnalysis(
        label=label,
        frame=frame_pr,
        slab=slab_pr,
        wall=wall_pr,
        dom_mat=dom_mat,
        total_workers=total_workers,
        total_equipment=equip_str,
    )


# ═══════════════════════════════════════════════════════════════════════════
# Tool 1: 구조 안정성 개요 (물량·층·재료 포함)
# ═══════════════════════════════════════════════════════════════════════════

@tool
def get_structural_summary(project_id: str) -> str:
    """
    BIM 프로젝트의 부재를 층별·재료별로 분석해 구조 안정성 개요를 반환합니다.
    project_id: BIM 프로젝트 ID
    """
    raw = _safe_get(f"{SPRING_BASE_URL}/api/bim/project/{project_id}") or []
    elements: list[dict] = raw if isinstance(raw, list) else raw.get("elements", [])

    total = len(elements)
    if total == 0:
        return json.dumps({
            "action": "structural_analysis", "projectId": project_id,
            "total": 0, "status": "데이터 없음",
            "warnings": ["부재 데이터가 없습니다. BIM 에디터에서 부재를 먼저 등록하세요."],
        }, ensure_ascii=False)

    counts  = Counter(e.get("elementType", "Unknown") for e in elements)
    floors  = _detect_floors(elements)

    # ── 재료·타입별 물량 ──────────────────────────────────────────────
    vol_mat:  dict[str, float] = defaultdict(float)
    vol_type: dict[str, float] = defaultdict(float)
    for el in elements:
        etype = el.get("elementType", "Unknown")
        mat   = _classify_material(el.get("material", ""))
        vol   = _el_volume(el)
        vol_mat[mat]   += vol
        vol_type[etype] += vol

    concrete_m3 = vol_mat.get("concrete", 0)
    steel_m3    = vol_mat.get("steel", 0)
    steel_t     = steel_m3 * _DENSITY["steel"]

    # ── 구조 시스템 판별 ──────────────────────────────────────────────
    col_n  = counts.get("IfcColumn", 0)
    beam_n = counts.get("IfcBeam",   0)
    wall_n = counts.get("IfcWall",   0)
    slab_n = counts.get("IfcSlab",   0)
    pier_n = counts.get("IfcPier",   0)

    dom_mat = max(vol_mat, key=vol_mat.get) if vol_mat else "concrete"
    if dom_mat == "steel":
        struct_sys = "철골 골조 (Steel Frame)"
    elif wall_n > (col_n + beam_n):
        struct_sys = "전단벽 구조 (Shear Wall)"
    else:
        struct_sys = "철근콘크리트 골조 (RC Frame)"

    # ── 경고 ─────────────────────────────────────────────────────────
    warnings: list[str] = []
    if col_n == 0 and pier_n == 0:
        warnings.append("수직 하중 부재(기둥/교각) 없음 — 하중 전달 경로 확인 필요.")
    if beam_n == 0 and slab_n == 0:
        warnings.append("수평 부재(보/슬래브) 없음 — 층간 하중 전달 불가.")
    if col_n > 0 and beam_n > 0 and beam_n / col_n < 0.5:
        warnings.append(f"보/기둥 비율 {beam_n/col_n:.1f} < 0.5 — 측면 강성 검토 권장.")
    slender = sum(
        1 for e in elements
        if e.get("elementType") == "IfcColumn"
        and min(_el_dims(e)[:2]) > 0
        and _el_dims(e)[2] / min(_el_dims(e)[:2]) > 20
    )
    if slender:
        warnings.append(f"세장비 > 20 기둥 {slender}개 — 좌굴 검토 필요.")

    # ── 층별 요약 ────────────────────────────────────────────────────
    floor_summaries = []
    for i, fl in enumerate(floors):
        lbl = _floor_label(i, floors)
        fa  = _analyse_floor(lbl, fl.elements)
        floor_summaries.append({
            "floor":   lbl,
            "count":   len(fl.elements),
            "mat":     fa.dom_mat,
            "workers": fa.total_workers,
            "equipment": fa.total_equipment,
            "frame_days":  fa.frame.days if fa.frame else 0,
            "slab_days":   fa.slab.days  if fa.slab  else 0,
            "wall_days":   fa.wall.days  if fa.wall  else 0,
        })

    return json.dumps({
        "action":       "structural_analysis",
        "projectId":    project_id,
        "total":        total,
        "floorCount":   len(floors),
        "structSystem": struct_sys,
        "dominantMat":  dom_mat,
        "elementCounts": dict(counts),
        "volumes": {
            "concrete_m3": round(concrete_m3, 2),
            "steel_m3":    round(steel_m3, 2),
            "steel_t":     round(steel_t, 2),
        },
        "floors":   floor_summaries,
        "status":   "경고" if warnings else "양호",
        "warnings": warnings,
        "summary": (
            f"{len(floors)}개 층, 총 {total}개 부재 | {struct_sys} | "
            f"콘크리트 {concrete_m3:.1f}m³ / 철골 {steel_t:.1f}t"
        ),
    }, ensure_ascii=False)


# ═══════════════════════════════════════════════════════════════════════════
# Tool 2: WBS 스케줄 생성/업데이트 (인력·장비 포함)
# ═══════════════════════════════════════════════════════════════════════════

def _build_tasks(elements: list[dict], start: datetime.date) -> list[dict]:
    """BIM 부재 → 층별·물량·인력·장비 기반 WBS 공정 목록."""
    floors = _detect_floors(elements)
    tasks:  list[dict] = []

    def add(name: str, cur: datetime.date, days: int,
            workers: int = 0, equipment: str = "",
            roles: str = "", desc: str = "") -> datetime.date:
        end = cur + datetime.timedelta(days=max(days, 1) - 1)
        desc_parts = [f"인원 {workers}명: {roles}" if workers else "",
                      f"장비: {equipment}" if equipment else "",
                      desc]
        tasks.append({
            "taskName":    name,
            "startDate":  _date_str(cur),
            "endDate":    _date_str(end),
            "status":     "PLANNED",
            "progress":   0,
            "description": " │ ".join(p for p in desc_parts if p),
        })
        return end + datetime.timedelta(days=1)

    # ── 선행 고정 공정 ───────────────────────────────────────────────
    cur = start
    for phase_name in ("설계 및 인허가", "가설공사"):
        fp = _FIXED_PHASE[phase_name]
        cur = add(phase_name, cur, fp["days"],
                  workers=fp["workers"], equipment=fp["equipment"], roles=fp["roles"])

    # 토공사: 교각 물량 기반
    pier_els  = [e for e in elements if e.get("elementType") == "IfcPier"]
    pier_vol  = sum(_el_volume(e) for e in pier_els)
    pier_mat  = (
        max(
            ((_classify_material(e.get("material", "")), _el_volume(e)) for e in pier_els),
            key=lambda x: x[1],
        )[0] if pier_els else "concrete"
    )
    earth_pr  = _calc_phase(pier_vol, "IfcPier", pier_mat) if pier_vol > 0 else None
    earth_days = earth_pr.days if earth_pr else _FIXED_PHASE["토공사 및 기초굴착"]["days"]
    fp_earth  = _FIXED_PHASE["토공사 및 기초굴착"]
    extra_workers = (earth_pr.workers if earth_pr else 0)
    cur = add("토공사 및 기초굴착", cur, earth_days,
              workers=fp_earth["workers"] + extra_workers,
              equipment=fp_earth["equipment"] + (
                  f", {earth_pr.equipment}" if earth_pr else ""
              ),
              roles=fp_earth["roles"],
              desc=f"교각 {pier_vol:.1f}m³" if pier_vol else "")

    # 기초공사: 기둥+교각 체적 1.5배 (기초판 포함)
    found_els  = [e for e in elements if e.get("elementType") in ("IfcColumn", "IfcPier")]
    found_vol  = sum(_el_volume(e) for e in found_els) * 1.5
    found_mat  = "concrete"
    found_pr   = _calc_phase(found_vol, "IfcColumn", found_mat) if found_vol > 0 else None
    found_days = found_pr.days if found_pr else _FIXED_PHASE["기초공사"]["days"]
    fp_found   = _FIXED_PHASE["기초공사"]
    cur = add("기초공사", cur, found_days,
              workers=fp_found["workers"] + (found_pr.workers if found_pr else 0),
              equipment=fp_found["equipment"] + (
                  f", {found_pr.equipment}" if found_pr else ""
              ),
              roles=fp_found["roles"],
              desc=f"기초 추정물량 {found_vol:.1f}m³")

    # ── 층별 골조 공정 (overlap) ──────────────────────────────────────
    if not floors:
        cur = add("골조공사", cur, 30,
                  workers=12, equipment="콘크리트 펌프카 1대, 타워 크레인 1대",
                  roles="거푸집공 4·철근공 4·콘크리트공 4")
    else:
        frame_starts:  list[datetime.date] = []
        frame_days_arr: list[int]           = []
        floor_analyses: list[FloorAnalysis] = []

        for i, fl in enumerate(floors):
            lbl = _floor_label(i, floors)
            fa  = _analyse_floor(lbl, fl.elements)
            floor_analyses.append(fa)

            if i == 0:
                fs = cur
            else:
                fs = frame_starts[i - 1] + datetime.timedelta(
                    days=math.ceil(frame_days_arr[i - 1] * OVERLAP_FACTOR)
                )
            frame_starts.append(fs)
            frame_days_arr.append(fa.frame.days if fa.frame else 1)

        all_ends: list[datetime.date] = []
        for fa, fs, fd in zip(floor_analyses, frame_starts, frame_days_arr):
            next_day = fs

            if fa.frame and fd > 0:
                fe = fs + datetime.timedelta(days=fd - 1)
                tasks.append({
                    "taskName":    f"{fa.label} 골조공사",
                    "startDate":  _date_str(fs),
                    "endDate":    _date_str(fe),
                    "status":     "PLANNED", "progress": 0,
                    "description": _phase_desc(fa.frame),
                })
                next_day = fe + datetime.timedelta(days=1)

            slab_end = next_day
            wall_end = next_day

            if fa.slab and fa.slab.days > 0:
                se = next_day + datetime.timedelta(days=fa.slab.days - 1)
                tasks.append({
                    "taskName":    f"{fa.label} 슬래브 공사",
                    "startDate":  _date_str(next_day),
                    "endDate":    _date_str(se),
                    "status":     "PLANNED", "progress": 0,
                    "description": _phase_desc(fa.slab),
                })
                slab_end = se + datetime.timedelta(days=1)

            if fa.wall and fa.wall.days > 0:
                we = next_day + datetime.timedelta(days=fa.wall.days - 1)
                tasks.append({
                    "taskName":    f"{fa.label} 벽체공사",
                    "startDate":  _date_str(next_day),
                    "endDate":    _date_str(we),
                    "status":     "PLANNED", "progress": 0,
                    "description": _phase_desc(fa.wall),
                })
                wall_end = we + datetime.timedelta(days=1)

            all_ends.append(max(slab_end, wall_end))

        cur = max(all_ends) if all_ends else cur

    # ── 후행 고정 공정 ───────────────────────────────────────────────
    fin_area = sum(
        _el_dims(e)[0] * _el_dims(e)[1]
        for e in elements
        if e.get("elementType") in ("IfcSlab", "IfcWall")
    )
    fin_days = max(21, min(90, math.ceil(fin_area / 30)))
    fp_fin   = _FIXED_PHASE["마감공사"]
    cur = add("마감공사", cur, fin_days,
              workers=fp_fin["workers"], equipment=fp_fin["equipment"],
              roles=fp_fin["roles"],
              desc=f"마감 면적 {fin_area:.0f}m² 기준")

    # 설비·전기 — 마감 70% 시점 착수
    fin_start = datetime.date.fromisoformat(tasks[-1]["startDate"])
    mep_start = fin_start + datetime.timedelta(days=math.ceil(fin_days * 0.70))
    mep_days  = _FIXED_PHASE["설비 및 전기공사"]["days"]
    fp_mep    = _FIXED_PHASE["설비 및 전기공사"]
    mep_end   = mep_start + datetime.timedelta(days=mep_days - 1)
    tasks.append({
        "taskName":    "설비 및 전기공사",
        "startDate":  _date_str(mep_start),
        "endDate":    _date_str(mep_end),
        "status":     "PLANNED", "progress": 0,
        "description": (
            f"인원 {fp_mep['workers']}명: {fp_mep['roles']} │ 장비: {fp_mep['equipment']}"
        ),
    })

    # 준공
    close_start = max(
        datetime.date.fromisoformat(tasks[-2]["endDate"]),
        mep_end,
    ) + datetime.timedelta(days=1)
    fp_cl = _FIXED_PHASE["검사 및 준공"]
    add("검사 및 준공", close_start, fp_cl["days"],
        workers=fp_cl["workers"], equipment=fp_cl["equipment"], roles=fp_cl["roles"])

    return tasks


@tool
def schedule_wbs_for_bim(
    bim_project_id:   str,
    bim_project_name: str  = "",
    force_new:        bool = False,
) -> str:
    """
    BIM 부재를 분석해 층별·물량·인력·장비 기반 WBS 공정표를 생성하거나
    기존 WBS에 누락 공정을 보완합니다.

    bim_project_id:   BIM 프로젝트 ID (필수)
    bim_project_name: 프로젝트 이름 (WBS 이름 매칭용, 미전달 시 자동 조회)
    force_new:        True → 동일 이름 WBS가 있어도 신규 생성
    """
    # ── BIM 프로젝트 이름 ─────────────────────────────────────────────
    if not bim_project_name and bim_project_id:
        projects = _safe_get(f"{SPRING_BASE_URL}/api/bim/projects") or []
        for p in (projects if isinstance(projects, list) else []):
            if str(p.get("projectId")) == str(bim_project_id):
                bim_project_name = p.get("projectName", "")
                break
        bim_project_name = bim_project_name or f"BIM프로젝트-{bim_project_id}"

    # ── BIM 부재 조회 ─────────────────────────────────────────────────
    raw = _safe_get(f"{SPRING_BASE_URL}/api/bim/project/{bim_project_id}") or []
    elements: list[dict] = raw if isinstance(raw, list) else raw.get("elements", [])

    # ── 기존 WBS 검색 ─────────────────────────────────────────────────
    existing_wbs: dict | None = None
    if not force_new:
        wbs_list = _safe_get(f"{SPRING_BASE_URL}/api/wbs/projects") or []
        nl = bim_project_name.lower()
        for wp in (wbs_list if isinstance(wbs_list, list) else []):
            wn = (wp.get("projectName") or "").lower()
            if nl in wn or wn in nl:
                existing_wbs = wp
                break

    # ── 시작일 ───────────────────────────────────────────────────────
    start = datetime.date.today()
    if existing_wbs:
        sd = existing_wbs.get("startDate")
        if sd:
            try:
                start = datetime.date.fromisoformat(sd[:10])
            except Exception:
                pass

    tasks_to_add = _build_tasks(elements, start)
    floors       = _detect_floors(elements)

    # ── 인력 피크 요약 (리포트용) ─────────────────────────────────────
    peak_workers = 0
    for t in tasks_to_add:
        desc = t.get("description", "")
        # "인원 12명" 형식 파싱
        import re
        m = re.search(r"인원\s*(\d+)명", desc)
        if m:
            peak_workers = max(peak_workers, int(m.group(1)))

    # ── 기존 WBS 업데이트 ────────────────────────────────────────────
    if existing_wbs and not force_new:
        wbs_id = existing_wbs.get("wbsProjectId") or existing_wbs.get("projectId")
        exist_raw   = _safe_get(f"{SPRING_BASE_URL}/api/wbs/project/{wbs_id}/tasks") or []
        exist_tasks = exist_raw if isinstance(exist_raw, list) else exist_raw.get("tasks", [])
        exist_names = {(t.get("taskName") or "").strip().lower() for t in exist_tasks}

        new_tasks  = [t for t in tasks_to_add if t["taskName"].strip().lower() not in exist_names]
        skip_tasks = [t for t in tasks_to_add if t["taskName"].strip().lower() in exist_names]

        added: list[str] = []
        for task in new_tasks:
            try:
                r = httpx.post(
                    f"{SPRING_BASE_URL}/api/wbs/project/{wbs_id}/task",
                    json={**task, "wbsProjectId": str(wbs_id)},
                    timeout=10,
                )
                r.raise_for_status()
                added.append(task["taskName"])
            except Exception:
                logger.warning("[bim_wbs] task 추가 실패: %s", task["taskName"], exc_info=True)

        return json.dumps({
            "action":        "wbs_updated",
            "wbsProjectId":  str(wbs_id),
            "projectName":   existing_wbs.get("projectName"),
            "floorCount":    len(floors),
            "peakWorkers":   peak_workers,
            "added":         added,
            "skipped":       [t["taskName"] for t in skip_tasks],
            "totalExisting": len(exist_tasks),
            "totalAdded":    len(added),
        }, ensure_ascii=False)

    # ── 신규 WBS 생성 ─────────────────────────────────────────────────
    end_date = datetime.date.fromisoformat(tasks_to_add[-1]["endDate"])
    try:
        pr = httpx.post(
            f"{SPRING_BASE_URL}/api/wbs/project",
            json={
                "projectName": bim_project_name,
                "description": (
                    f"BIM [{bim_project_id}] 자동 생성 — "
                    f"{len(floors)}층 {len(elements)}개 부재, "
                    f"최대 투입 인원 {peak_workers}명"
                ),
                "startDate": _date_str(start),
                "endDate":   _date_str(end_date),
                "status":    "PLANNED",
            },
            timeout=10,
        )
        pr.raise_for_status()
        new_proj = pr.json()
        new_id   = new_proj.get("wbsProjectId") or new_proj.get("projectId")
    except Exception:
        logger.error("[bim_wbs] WBS 프로젝트 생성 실패", exc_info=True)
        return json.dumps({"action": "error", "error": "WBS 프로젝트 생성에 실패했습니다."})

    try:
        tr = httpx.post(
            f"{SPRING_BASE_URL}/api/wbs/project/{new_id}/agent-tasks",
            json={"source": "AGENT_BIM", "tasks": tasks_to_add},
            timeout=20,
        )
        tr.raise_for_status()
        created_count = len(tr.json())
    except Exception:
        logger.warning("[bim_wbs] agent-tasks 일괄 실패, 개별 등록", exc_info=True)
        created_count = 0
        for task in tasks_to_add:
            try:
                r = httpx.post(
                    f"{SPRING_BASE_URL}/api/wbs/project/{new_id}/task",
                    json={**task, "wbsProjectId": str(new_id)},
                    timeout=10,
                )
                r.raise_for_status()
                created_count += 1
            except Exception:
                pass

    return json.dumps({
        "action":       "wbs_created",
        "wbsProjectId": str(new_id),
        "projectName":  bim_project_name,
        "floorCount":   len(floors),
        "taskCount":    created_count,
        "peakWorkers":  peak_workers,
        "tasks":        [t["taskName"] for t in tasks_to_add],
        "startDate":    _date_str(start),
        "endDate":      _date_str(end_date),
        "durationDays": (end_date - start).days,
    }, ensure_ascii=False)
