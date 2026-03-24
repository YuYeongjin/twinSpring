"""
Node: BIM Builder 노드

사용자의 자연어 요청을 파싱하여 BIM API를 호출합니다.
지원 작업:
  - createElement : 새 BIM 요소 생성
  - updateElement : 기존 요소 수정
  - deleteElement : 요소 삭제
  - createProject : 새 프로젝트 생성
"""

import json
import httpx
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from state import AgentState
from config import ANTHROPIC_API_KEY, LLM_MODEL, SPRING_BASE_URL

_llm = ChatAnthropic(
    model=LLM_MODEL,
    api_key=ANTHROPIC_API_KEY,
    temperature=0,
    max_tokens=1024,
)

# ── BIM 요소 타입 및 재료 매핑 ────────────────────────────────────

ELEMENT_TYPES = ["IfcColumn", "IfcBeam", "IfcWall", "IfcSlab", "IfcPier"]
MATERIALS = ["Concrete", "Steel", "Timber", "Composite"]

_PARSE_SYSTEM_PROMPT = f"""당신은 사용자의 BIM 작업 요청을 JSON으로 변환하는 파서입니다.

지원하는 BIM 요소 타입: {ELEMENT_TYPES}
지원하는 재료: {MATERIALS}

사용자 요청을 분석하여 다음 JSON 형식 중 하나로 반환하세요.
다른 텍스트 없이 JSON만 반환하세요.

[요소 생성]
{{
  "action": "createElement",
  "elementType": "IfcColumn",
  "material": "Concrete",
  "positionX": 0.0,
  "positionY": 0.0,
  "positionZ": 0.0,
  "sizeX": 0.5,
  "sizeY": 3.0,
  "sizeZ": 0.5,
  "projectId": null
}}

[요소 수정]
{{
  "action": "updateElement",
  "elementId": "element-id",
  "material": "Steel",
  "positionX": 1.0,
  "positionY": 0.0,
  "positionZ": 0.0,
  "sizeX": 0.6,
  "sizeY": 3.0,
  "sizeZ": 0.6
}}

[요소 삭제]
{{
  "action": "deleteElement",
  "elementId": "element-id"
}}

[프로젝트 생성]
{{
  "action": "createProject",
  "projectName": "신규 프로젝트",
  "spanCount": 3,
  "structureType": "Steel"
}}

규칙:
- 사용자가 위치를 말하지 않으면 positionX/Y/Z는 0으로 설정
- 크기를 말하지 않으면 기본값(기둥: 0.5×3.0×0.5, 보: 5.0×0.4×0.4, 벽: 5.0×3.0×0.2, 슬래브: 5.0×0.2×5.0) 사용
- 재료를 말하지 않으면 "Concrete" 사용
- 한국어 요소명을 영어로 변환: 기둥→IfcColumn, 보→IfcBeam, 벽→IfcWall, 슬래브→IfcSlab, 교각→IfcPier
- projectId가 제공되면 반드시 포함
"""


def _call_spring_api(action: dict, project_id: str | None) -> tuple[bool, str]:
    """Spring Boot BIM API 호출"""
    base = SPRING_BASE_URL

    try:
        if action["action"] == "createElement":
            if project_id and not action.get("projectId"):
                action["projectId"] = project_id
            res = httpx.post(f"{base}/api/bim/element", json=action, timeout=10)
            res.raise_for_status()
            return True, f"요소가 생성되었습니다. (타입: {action.get('elementType')}, 재료: {action.get('material')})"

        elif action["action"] == "updateElement":
            res = httpx.put(f"{base}/api/bim/model/element", json=action, timeout=10)
            res.raise_for_status()
            return True, f"요소(ID: {action.get('elementId')})가 수정되었습니다."

        elif action["action"] == "deleteElement":
            element_id = action.get("elementId")
            res = httpx.delete(f"{base}/api/bim/element/{element_id}", timeout=10)
            res.raise_for_status()
            return True, f"요소(ID: {element_id})가 삭제되었습니다."

        elif action["action"] == "createProject":
            res = httpx.post(f"{base}/api/bim/project", json=action, timeout=10)
            res.raise_for_status()
            return True, f"프로젝트 '{action.get('projectName')}'가 생성되었습니다."

        else:
            return False, f"지원하지 않는 작업입니다: {action.get('action')}"

    except httpx.HTTPStatusError as e:
        return False, f"API 오류: {e.response.status_code} - {e.response.text}"
    except Exception as e:
        return False, f"연결 오류: {str(e)}"


def bim_builder_node(state: AgentState) -> dict:
    """자연어 BIM 요청을 파싱하고 API를 호출하는 노드"""
    last_message = state["messages"][-1]
    user_text = last_message.content if hasattr(last_message, "content") else str(last_message)
    project_id = state.get("bim_project_id")

    # 1. LLM으로 요청 파싱
    parse_response = _llm.invoke(
        [
            SystemMessage(content=_PARSE_SYSTEM_PROMPT),
            HumanMessage(content=f"프로젝트 ID: {project_id or '없음'}\n\n사용자 요청: {user_text}"),
        ]
    )

    raw = parse_response.content.strip()
    # JSON 블록 추출
    if "```" in raw:
        raw = raw.split("```")[1].replace("json", "").strip()

    try:
        action = json.loads(raw)
    except json.JSONDecodeError:
        reply = "요청을 이해하지 못했습니다. 예: '기둥 하나 추가해줘', '콘크리트 벽 만들어줘'"
        return {"messages": [AIMessage(content=reply)]}

    # 2. Spring BIM API 호출
    success, message = _call_spring_api(action, project_id)

    # 3. 사용자 친화적 응답 생성
    if success:
        reply = f"✅ {message}\n\n"
        if action.get("action") == "createElement":
            reply += (
                f"**생성된 요소 정보**\n"
                f"- 타입: {action.get('elementType')}\n"
                f"- 재료: {action.get('material')}\n"
                f"- 위치: ({action.get('positionX', 0)}, {action.get('positionY', 0)}, {action.get('positionZ', 0)})\n"
                f"- 크기: {action.get('sizeX', 0)} × {action.get('sizeY', 0)} × {action.get('sizeZ', 0)} m"
            )
        elif action.get("action") == "createProject":
            reply += f"3D 뷰에서 새 프로젝트를 확인하세요."
    else:
        reply = f"❌ 작업 실패: {message}\n\n현재 BIM 프로젝트를 선택한 후 다시 시도해 주세요."

    return {
        "messages": [AIMessage(content=reply)],
        "query_result": raw,
    }
