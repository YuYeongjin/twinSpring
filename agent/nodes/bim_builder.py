"""
Node: BIM Builder 노드 (Ollama - Llama 3.2 1B)

1B 모델의 JSON 생성 불안정성을 보완하기 위해:
1. 키워드/정규식으로 elementType, material, size를 먼저 추출 (빠른 경로)
2. 추출 실패 시 LLM으로 JSON 생성 시도
3. 여러 단계의 JSON 파싱 복구 로직 적용
"""

import json
import re
import httpx
from langchain_core.messages import HumanMessage, AIMessage
from state import AgentState
from llm_config import llm_precise
from config import SPRING_BASE_URL

# ── 키워드 매핑 ───────────────────────────────────────────────────

_TYPE_MAP = {
    "기둥": "IfcColumn", "column": "IfcColumn", "ifccolumn": "IfcColumn",
    "보":   "IfcBeam",   "beam":   "IfcBeam",   "ifcbeam":   "IfcBeam",
    "벽":   "IfcWall",   "wall":   "IfcWall",   "ifcwall":   "IfcWall",
    "슬래브": "IfcSlab", "slab":   "IfcSlab",   "ifcslab":   "IfcSlab",
    "교각": "IfcPier",   "pier":   "IfcPier",   "ifcpier":   "IfcPier",
}

_MATERIAL_MAP = {
    "콘크리트": "Concrete", "concrete": "Concrete",
    "철": "Steel",          "steel": "Steel", "스틸": "Steel",
    "목재": "Timber",       "timber": "Timber", "나무": "Timber",
    "합성": "Composite",    "composite": "Composite",
}

# 기본 크기: elementType → (sizeX, sizeY, sizeZ)
_DEFAULT_SIZES = {
    "IfcColumn": (0.5, 3.0, 0.5),
    "IfcBeam":   (5.0, 0.4, 0.4),
    "IfcWall":   (5.0, 3.0, 0.2),
    "IfcSlab":   (5.0, 0.2, 5.0),
    "IfcPier":   (1.0, 5.0, 1.0),
}

_NUM_RE = re.compile(r"[-+]?\d*\.?\d+")
_SIZE_RE = re.compile(
    r"(\d+\.?\d*)\s*[x×*]\s*(\d+\.?\d*)\s*(?:[x×*]\s*(\d+\.?\d*))?",
    re.IGNORECASE,
)

# LLM JSON 파싱 프롬프트 (영어로, 매우 단순하게)
_LLM_JSON_PROMPT = (
    "Output ONLY valid JSON for this BIM request. No explanation.\n"
    "Actions: createElement, updateElement, deleteElement, createProject\n"
    "Types: IfcColumn, IfcBeam, IfcWall, IfcSlab, IfcPier\n"
    "Materials: Concrete, Steel, Timber, Composite\n\n"
    "Request: {text}\n"
    'Project ID: {pid}\n\n'
    "JSON:"
)


# ── 키워드 기반 빠른 파싱 ─────────────────────────────────────────

def _keyword_parse(text: str, project_id: str | None) -> dict | None:
    """키워드와 정규식으로 BIM 액션을 추출합니다."""
    lower = text.lower()

    # 삭제 요청
    if any(k in lower for k in ("삭제", "제거", "delete", "remove")):
        # elementId 패턴 추출 시도
        id_match = re.search(r"[a-f0-9\-]{8,}", text)
        if id_match:
            return {"action": "deleteElement", "elementId": id_match.group()}
        return None  # ID 없으면 LLM에 위임

    # 프로젝트 생성
    if "프로젝트" in lower and any(k in lower for k in ("생성", "만들", "추가", "create")):
        name_match = re.search(r"['\"](.+?)['\"]|(\S+)\s*프로젝트", text)
        name = name_match.group(1) or name_match.group(2) if name_match else "신규 프로젝트"
        return {"action": "createProject", "projectName": name, "spanCount": 3, "structureType": "Steel"}

    # 요소 생성/추가
    if any(k in lower for k in ("추가", "생성", "만들", "넣어", "create", "add")):
        # elementType 추출
        element_type = next(
            (v for k, v in _TYPE_MAP.items() if k in lower), "IfcColumn"
        )
        # material 추출
        material = next(
            (v for k, v in _MATERIAL_MAP.items() if k in lower), "Concrete"
        )
        # 크기 추출
        size_match = _SIZE_RE.search(text)
        default = _DEFAULT_SIZES.get(element_type, (0.5, 3.0, 0.5))
        if size_match:
            sx = float(size_match.group(1))
            sy = float(size_match.group(2))
            sz = float(size_match.group(3)) if size_match.group(3) else default[2]
        else:
            sx, sy, sz = default

        action = {
            "action": "createElement",
            "elementType": element_type,
            "material": material,
            "positionX": 0.0,
            "positionY": 0.0,
            "positionZ": 0.0,
            "sizeX": sx,
            "sizeY": sy,
            "sizeZ": sz,
        }
        if project_id:
            action["projectId"] = project_id
        return action

    return None  # 키워드로 판단 불가


# ── JSON 복구 파싱 ────────────────────────────────────────────────

def _extract_json(text: str) -> dict | None:
    """LLM 출력에서 JSON 객체를 추출합니다."""
    # 코드 블록 제거
    text = re.sub(r"```(?:json)?", "", text).strip()
    # 첫 번째 { ... } 블록 추출
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group())
    except json.JSONDecodeError:
        return None


# ── Spring API 호출 ───────────────────────────────────────────────

def _call_spring_api(action: dict, project_id: str | None) -> tuple[bool, str]:
    base = SPRING_BASE_URL
    try:
        act = action.get("action", "")

        if act == "createElement":
            if project_id and not action.get("projectId"):
                action["projectId"] = project_id
            res = httpx.post(f"{base}/api/bim/element", json=action, timeout=10)
            res.raise_for_status()
            return True, f"요소가 생성되었습니다. (타입: {action.get('elementType')}, 재료: {action.get('material')})"

        elif act == "updateElement":
            res = httpx.put(f"{base}/api/bim/model/element", json=action, timeout=10)
            res.raise_for_status()
            return True, f"요소(ID: {action.get('elementId')})가 수정되었습니다."

        elif act == "deleteElement":
            eid = action.get("elementId")
            res = httpx.delete(f"{base}/api/bim/element/{eid}", timeout=10)
            res.raise_for_status()
            return True, f"요소(ID: {eid})가 삭제되었습니다."

        elif act == "createProject":
            res = httpx.post(f"{base}/api/bim/project", json=action, timeout=10)
            res.raise_for_status()
            return True, f"프로젝트 '{action.get('projectName')}'가 생성되었습니다."

        else:
            return False, f"지원하지 않는 작업입니다: {act}"

    except httpx.HTTPStatusError as e:
        return False, f"API 오류: {e.response.status_code}"
    except Exception as e:
        return False, f"연결 오류: {e}"


# ── 노드 함수 ─────────────────────────────────────────────────────

def bim_builder_node(state: AgentState) -> dict:
    last_message = state["messages"][-1]
    user_text = last_message.content if hasattr(last_message, "content") else str(last_message)
    project_id = state.get("bim_project_id")

    # 1단계: 키워드 기반 빠른 파싱
    action = _keyword_parse(user_text, project_id)

    # 2단계: 키워드 실패 시 LLM 파싱
    if action is None:
        try:
            resp = llm_precise.invoke([
                HumanMessage(content=_LLM_JSON_PROMPT.format(
                    text=user_text, pid=project_id or "none"
                ))
            ])
            action = _extract_json(resp.content)
        except Exception:
            action = None

    if action is None:
        return {
            "messages": [AIMessage(
                content="요청을 이해하지 못했습니다.\n예: '콘크리트 기둥 추가해줘', '5x3 슬래브 만들어줘'"
            )]
        }

    # 3단계: Spring BIM API 호출
    success, message = _call_spring_api(action, project_id)

    if success:
        reply = f"✅ {message}"
        if action.get("action") == "createElement":
            sx, sy, sz = action.get("sizeX", 0), action.get("sizeY", 0), action.get("sizeZ", 0)
            reply += (
                f"\n- 타입: {action.get('elementType')}"
                f"\n- 재료: {action.get('material')}"
                f"\n- 크기: {sx} × {sy} × {sz} m"
            )
    else:
        reply = f"❌ 작업 실패: {message}\nBIM 프로젝트를 먼저 선택해 주세요."

    return {
        "messages": [AIMessage(content=reply)],
        "query_result": json.dumps(action, ensure_ascii=False),
    }
