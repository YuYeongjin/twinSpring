"""
BIM Agent — BIM 모델 관리 전문 에이전트

담당:
  - BIM 부재 생성/삭제/수정 (createElement, deleteElement, createComposite)
  - BIM 프로젝트·부재 통계 조회
  - 드론 사진 분석 안내
  - 구조 해석 조회
  - IFC 파일 가져오기 안내

설계 원칙:
  - 단순 조회(list_bim_projects, get_bim_stats 등) → create_react_agent ReAct 루프
  - 부재 생성/복합 구조물 등 상태 변경 → 기존 bim_builder_node 로직 유지 (multi-step 지원)
  - 판단 기준: pending_action 이 있으면 bim_builder 로직, 없으면 ReAct
"""

import json
from langchain_core.messages import SystemMessage, AIMessage
from langgraph.prebuilt import create_react_agent

from llm_config import llm_chat
from tools.bim_tools import BIM_TOOLS
from lang_util import detect_lang, lang_instruction

# 기존 bim_builder 노드 (multi-step 대화 처리)
from nodes.bim_builder import bim_builder_node
# 기존 bim_query 노드 (통계 조회)
from nodes.bim_query import bim_query_node


# ── 시스템 프롬프트 ────────────────────────────────────────────────────────────
_SYSTEM = SystemMessage(content=(
    "You are a BIM (Building Information Modeling) specialist.\n\n"

    "CRITICAL RULE: Always call a tool FIRST. Never answer without tool data.\n\n"

    "Tool selection:\n"
    "- list_bim_projects: call FIRST for any question about projects or project lists.\n"
    "- get_bim_stats: call with project_id to get element counts per type.\n"
    "- create_bim_element: when asked to ADD a column, beam, wall, slab, or pier.\n"
    "- create_composite_structure: for preset structures (pier, frame, Eiffel Tower, etc.).\n"
    "- create_bim_project: ONLY when explicitly asked to CREATE a NEW project.\n"
    "- get_drone_analysis_info: when asked about drone/aerial photo analysis.\n"
    "- get_structural_analysis: when asked about structural analysis or load distribution.\n"
    "- get_ifc_import_guide: when asked about IFC file import.\n\n"

    "After tool results: respond in 2-3 sentences. Include project names and element counts."
))

# ReAct 에이전트 (조회·안내용)
_react_agent = create_react_agent(
    model=llm_chat,
    tools=BIM_TOOLS,
    prompt=_SYSTEM,
)

# BIM 쿼리 전용 키워드 (통계·목록 조회 — 기존 bim_query_node 사용)
import re
_QUERY_ONLY_PAT = re.compile(
    # 한국어
    r"프로젝트\s*(목록|리스트|현황|보여|알려|확인|몇\s*개)"
    r"|부재\s*(수|개수|목록|현황|통계|구성|종류|몇\s*개)"
    r"|몇\s*(개의|개|종류).*부재"
    # 영어
    r"|project\s*(list|stats|overview)|element\s*(count|stats|list)"
    r"|how\s*many.{0,10}(project|element|member)"
    # 일본어 (.{0,3} 로 の/を/が 등 조사 허용)
    r"|プロジェクト.{0,3}(一覧|リスト|現状|確認|状況|いくつ|何個|教えて|見せて)"
    r"|部材.{0,3}(数|一覧|統計|種類|構成|いくつ|何個)"
    r"|何個.{0,10}(部材|プロジェクト)|いくつ.{0,10}(部材|プロジェクト)",
    re.IGNORECASE,
)

# 직접 API 호출이 필요한 변경 작업 키워드
_MUTATION_PAT = re.compile(
    # 한국어
    r"기둥|IfcColumn|보(?!\w)|IfcBeam|벽|IfcWall|슬래브|IfcSlab|교각|IfcPier"
    r"|추가|생성|만들|삭제|제거|수정|변경"
    r"|피사의\s*사탑|에펠탑|피라미드|인천대교|교각구조|건물골조|교량경간"
    # 영어
    r"|column|beam|wall|slab|pier|add|create|delete|remove|modify"
    r"|tower|pyramid|landmark|bridge\s*span|building\s*frame"
    # 일본어
    r"|柱|梁|壁|スラブ|橋脚"
    r"|追加|作成|作って|削除|除去|修正|変更|変えて"
    r"|エッフェル塔|ピラミッド|ピサの斜塔|橋脚構造|建物骨組",
    re.IGNORECASE,
)


def run_bim_agent(state: dict) -> dict:
    """
    BIM Agent 실행 엔트리포인트.

    라우팅 로직:
    1. pending_action 이 있으면 → 기존 bim_builder_node (multi-step 대화)
    2. 통계·목록 조회 키워드 → 기존 bim_query_node (빠른 구조화 응답)
    3. 그 외 → create_react_agent (도구 자율 선택)
    """
    messages = state.get("messages", [])
    pending  = state.get("pending_action")

    # ── 경로 1: multi-step BIM 대화 진행 중 ──────────────────────────────────
    if pending:
        result = bim_builder_node(state)
        return {**result, "intent": "bim_builder"}

    last_msg  = messages[-1] if messages else None
    user_text = last_msg.content if last_msg and hasattr(last_msg, "content") else ""

    # ── 경로 2: 변경 작업 (부재 생성/삭제/복합 구조물) ──────────────────────
    if _MUTATION_PAT.search(user_text):
        result = bim_builder_node(state)
        return {**result, "intent": "bim_builder"}

    # ── 경로 3: 통계·목록 조회 ───────────────────────────────────────────────
    if _QUERY_ONLY_PAT.search(user_text):
        result = bim_query_node(state)
        return {**result, "intent": "bim_query"}

    # ── 경로 4: ReAct (드론 안내, 구조 해석, IFC 안내 등) ───────────────────
    lang   = detect_lang(" ".join(m.content for m in messages[-5:] if hasattr(m, "content")))
    note   = lang_instruction(lang)

    agent_messages = messages
    if note:
        from langchain_core.messages import SystemMessage as SM
        agent_messages = [SM(content=note)] + list(messages)

    result = _react_agent.invoke({"messages": agent_messages})

    last    = result["messages"][-1]
    content = last.content if hasattr(last, "content") else ""

    # 구조화 데이터 추출
    bim_data = _extract_bim_data(result["messages"])

    return {
        "messages": [AIMessage(content=content)],
        "intent":   "bim_query",
        "bim_data": bim_data,
    }


def _extract_bim_data(messages: list) -> dict | None:
    """ReAct 루프의 tool 결과에서 bim_data 구조체를 추출합니다."""
    bim_data: dict = {}
    for msg in messages:
        if hasattr(msg, "content") and isinstance(msg.content, str):
            try:
                data = json.loads(msg.content)
                if isinstance(data, dict):
                    if "projects" in data:
                        bim_data["projects"] = data["projects"]
                    if "stats" in data:
                        bim_data["stats"] = data["stats"]
                        bim_data["total"] = data.get("total", 0)
                        bim_data["targetProjectId"] = data.get("projectId")
            except (json.JSONDecodeError, TypeError):
                pass
    return bim_data if bim_data else None
