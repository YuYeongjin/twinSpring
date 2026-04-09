"""
Node: BIM Query 노드

BIM 프로젝트 목록·부재 통계·부재 구성 등 데이터베이스 조회 전용 노드.
- LLM이 한국어로 결과를 요약하고
- bim_data 필드에 구조화된 JSON을 함께 반환해 프론트엔드 차트/표로 활용
"""

import re
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from state import AgentState
from llm_config import llm_chat
from tools.db_tool import (
    query_bim_projects,
    query_bim_element_stats,
    query_bim_total_count,
)

_SYSTEM = SystemMessage(content=(
    "당신은 BIM 데이터 분석 어시스턴트입니다. "
    "제공된 BIM 데이터를 바탕으로 한국어로 명확하고 구체적으로 답변하세요. "
    "부재 수, 유형, 비율 등 수치를 포함하여 답변하세요. "
    "표 형식(마크다운 테이블)을 활용하면 좋습니다."
))

# 프로젝트 ID 언급 패턴
_PROJECT_ID_PAT = re.compile(r"[a-f0-9\-]{8,}", re.I)

# 부재 유형 한국어 매핑
_TYPE_KOR = {
    "IfcColumn": "기둥",
    "IfcBeam": "보",
    "IfcWall": "벽",
    "IfcSlab": "슬래브",
    "IfcPier": "교각",
}


def _rows_to_table(rows: list[dict]) -> str:
    if not rows:
        return "(데이터 없음)"
    headers = list(rows[0].keys())
    lines = ["| " + " | ".join(headers) + " |",
             "| " + " | ".join(["---"] * len(headers)) + " |"]
    for row in rows:
        lines.append("| " + " | ".join(str(v) for v in row.values()) + " |")
    return "\n".join(lines)


def bim_query_node(state: AgentState) -> dict:
    last_message = state["messages"][-1]
    user_text = last_message.content if hasattr(last_message, "content") else str(last_message)
    project_id = state.get("bim_project_id")

    bim_data: dict = {}
    context_parts = []

    # ── 1. 프로젝트 목록 조회 ──────────────────────────────────────
    projects = query_bim_projects()
    bim_data["projects"] = projects
    context_parts.append(f"[BIM 프로젝트 목록]\n{_rows_to_table(projects)}")

    # ── 2. 특정 프로젝트 통계 ─────────────────────────────────────
    # 메시지에서 project_id 후보 추출 또는 선택된 project 사용
    target_id = project_id
    if not target_id:
        # 사용자 메시지에서 프로젝트 이름으로 매핑
        for p in projects:
            name = (p.get("projectName") or "").lower()
            pid = p.get("projectId") or ""
            if name and name in user_text.lower():
                target_id = pid
                break
        if not target_id and projects:
            # 요청이 특정 프로젝트를 명시하지 않았고 단일 프로젝트면 자동 선택
            if len(projects) == 1:
                target_id = projects[0].get("projectId")

    if target_id:
        stats = query_bim_element_stats(target_id)
        total = query_bim_total_count(target_id)
        bim_data["stats"] = stats
        bim_data["total"] = total
        bim_data["targetProjectId"] = target_id

        # 한국어 부재명 추가
        for s in stats:
            s["elementTypeKor"] = _TYPE_KOR.get(s.get("elementType", ""), s.get("elementType", ""))

        proj_name = next(
            (p.get("projectName") for p in projects if p.get("projectId") == target_id),
            target_id,
        )
        context_parts.append(
            f"[{proj_name} 부재 통계 — 총 {total}개]\n{_rows_to_table(stats)}"
        )

    combined = "\n\n".join(context_parts)

    try:
        response = llm_chat.invoke([
            _SYSTEM,
            HumanMessage(content=f"{combined}\n\n질문: {user_text}"),
        ])
        content = response.content.strip()
    except Exception as e:
        content = f"BIM 데이터 조회 후 응답 생성 중 오류: {e}"

    return {
        "messages": [AIMessage(content=content)],
        "query_result": combined,
        "bim_data": bim_data,
    }
