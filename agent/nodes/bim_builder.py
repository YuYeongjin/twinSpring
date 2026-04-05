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

# ── 복합 구조물 템플릿 ────────────────────────────────────────────────
# 각 요소: (elementType, material, relX, relY, relZ, sizeX, sizeY, sizeZ)
# relX/Y/Z 는 기준점(baseX/Y/Z) 에 대한 상대 좌표 (단위: m)
COMPOSITE_TEMPLATES: dict[str, dict] = {
    "pier": {
        "name_kor": "교각",
        "desc": "기초 슬래브 + 양측 기둥 2개 + 상단 캡 보",
        "elements": [
            # (type,         material,    relX,  relY, relZ, sX,  sY,  sZ)
            ("IfcSlab",   "Concrete",  0.0,  0.0, 0.0, 6.0, 0.5, 3.0),  # 기초 슬래브
            ("IfcColumn", "Concrete", -2.0,  0.5, 0.0, 0.6, 4.0, 0.6),  # 좌측 기둥
            ("IfcColumn", "Concrete",  2.0,  0.5, 0.0, 0.6, 4.0, 0.6),  # 우측 기둥
            ("IfcBeam",   "Concrete",  0.0,  4.5, 0.0, 5.0, 0.8, 1.2),  # 상단 캡 보
        ],
    },
    "building_frame": {
        "name_kor": "건물 기본 골조",
        "desc": "바닥 슬래브 + 4개 기둥 + 테두리 보 4개",
        "elements": [
            ("IfcSlab",   "Concrete",  0.0,  0.0,  0.0, 8.0, 0.3, 8.0),  # 바닥 슬래브
            ("IfcColumn", "Concrete", -3.5,  0.3, -3.5, 0.5, 3.0, 0.5),  # 기둥 FL
            ("IfcColumn", "Concrete",  3.5,  0.3, -3.5, 0.5, 3.0, 0.5),  # 기둥 FR
            ("IfcColumn", "Concrete", -3.5,  0.3,  3.5, 0.5, 3.0, 0.5),  # 기둥 BL
            ("IfcColumn", "Concrete",  3.5,  0.3,  3.5, 0.5, 3.0, 0.5),  # 기둥 BR
            ("IfcBeam",   "Steel",     0.0,  3.3, -3.5, 7.5, 0.5, 0.4),  # 전면 보
            ("IfcBeam",   "Steel",     0.0,  3.3,  3.5, 7.5, 0.5, 0.4),  # 후면 보
            ("IfcBeam",   "Steel",    -3.5,  3.3,  0.0, 0.4, 0.5, 7.5),  # 좌측 보
            ("IfcBeam",   "Steel",     3.5,  3.3,  0.0, 0.4, 0.5, 7.5),  # 우측 보
        ],
    },
    "bridge_span": {
        "name_kor": "교량 경간",
        "desc": "교각 2기 + 주거더 + 상판 슬래브",
        "elements": [
            ("IfcSlab",   "Concrete",  0.0, 0.0, 0.0,  3.0, 0.4, 2.0),  # 교각1 기초
            ("IfcColumn", "Concrete",  0.0, 0.4, 0.0,  0.8, 4.0, 0.8),  # 교각1 기둥
            ("IfcBeam",   "Concrete",  0.0, 4.4, 0.0,  3.0, 0.6, 1.0),  # 교각1 캡
            ("IfcSlab",   "Concrete", 10.0, 0.0, 0.0,  3.0, 0.4, 2.0),  # 교각2 기초
            ("IfcColumn", "Concrete", 10.0, 0.4, 0.0,  0.8, 4.0, 0.8),  # 교각2 기둥
            ("IfcBeam",   "Concrete", 10.0, 4.4, 0.0,  3.0, 0.6, 1.0),  # 교각2 캡
            ("IfcBeam",   "Steel",     5.0, 5.0, 0.0, 11.0, 0.8, 0.6),  # 주거더
            ("IfcSlab",   "Concrete",  5.0, 5.8, 0.0, 11.5, 0.3, 3.0),  # 상판 슬래브
        ],
    },
}

# 한국어 / 영어 별칭 → 표준 compositeType 키
_COMPOSITE_ALIAS: dict[str, str] = {
    "교각": "pier", "pier": "pier", "교각구조": "pier",
    "건물골조": "building_frame", "골조": "building_frame",
    "건물기본골조": "building_frame", "building_frame": "building_frame",
    "교량경간": "bridge_span", "교량": "bridge_span",
    "bridge_span": "bridge_span", "bridge": "bridge_span",
}

# ── 시스템 프롬프트 ──────────────────────────────────────────────────

_PARSE_SYSTEM = """당신은 BIM(Building Information Modeling) 어시스턴트입니다.
사용자 메시지에서 BIM 작업을 파악하여 JSON으로만 응답하세요. 설명 없이 JSON만 출력하세요.

지원 액션:
- createElement: 단일 BIM 요소 생성
- createComposite: 여러 부재를 조합한 복합 구조물 생성 (교각/골조/교량 등)
- updateElement: 요소 수정 (elementId 필요)
- deleteElement: 요소 삭제 (elementId 필요)
- createProject: 프로젝트 생성

요소 타입: IfcColumn(기둥), IfcBeam(보), IfcWall(벽), IfcSlab(슬래브), IfcPier(교각)
재료: Concrete(콘크리트), Steel(철/스틸), Timber(목재/나무), Composite(합성)
복합 구조 타입: pier(교각구조), building_frame(건물기본골조), bridge_span(교량경간)

createElement 형식:
{{"action":"createElement","elementType":"IfcColumn","material":"Concrete","positionX":1.0,"positionY":0.0,"positionZ":2.0,"sizeX":0.5,"sizeY":3.0,"sizeZ":0.5}}

createComposite 형식 (샘플/구조물/조합 키워드 있을 때 사용):
{{"action":"createComposite","compositeType":"pier","baseX":0.0,"baseY":0.0,"baseZ":0.0}}

deleteElement 형식:
{{"action":"deleteElement","elementId":"<id>"}}

updateElement 형식:
{{"action":"updateElement","elementId":"<id>","positionX":1.0,...}}

createProject 형식:
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
    return reply


# ── 노드 함수 ────────────────────────────────────────────────────────

def bim_builder_node(state: AgentState) -> dict:
    last_message = state["messages"][-1]
    user_text = last_message.content if hasattr(last_message, "content") else str(last_message)
    project_id = state.get("bim_project_id")
    pending_action = state.get("pending_action")

    # ── Case 1: pending_action 있음 → 누락 값 채우기 ────────────────
    if pending_action:
        missing = pending_action.get("_missing", [])
        fields_str = ", ".join(missing)

        # 1차: 정규식으로 빠르게 추출
        extracted = _parse_coords_regex(user_text, missing)

        # 2차: 정규식으로 부족하면 LLM으로 보완
        still_missing = [f for f in missing if f not in extracted or extracted[f] is None]
        if still_missing:
            try:
                resp = llm_precise.invoke([
                    SystemMessage(content=_EXTRACT_SYSTEM.format(fields=fields_str)),
                    HumanMessage(content=user_text),
                ])
                llm_extracted = _extract_json(resp.content) or {}
                # LLM 결과 병합 (x/y/z 키도 positionX/Y/Z로 정규화)
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
        success, message = _call_spring_api(action, project_id)
        reply = _build_success_reply(action, message) if success else f"❌ 작업 실패: {message}"
        return {
            "messages": [AIMessage(content=reply)],
            "query_result": json.dumps(action, ensure_ascii=False),
            "pending_action": None,
        }

    # ── Case 2: 새로운 BIM 요청 ────────────────────────────────────
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
                "- '위치 1, 0, 2에 철재 보 생성해줘'\n"
                "- '기둥 삭제해줘' (ID 필요)\n"
                "- '신규 프로젝트 생성해줘'"
            ))],
            "pending_action": None,
        }

    # 기본값 적용 후 누락 필드 확인
    action = _apply_defaults(action)
    # projectId를 현재 프로젝트 컨텍스트에서 저장 (2번째 대화 시에도 유지되도록)
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
