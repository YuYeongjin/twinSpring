"""
Node: BIM Builder 노드 (Ollama - gemma3:12b)

다단계 대화를 지원합니다:
1. LLM으로 BIM 액션 파싱 (gemma3:12b의 강력한 한국어 이해력 활용)
2. 필요한 정보가 없으면 사용자에게 질문 (pending_action에 저장)
3. 모든 정보가 갖춰지면 Spring BIM API 호출

pending_action 내부 구조:
{
  "action": "createElement",
  "elementType": "IfcColumn",
  "material": "Concrete",
  "positionX": null,    ← 아직 모름
  "positionY": null,
  "positionZ": null,
  "sizeX": 0.5,
  "sizeY": 3.0,
  "sizeZ": 0.5,
  "projectId": "proj-001",
  "_missing": ["positionX", "positionY", "positionZ"]
}
"""

import json
import math
import re
import uuid
import httpx
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
from state import AgentState
from llm_config import llm_precise
from config import SPRING_BASE_URL

# 요소 타입별 기본 크기: (sizeX, sizeY, sizeZ) 단위: m
_DEFAULT_SIZES = {
    "IfcColumn": (0.5, 3.0, 0.5),
    "IfcBeam":   (5.0, 0.4, 0.4),
    "IfcWall":   (5.0, 3.0, 0.2),
    "IfcSlab":   (5.0, 0.2, 5.0),
    "IfcPier":   (1.0, 5.0, 1.0),
}

_TYPE_KOR = {
    "IfcColumn": "기둥",
    "IfcBeam":   "보",
    "IfcWall":   "벽",
    "IfcSlab":   "슬래브",
    "IfcPier":   "교각",
}

def _gen_leaning_tower() -> list[tuple]:
    """피사의 사탑: 5층 팔각 기둥 + 슬래브 (기울기 0.35m/층)"""
    els = []
    floors, floor_h, radius, lean = 5, 5.5, 6.5, 0.35
    for f in range(floors):
        x_off = round(f * lean, 2)
        for c in range(8):
            a = (c / 8) * math.pi * 2
            els.append((
                "IfcColumn", "Concrete C40",
                round(x_off + radius * math.cos(a), 2), f * floor_h,
                round(radius * math.sin(a), 2),
                1.0, floor_h, 1.0,
            ))
        els.append(("IfcSlab", "Concrete C35", x_off, (f + 1) * floor_h, 0.0, 15.0, 0.4, 15.0))
    # 종탑
    els.append(("IfcSlab", "Concrete C50", round(floors * lean, 2), floors * floor_h, 0.0, 7.0, 3.5, 7.0))
    return els


def _gen_pyramid() -> list[tuple]:
    """이집트 피라미드: 9단 계단식 슬래브"""
    data = [(60,0),(50,3),(40,6),(30,9),(22,12),(15,15),(10,18),(6,21),(2,24)]
    return [("IfcSlab", "Concrete C25", 0.0, y, 0.0, float(s), 3.0, float(s)) for s, y in data]


def _gen_incheon_bridge() -> list[tuple]:
    """인천대교 사장교: A형 주탑 2기 + 사장 케이블 + 접속경간 (단순화)"""
    els = []
    tX, tH, tFH = 42, 25, 1.5
    deckY, deckH = 9, 0.8
    deckCY = deckY + deckH / 2
    tTopY = tFH + tH   # 26.5
    cAttY = tTopY - 1.5  # 25

    # 주탑 기초
    for tx in [-tX, tX]:
        els.append(("IfcSlab", "Concrete C60", tx, 0, 0, 10, tFH, 18))

    # 주탑 기둥 (A형: 탑당 앞·뒤 2기)
    for tx in [-tX, tX]:
        for tz in [-4.5, 4.5]:
            els.append(("IfcColumn", "Concrete C60", tx, tFH, tz, 2, tH, 2))

    # 주탑 가로보 (상단 + 중간)
    for tx in [-tX, tX]:
        els.append(("IfcBeam", "Concrete C60", tx, tTopY - 1, 0, 1.2, 1.5, 12))
        els.append(("IfcBeam", "Concrete C60", tx, 12, 0, 1.2, 1.2, 12))

    # 주경간 상판
    els.append(("IfcSlab", "Prestressed Concrete", 0, deckY, 0, tX * 2 + 4, deckH, 16))

    # 사장 케이블 근사 — 세로 얇은 버티컬 (간략화)
    for d in [10, 20, 30, 38]:
        for side in [-1, 1]:
            h = cAttY - deckCY
            ancX_L = -tX + d
            ancX_R =  tX - d
            els.append(("IfcBeam", "Steel Grade A", ancX_L, deckCY + h * 0.5 - 0.125, side * 6.5, 0.3, h, 0.3))
            els.append(("IfcBeam", "Steel Grade A", ancX_R, deckCY + h * 0.5 - 0.125, side * 6.5, 0.3, h, 0.3))

    # 접속 교각
    for px in [-73, -58, 58, 73]:
        els.append(("IfcPier", "Concrete C50", px, 0, 0, 5, 9, 14))

    # 접속 상판
    els.append(("IfcSlab", "Prestressed Concrete", -57.5, deckY, 0, 34, deckH, 16))
    els.append(("IfcSlab", "Prestressed Concrete",  57.5, deckY, 0, 34, deckH, 16))

    return els


def _gen_eiffel_tower() -> list[tuple]:
    """에펠탑: 3층 철골 타워 + 첨탑"""
    return [
        ("IfcPier",   "Steel Grade A",  -18, 0,    -18, 3.0, 20, 3.0),
        ("IfcPier",   "Steel Grade A",   18, 0,    -18, 3.0, 20, 3.0),
        ("IfcPier",   "Steel Grade A",  -18, 0,     18, 3.0, 20, 3.0),
        ("IfcPier",   "Steel Grade A",   18, 0,     18, 3.0, 20, 3.0),
        ("IfcBeam",   "Steel Grade A",    0, 10,   -18, 39,  0.8, 0.8),
        ("IfcBeam",   "Steel Grade A",    0, 10,    18, 39,  0.8, 0.8),
        ("IfcBeam",   "Steel Grade A",  -18, 10,     0, 0.8, 0.8, 39),
        ("IfcBeam",   "Steel Grade A",   18, 10,     0, 0.8, 0.8, 39),
        ("IfcSlab",   "Steel Grade A",    0, 20,     0, 40,  0.5, 40),
        ("IfcColumn", "Steel Grade A",  -11, 20.5, -11, 2.0, 18, 2.0),
        ("IfcColumn", "Steel Grade A",   11, 20.5, -11, 2.0, 18, 2.0),
        ("IfcColumn", "Steel Grade A",  -11, 20.5,  11, 2.0, 18, 2.0),
        ("IfcColumn", "Steel Grade A",   11, 20.5,  11, 2.0, 18, 2.0),
        ("IfcSlab",   "Steel Grade A",    0, 38.5,   0, 26,  0.5, 26),
        ("IfcColumn", "Steel Grade A",   -5, 39,    -5, 1.5, 20, 1.5),
        ("IfcColumn", "Steel Grade A",    5, 39,    -5, 1.5, 20, 1.5),
        ("IfcColumn", "Steel Grade A",   -5, 39,     5, 1.5, 20, 1.5),
        ("IfcColumn", "Steel Grade A",    5, 39,     5, 1.5, 20, 1.5),
        ("IfcSlab",   "Steel Grade A",    0, 59,     0, 14,  0.5, 14),
        ("IfcColumn", "Steel Grade A",    0, 59.5,   0, 1.0, 30, 1.0),
    ]


COMPOSITE_TEMPLATES: dict[str, dict] = {
    "pier": {
        "name_kor": "교각",
        "desc": "기초 슬래브 + 양측 기둥 2개 + 상단 캡 보",
        "elements": [
            ("IfcSlab",   "Concrete",  0.0,  0.0, 0.0, 6.0, 0.5, 3.0),
            ("IfcColumn", "Concrete", -2.0,  0.5, 0.0, 0.6, 4.0, 0.6),
            ("IfcColumn", "Concrete",  2.0,  0.5, 0.0, 0.6, 4.0, 0.6),
            ("IfcBeam",   "Concrete",  0.0,  4.5, 0.0, 5.0, 0.8, 1.2),
        ],
    },
    "building_frame": {
        "name_kor": "건물 기본 골조",
        "desc": "바닥 슬래브 + 4개 기둥 + 테두리 보 4개",
        "elements": [
            ("IfcSlab",   "Concrete",  0.0,  0.0,  0.0, 8.0, 0.3, 8.0),
            ("IfcColumn", "Concrete", -3.5,  0.3, -3.5, 0.5, 3.0, 0.5),
            ("IfcColumn", "Concrete",  3.5,  0.3, -3.5, 0.5, 3.0, 0.5),
            ("IfcColumn", "Concrete", -3.5,  0.3,  3.5, 0.5, 3.0, 0.5),
            ("IfcColumn", "Concrete",  3.5,  0.3,  3.5, 0.5, 3.0, 0.5),
            ("IfcBeam",   "Steel",     0.0,  3.3, -3.5, 7.5, 0.5, 0.4),
            ("IfcBeam",   "Steel",     0.0,  3.3,  3.5, 7.5, 0.5, 0.4),
            ("IfcBeam",   "Steel",    -3.5,  3.3,  0.0, 0.4, 0.5, 7.5),
            ("IfcBeam",   "Steel",     3.5,  3.3,  0.0, 0.4, 0.5, 7.5),
        ],
    },
    "bridge_span": {
        "name_kor": "교량 경간",
        "desc": "교각 2기 + 주거더 + 상판 슬래브",
        "elements": [
            ("IfcSlab",   "Concrete",  0.0, 0.0, 0.0,  3.0, 0.4, 2.0),
            ("IfcColumn", "Concrete",  0.0, 0.4, 0.0,  0.8, 4.0, 0.8),
            ("IfcBeam",   "Concrete",  0.0, 4.4, 0.0,  3.0, 0.6, 1.0),
            ("IfcSlab",   "Concrete", 10.0, 0.0, 0.0,  3.0, 0.4, 2.0),
            ("IfcColumn", "Concrete", 10.0, 0.4, 0.0,  0.8, 4.0, 0.8),
            ("IfcBeam",   "Concrete", 10.0, 4.4, 0.0,  3.0, 0.6, 1.0),
            ("IfcBeam",   "Steel",     5.0, 5.0, 0.0, 11.0, 0.8, 0.6),
            ("IfcSlab",   "Concrete",  5.0, 5.8, 0.0, 11.5, 0.3, 3.0),
        ],
    },
    "leaning_tower": {
        "name_kor": "피사의 사탑",
        "desc": "5층 팔각 기둥 타워 · 기울기 약 3.9° · 46개 부재",
        "elements": _gen_leaning_tower(),
    },
    "eiffel_tower": {
        "name_kor": "에펠탑",
        "desc": "3층 철골 타워 · 첨탑 포함 · 20개 부재",
        "elements": _gen_eiffel_tower(),
    },
    "pyramid": {
        "name_kor": "이집트 피라미드",
        "desc": "9단 계단식 피라미드 · 층별 크기 감소 · 9개 부재",
        "elements": _gen_pyramid(),
    },
    "incheon_bridge": {
        "name_kor": "인천대교",
        "desc": "사장교 · A형 주탑 2기 + 케이블 + 접속경간 · 33개 부재",
        "elements": _gen_incheon_bridge(),
    },
}

# ── 의도 사전 분류 패턴 ─────────────────────────────────────────────

# 복합 구조물 키워드: 이것이 감지되면 createProject가 아닌 createComposite
_COMPOSITE_PAT = re.compile(
    r"피사의?\s*사탑|피사탑|에펠\s*탑?|에펠타워|피라미드|부르즈|이집트|골조|교각구조|교량경간"
    r"|인천대교|인천\s*교|사장교|케이블\s*교"
    r"|leaning.?tower|eiffel|pyramid|bridge.?span|building.?frame|incheon"
    r"|복합\s*구조|구조물\s*(생성|추가|만들)|랜드마크",
    re.IGNORECASE,
)

# 명시적 프로젝트 생성 패턴: 이것이 있을 때만 createProject 허용
_EXPLICIT_PROJECT_PAT = re.compile(
    r"(새|신규|새로운)?\s*프로젝트\s*(생성|만들|추가|새로|시작|열기)"
    r"|프로젝트\s*(이름|명칭).{0,20}(만들|생성|추가)"
    r"|create\s*project|new\s*project",
    re.IGNORECASE,
)

# 복합 구조물 타입 직접 감지 → compositeType 자동 결정
_COMPOSITE_TYPE_PAT: list[tuple[re.Pattern, str]] = [
    (re.compile(r"피사의?\s*사탑|피사탑|leaningtower|leaning.?tower", re.I), "leaning_tower"),
    (re.compile(r"에펠\s*탑?|에펠\s*타워|eiffel", re.I),                    "eiffel_tower"),
    (re.compile(r"피라미드|이집트|pyramid", re.I),                           "pyramid"),
    (re.compile(r"인천대교|인천\s*교|사장교|케이블\s*교|incheon", re.I),      "incheon_bridge"),
    (re.compile(r"교각구조?|pier", re.I),                                   "pier"),
    (re.compile(r"건물\s*골조|골조|building.?frame", re.I),                  "building_frame"),
    (re.compile(r"교량\s*경간?|교량|bridge", re.I),                          "bridge_span"),
]

def _detect_composite_type(text: str) -> str | None:
    """텍스트에서 복합 구조 타입을 직접 감지합니다."""
    for pat, ct in _COMPOSITE_TYPE_PAT:
        if pat.search(text):
            return ct
    return None


# 한국어 / 영어 별칭 → 표준 compositeType 키
_COMPOSITE_ALIAS: dict[str, str] = {
    "교각": "pier", "pier": "pier", "교각구조": "pier",
    "건물골조": "building_frame", "골조": "building_frame",
    "건물기본골조": "building_frame", "building_frame": "building_frame",
    "교량경간": "bridge_span", "교량": "bridge_span",
    "bridge_span": "bridge_span", "bridge": "bridge_span",
    # 랜드마크
    "피사의사탑": "leaning_tower", "피사탑": "leaning_tower",
    "사탑": "leaning_tower",      "leaningtower": "leaning_tower",
    "leaning_tower": "leaning_tower",
    "에펠탑": "eiffel_tower",     "에펠": "eiffel_tower",
    "eiffeltower": "eiffel_tower", "eiffel_tower": "eiffel_tower",
    "피라미드": "pyramid",        "이집트피라미드": "pyramid",
    "pyramid": "pyramid",
    # 인천대교
    "인천대교": "incheon_bridge", "인천교": "incheon_bridge",
    "사장교": "incheon_bridge",   "cable.?stayed": "incheon_bridge",
    "incheon_bridge": "incheon_bridge", "incheonbridge": "incheon_bridge",
}

# ── 시스템 프롬프트 ──────────────────────────────────────────────────

_PARSE_SYSTEM = """당신은 BIM(Building Information Modeling) 어시스턴트입니다.
사용자 메시지에서 BIM 작업을 파악하여 JSON으로만 응답하세요. 설명 없이 JSON만 출력하세요.

━━ 액션 선택 규칙 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
createElement  : 기둥/보/벽/슬래브/교각 등 단일 부재 1개 추가
createComposite: 여러 부재 조합 구조물 (교각, 골조, 교량, 피사의사탑, 에펠탑, 피라미드 등)
updateElement  : 기존 요소 속성 수정 (elementId 필수)
deleteElement  : 기존 요소 삭제 (elementId 필수)
createProject  : 새로운 BIM 프로젝트 워크스페이스 생성 — 사용자가 명시적으로 "프로젝트 생성/만들기"를 요청할 때만 사용

⚠️ 중요: "피사의사탑", "에펠탑", "피라미드", "골조", "교각" 등 구조물 이름이 나오면
   createProject 가 아닌 반드시 createComposite 을 사용하세요.

요소 타입: IfcColumn(기둥), IfcBeam(보), IfcWall(벽), IfcSlab(슬래브), IfcPier(교각)
재료: Concrete(콘크리트), Steel(철/스틸), Timber(목재/나무), Composite(합성)
복합 구조 타입(compositeType):
  pier=교각구조, building_frame=건물기본골조, bridge_span=교량경간,
  incheon_bridge=인천대교, leaning_tower=피사의사탑, eiffel_tower=에펠탑, pyramid=이집트피라미드

createElement 형식:
{{"action":"createElement","elementType":"IfcColumn","material":"Concrete","positionX":1.0,"positionY":0.0,"positionZ":2.0,"sizeX":0.5,"sizeY":3.0,"sizeZ":0.5}}

createComposite 형식:
{{"action":"createComposite","compositeType":"leaning_tower","baseX":0.0,"baseY":0.0,"baseZ":0.0}}

deleteElement  형식:
{{"action":"deleteElement","elementId":"<id>"}}

updateElement  형식:
{{"action":"updateElement","elementId":"<id>","positionX":1.0,...}}

createProject  형식:
{{"action":"createProject","projectName":"<이름>","structureType":"Steel","spanCount":3}}

위치/크기/ID를 모르면 null로 표시하세요.
JSON만 출력하세요."""

_EXTRACT_SYSTEM = """사용자 메시지에서 숫자 값을 추출하여 JSON으로만 응답하세요.
반드시 다음 필드명을 그대로 사용하세요: {fields}

규칙:
- "1, 2, 0" 또는 "1 2 0" 형태는 필드 순서({fields})대로 각각 매핑
- "x=1, y=2, z=0" 또는 "positionX=1" 형태는 해당 필드에 매핑
- 숫자를 모르면 null

출력 예시 (필드가 positionX,positionY,positionZ 이고 입력이 "1, 2, 0"인 경우):
{{"positionX":1.0,"positionY":2.0,"positionZ":0.0}}

JSON만 출력하세요."""


# ── 유틸 함수 ────────────────────────────────────────────────────────

def _extract_json(text: str) -> dict | None:
    """LLM 출력에서 JSON 객체를 추출합니다."""
    text = re.sub(r"```(?:json)?", "", text).strip().rstrip("`").strip()
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group())
    except json.JSONDecodeError:
        return None


def _parse_coords_regex(text: str, missing: list[str]) -> dict:
    """
    정규식으로 좌표 값을 추출합니다. LLM 실패 시 fallback으로 사용.
    - "1, 2, 0" / "1 2 0" → missing 순서대로 매핑
    - "x=1 y=2 z=0" / "positionX=1" / "baseX=1" 형태도 처리
    """
    result = {}
    _kv_map = {
        "x": "positionX", "y": "positionY", "z": "positionZ",
        "basex": "baseX", "basey": "baseY", "basez": "baseZ",
    }

    # "key=value" 또는 "key: value" 패턴
    kv_pattern = re.findall(
        r'(positionX|positionY|positionZ|baseX|baseY|baseZ|x|y|z)\s*[=:]\s*(-?\d+(?:\.\d+)?)',
        text, re.IGNORECASE,
    )
    for k, v in kv_pattern:
        key = _kv_map.get(k.lower(), k)
        if key in missing:
            result[key] = float(v)

    if all(f in result for f in missing):
        return result

    # 숫자만 나열된 패턴: "1, 2, 0" 또는 "1 2 0"
    # 좌표 관련 필드만 순서 매핑 (compositeType 같은 문자열 필드 제외)
    coord_missing = [f for f in missing if f not in result and f != "compositeType"]
    numbers = re.findall(r'-?\d+(?:\.\d+)?', text)
    if len(numbers) >= len(coord_missing):
        for i, field in enumerate(coord_missing):
            result[field] = float(numbers[i])

    return result


def _apply_defaults(action: dict) -> dict:
    """액션에 기본값을 적용합니다."""
    act = action.get("action")

    if act == "createElement":
        et = action.get("elementType") or "IfcColumn"
        action["elementType"] = et
        action["material"] = action.get("material") or "Concrete"
        defaults = _DEFAULT_SIZES.get(et, (0.5, 3.0, 0.5))
        if action.get("sizeX") is None:
            action["sizeX"] = defaults[0]
        if action.get("sizeY") is None:
            action["sizeY"] = defaults[1]
        if action.get("sizeZ") is None:
            action["sizeZ"] = defaults[2]

    elif act == "createComposite":
        # compositeType 한국어/별칭 정규화
        raw = (action.get("compositeType") or "").lower().replace(" ", "")
        action["compositeType"] = _COMPOSITE_ALIAS.get(raw) or action.get("compositeType")

    return action


def _find_missing_fields(action: dict) -> list[str]:
    """필수이지만 값이 없는 필드를 반환합니다."""
    act = action.get("action")
    if act == "createElement":
        return [f for f in ("positionX", "positionY", "positionZ") if action.get(f) is None]
    if act == "createComposite":
        missing = []
        if not action.get("compositeType") or action.get("compositeType") not in COMPOSITE_TEMPLATES:
            missing.append("compositeType")
        for f in ("baseX", "baseY", "baseZ"):
            if action.get(f) is None:
                missing.append(f)
        return missing
    if act == "createProject":
        return ["projectName"] if not action.get("projectName") else []
    if act in ("deleteElement", "updateElement"):
        return ["elementId"] if not action.get("elementId") else []
    return []


def _ask_for_missing(missing: list[str], action: dict) -> str:
    """누락된 필드를 요청하는 안내 메시지를 반환합니다."""
    act = action.get("action")
    if act == "createElement":
        et = action.get("elementType", "요소")
        type_kor = _TYPE_KOR.get(et, et)
        mat = action.get("material", "Concrete")
        if all(f in missing for f in ("positionX", "positionY", "positionZ")):
            return (
                f"{type_kor}({mat})을 추가하겠습니다.\n"
                f"배치할 위치의 x, y, z 좌표를 알려주세요.\n"
                f"예) 1, 0, 2  또는  x=1 y=0 z=2"
            )
        field_labels = {"positionX": "x", "positionY": "y", "positionZ": "z"}
        missing_str = ", ".join(field_labels.get(f, f) for f in missing)
        return f"{missing_str} 좌표를 알려주세요."

    if act == "createComposite":
        if "compositeType" in missing:
            types_str = "\n".join(
                f"  - {k}: {v['name_kor']} ({v['desc']})"
                for k, v in COMPOSITE_TEMPLATES.items()
            )
            return f"어떤 복합 구조물을 만들까요?\n{types_str}"
        ct = action.get("compositeType", "")
        tmpl = COMPOSITE_TEMPLATES.get(ct, {})
        name_kor = tmpl.get("name_kor", ct)
        count = len(tmpl.get("elements", []))
        return (
            f"{name_kor} 구조물을 생성하겠습니다. (부재 {count}개)\n"
            f"배치할 기준점 좌표(x, y, z)를 알려주세요.\n"
            f"예) 0, 0, 0  또는  x=5 y=0 z=3"
        )

    if act == "createProject":
        return (
            "새로운 BIM 프로젝트를 생성하겠습니다.\n"
            "프로젝트 이름을 알려주세요.\n"
            "예) 강남 오피스 빌딩, 한강대교 보수"
        )
    if act in ("deleteElement", "updateElement"):
        verb = "삭제" if act == "deleteElement" else "수정"
        return f"{verb}할 요소의 ID를 알려주세요."
    return "추가 정보를 입력해 주세요."


# ── Spring API 호출 ──────────────────────────────────────────────────

def _call_spring_api(action: dict, project_id: str | None) -> tuple[bool, str]:
    base = SPRING_BASE_URL
    # 내부 메타 필드 제거
    payload = {k: v for k, v in action.items() if not k.startswith("_") and k != "action"}
    act = action.get("action", "")
    try:
        if act == "createElement":
            # projectId 보장 (pending_action 에 저장된 것 우선, 없으면 state 의 project_id)
            if not payload.get("projectId") and project_id:
                payload["projectId"] = project_id
            if not payload.get("projectId"):
                return False, "BIM 프로젝트가 선택되지 않았습니다. 좌측에서 프로젝트를 먼저 선택해 주세요."
            # elementId 미생성 시 자동 생성
            if not payload.get("elementId"):
                payload["elementId"] = "ELEM-" + uuid.uuid4().hex[:8].upper()
            res = httpx.post(f"{base}/api/bim/element", json=payload, timeout=10)
            res.raise_for_status()
            return True, f"요소가 생성되었습니다. (타입: {action.get('elementType')}, 재료: {action.get('material')})"

        elif act == "updateElement":
            res = httpx.put(f"{base}/api/bim/model/element", json=payload, timeout=10)
            res.raise_for_status()
            return True, f"요소(ID: {action.get('elementId')})가 수정되었습니다."

        elif act == "deleteElement":
            eid = action.get("elementId")
            res = httpx.delete(f"{base}/api/bim/element/{eid}", timeout=10)
            res.raise_for_status()
            return True, f"요소(ID: {eid})가 삭제되었습니다."

        elif act == "createComposite":
            if not payload.get("projectId") and project_id:
                payload["projectId"] = project_id
            if not payload.get("projectId"):
                return False, "BIM 프로젝트가 선택되지 않았습니다. 좌측에서 프로젝트를 먼저 선택해 주세요."

            composite_type = action.get("compositeType")
            template = COMPOSITE_TEMPLATES.get(composite_type)
            if not template:
                return False, f"지원하지 않는 구조 타입입니다: {composite_type}"

            bx = float(action.get("baseX") or 0.0)
            by = float(action.get("baseY") or 0.0)
            bz = float(action.get("baseZ") or 0.0)
            proj_id = payload["projectId"]

            elements_payload = [
                {
                    "elementId":  "ELEM-" + uuid.uuid4().hex[:8].upper(),
                    "projectId":  proj_id,
                    "elementType": el_type,
                    "material":   material,
                    "positionX":  round(bx + rx, 3),
                    "positionY":  round(by + ry, 3),
                    "positionZ":  round(bz + rz, 3),
                    "sizeX": sx, "sizeY": sy, "sizeZ": sz,
                }
                for el_type, material, rx, ry, rz, sx, sy, sz in template["elements"]
            ]

            res = httpx.post(f"{base}/api/bim/elements/batch", json=elements_payload, timeout=30)
            res.raise_for_status()
            return True, f"{template['name_kor']} 구조물이 생성되었습니다. (총 {len(elements_payload)}개 부재)"

        elif act == "createProject":
            # projectName 필수
            if not payload.get("projectName"):
                return False, "프로젝트 이름이 없습니다. 프로젝트 이름을 알려주세요."
            # spanCount는 Spring DTO가 String 타입을 기대함
            if "spanCount" in payload and payload["spanCount"] is not None:
                payload["spanCount"] = str(payload["spanCount"])
            res = httpx.post(f"{base}/api/bim/project", json=payload, timeout=10)
            res.raise_for_status()
            return True, f"프로젝트 '{action.get('projectName')}'가 생성되었습니다."

        else:
            return False, f"지원하지 않는 작업입니다: {act}"

    except httpx.HTTPStatusError as e:
        body = ""
        try:
            body = e.response.text[:200]
        except Exception:
            pass
        return False, f"API 오류 {e.response.status_code}: {body}"
    except httpx.ConnectError:
        return False, f"Spring 서버에 연결할 수 없습니다 ({SPRING_BASE_URL})"
    except httpx.TimeoutException:
        return False, "Spring 서버 응답 시간 초과"
    except Exception as e:
        return False, f"연결 오류: {e}"


def _build_success_reply(action: dict, message: str) -> str:
    reply = f"✅ {message}"
    act = action.get("action")
    if act == "createElement":
        reply += (
            f"\n- 타입: {action.get('elementType')}"
            f"\n- 재료: {action.get('material')}"
            f"\n- 위치: ({action.get('positionX')}, {action.get('positionY')}, {action.get('positionZ')})"
            f"\n- 크기: {action.get('sizeX')} × {action.get('sizeY')} × {action.get('sizeZ')} m"
        )
    elif act == "createComposite":
        ct = action.get("compositeType", "")
        tmpl = COMPOSITE_TEMPLATES.get(ct, {})
        reply += f"\n- 구조: {tmpl.get('name_kor', ct)}"
        reply += f"\n- 기준점: ({action.get('baseX')}, {action.get('baseY')}, {action.get('baseZ')})"
        reply += f"\n- 구성: {tmpl.get('desc', '')}"
    elif act == "createProject":
        reply += f"\n- 프로젝트명: {action.get('projectName')}"
        if action.get("structureType"):
            reply += f"\n- 구조 유형: {action.get('structureType')}"
        reply += "\n\n좌측 프로젝트 목록에서 새 프로젝트를 선택해 BIM 편집을 시작하세요."
    return reply


# ── 노드 함수 ────────────────────────────────────────────────────────

_CLARIFY_MSG = (
    "무엇을 원하시는지 정확히 확인하고 싶습니다. 다음 중 어떤 작업인가요?\n\n"
    "1️⃣  새 BIM 프로젝트 생성 (프로젝트 워크스페이스 신규 생성)\n"
    "2️⃣  현재 프로젝트에 복합 구조물 추가\n"
    "   (교각, 건물 골조, 교량, 피사의 사탑, 에펠탑, 피라미드 등)\n\n"
    "'1' 또는 '2'로 답하거나, 원하시는 내용을 구체적으로 말씀해 주세요."
)

_COMPOSITE_LIST_MSG = (
    "어떤 복합 구조물을 추가할까요?\n\n"
    "  • 교각구조 (pier)\n"
    "  • 건물 기본 골조 (building_frame)\n"
    "  • 교량 경간 (bridge_span)\n"
    "  • 인천대교 사장교 (incheon_bridge)\n"
    "  • 피사의 사탑 (leaning_tower)\n"
    "  • 에펠탑 (eiffel_tower)\n"
    "  • 이집트 피라미드 (pyramid)\n\n"
    "원하시는 구조물 이름을 알려주세요."
)


def bim_builder_node(state: AgentState) -> dict:
    last_message = state["messages"][-1]
    user_text = last_message.content if hasattr(last_message, "content") else str(last_message)
    project_id = state.get("bim_project_id")
    pending_action = state.get("pending_action")

    # ── Case 1: pending_action 있음 ────────────────────────────────

    if pending_action:

        # 1-A. 명확화 대기 중 (_clarify)
        clarify = pending_action.get("_clarify")
        if clarify == "project_or_composite":
            txt = user_text.lower().replace(" ", "")
            if "1" in txt or "프로젝트" in txt or "project" in txt:
                action = {"action": "createProject", "_missing": ["projectName"]}
                return {
                    "messages": [AIMessage(content=_ask_for_missing(["projectName"], action))],
                    "pending_action": action,
                }
            elif "2" in txt or any(k in txt for k in ["구조물", "추가", "골조", "교각", "교량", "피사", "에펠", "피라미드"]):
                ct = _detect_composite_type(user_text)
                if ct:
                    action = {"action": "createComposite", "compositeType": ct, "_missing": ["baseX", "baseY", "baseZ"]}
                else:
                    action = {"action": "createComposite", "_missing": ["compositeType", "baseX", "baseY", "baseZ"]}
                return {
                    "messages": [AIMessage(content=_ask_for_missing(action["_missing"], action))],
                    "pending_action": action,
                }
            else:
                # 여전히 모호 → 다시 질문
                return {
                    "messages": [AIMessage(content=_CLARIFY_MSG)],
                    "pending_action": pending_action,
                }

        # 1-B. 일반 누락 값 채우기
        missing = pending_action.get("_missing", [])
        fields_str = ", ".join(missing)

        # projectName은 텍스트 전체를 그대로 사용
        extracted: dict = {}
        if missing == ["projectName"]:
            name = user_text.strip().strip('"\'')
            if name:
                extracted["projectName"] = name
        else:
            # 1차: 정규식으로 빠르게 추출
            extracted = _parse_coords_regex(user_text, missing)

            # 2차: 부족하면 LLM으로 보완
            still_missing = [f for f in missing if f not in extracted or extracted[f] is None]
            if still_missing:
                try:
                    resp = llm_precise.invoke([
                        SystemMessage(content=_EXTRACT_SYSTEM.format(fields=fields_str)),
                        HumanMessage(content=user_text),
                    ])
                    llm_extracted = _extract_json(resp.content) or {}
                    _key_alias = {"x": "positionX", "y": "positionY", "z": "positionZ"}
                    for k, v in llm_extracted.items():
                        normalized = _key_alias.get(k.lower(), k)
                        if normalized in missing and v is not None and normalized not in extracted:
                            extracted[normalized] = v
                except Exception:
                    pass

        # 추출된 값을 pending_action에 병합
        action = dict(pending_action)
        for field in missing:
            if field in extracted and extracted[field] is not None:
                action[field] = extracted[field]

        # 여전히 누락된 필드 확인
        new_missing = _find_missing_fields(action)
        if new_missing:
            action["_missing"] = new_missing
            return {
                "messages": [AIMessage(content=_ask_for_missing(new_missing, action))],
                "pending_action": action,
            }

        # 모든 필드 확보 → API 호출
        action.pop("_missing", None)
        action.pop("_clarify", None)
        success, message = _call_spring_api(action, project_id)
        reply = _build_success_reply(action, message) if success else f"❌ 작업 실패: {message}"
        return {
            "messages": [AIMessage(content=reply)],
            "query_result": json.dumps(action, ensure_ascii=False),
            "pending_action": None,
        }

    # ── Case 2: 새로운 BIM 요청 ────────────────────────────────────

    # 2-A. 사전 분류: 복합 구조물 키워드 직접 감지 → LLM 우회
    pre_ct = _detect_composite_type(user_text)
    if pre_ct and not _EXPLICIT_PROJECT_PAT.search(user_text):
        # 위치 정보도 문자열에서 추출 시도
        coords = _parse_coords_regex(user_text, ["baseX", "baseY", "baseZ"])
        action: dict = {
            "action": "createComposite",
            "compositeType": pre_ct,
            "baseX": coords.get("baseX"),
            "baseY": coords.get("baseY"),
            "baseZ": coords.get("baseZ"),
        }
        if project_id:
            action["projectId"] = project_id
        missing = _find_missing_fields(action)
        if missing:
            action["_missing"] = missing
            return {
                "messages": [AIMessage(content=_ask_for_missing(missing, action))],
                "pending_action": action,
            }
        # 위치까지 모두 있으면 바로 실행
        success, message = _call_spring_api(action, project_id)
        reply = _build_success_reply(action, message) if success else f"❌ 작업 실패: {message}"
        return {
            "messages": [AIMessage(content=reply)],
            "query_result": json.dumps(action, ensure_ascii=False),
            "pending_action": None,
        }

    # 2-B. 복합 구조물 패턴은 있으나 타입 미확인 → 타입 질문
    if _COMPOSITE_PAT.search(user_text) and not _EXPLICIT_PROJECT_PAT.search(user_text):
        action = {"action": "createComposite", "_missing": ["compositeType", "baseX", "baseY", "baseZ"]}
        if project_id:
            action["projectId"] = project_id
        return {
            "messages": [AIMessage(content=_COMPOSITE_LIST_MSG)],
            "pending_action": action,
        }

    # 2-C. LLM 파싱
    try:
        resp = llm_precise.invoke([
            SystemMessage(content=_PARSE_SYSTEM),
            HumanMessage(content=user_text),
        ])
        action = _extract_json(resp.content)
    except Exception:
        action = None

    if not action or not action.get("action"):
        return {
            "messages": [AIMessage(content=(
                "요청을 이해하지 못했습니다.\n"
                "예시:\n"
                "- '콘크리트 기둥 추가해줘'\n"
                "- '피사의 사탑 만들어줘'\n"
                "- '위치 1, 0, 2에 보 생성해줘'\n"
                "- '신규 프로젝트 생성해줘'"
            ))],
            "pending_action": None,
        }

    # 2-D. LLM이 createProject를 골랐는데 명시적 프로젝트 키워드가 없으면 → 명확화 질문
    if action.get("action") == "createProject" and not _EXPLICIT_PROJECT_PAT.search(user_text):
        return {
            "messages": [AIMessage(content=_CLARIFY_MSG)],
            "pending_action": {"_clarify": "project_or_composite"},
        }

    # 기본값 적용 후 누락 필드 확인
    action = _apply_defaults(action)
    if project_id and not action.get("projectId"):
        action["projectId"] = project_id
    missing = _find_missing_fields(action)

    if missing:
        action["_missing"] = missing
        return {
            "messages": [AIMessage(content=_ask_for_missing(missing, action))],
            "pending_action": action,
        }

    # 완전한 정보 → API 호출
    success, message = _call_spring_api(action, project_id)
    if success:
        reply = _build_success_reply(action, message)
    else:
        reply = f"❌ 작업 실패: {message}\nBIM 프로젝트를 먼저 선택해 주세요."

    return {
        "messages": [AIMessage(content=reply)],
        "query_result": json.dumps(action, ensure_ascii=False),
        "pending_action": None,
    }
