"""
Orchestrator Agent — 최상위 멀티도메인 통합 에이전트

역할:
  - WBS / BIM / Safe 도메인 데이터를 수집 도구로 통합 조회
  - 수집된 데이터를 바탕으로 Markdown 통합 보고서 생성
  - assemble_report 도구로 최종 보고서 JSON 반환

사용 예:
  "3월 현장 통합 보고서 만들어줘"
  "전체 프로젝트 현황 문서로 출력해줘"
  "WBS·BIM·안전 종합 분석 해줘"
"""
from __future__ import annotations

import json
from langchain_core.messages import SystemMessage, AIMessage
from langgraph.prebuilt import create_react_agent

from config.llm_config import llm_precise          # 문서 생성은 정확도 우선
from config.lang_util import detect_lang, lang_instruction
from tools.report_tool import REPORT_TOOLS


# ── 시스템 프롬프트 ────────────────────────────────────────────────────────────
_SYSTEM = SystemMessage(content=(
    "You are a Master Construction Digital Twin Orchestrator.\n"
    "You aggregate data from WBS, BIM, and Safety domains and produce integrated reports.\n\n"

    "## Workflow (ALWAYS follow this order)\n"
    "1. Call collect_wbs_overview   → Get all WBS projects, task counts, progress\n"
    "2. Call collect_bim_overview   → Get all BIM projects, element statistics\n"
    "3. Call collect_safe_overview  → Get safety projects, recent detections, stats\n"
    "4. (Optional) Call collect_project_links(wbs_project_id) for cross-domain linkage\n"
    "5. Call assemble_report(title, markdown_content) → FINAL STEP, always call this\n\n"

    "## Report Markdown Format\n"
    "# {Report Title}\n"
    "> 생성일시: {datetime} | 도메인: WBS · BIM · 안전\n\n"
    "## 1. WBS 현장 공정 현황\n"
    "| 현장명 | 상태 | 공정 수 | 평균 진행률 | 지연 공정 |\n"
    "|--------|------|---------|------------|----------|\n"
    "| ... |\n\n"
    "## 2. BIM 모델 현황\n"
    "| 프로젝트명 | 구조 유형 | 총 부재 수 | 주요 구성 |\n"
    "|-----------|---------|----------|----------|\n"
    "| ... |\n\n"
    "## 3. 안전 모니터링 현황\n"
    "- 총 스캔: N회 / 위험 감지: N건 / 헬멧 위반: N건\n\n"
    "### 최근 감지 이벤트\n"
    "| 시각 | 유형 | 상세 |\n"
    "|------|------|------|\n"
    "| ... |\n\n"
    "## 4. 종합 평가\n"
    "{2~3 sentences overall assessment}\n\n"

    "## Rules\n"
    "- Always respond in Korean.\n"
    "- Fill tables with REAL data from tool results. Do not fabricate numbers.\n"
    "- If a domain has no data, write '데이터 없음' in the table.\n"
    "- assemble_report MUST be the last tool call — pass the complete Markdown as markdown_content.\n"
    "- After assemble_report, output a brief confirmation message in Korean (1~2 sentences).\n"
))


_react_agent = None


def _get_agent():
    global _react_agent
    if _react_agent is None:
        _react_agent = create_react_agent(
            model=llm_precise,
            tools=REPORT_TOOLS,
            prompt=_SYSTEM,
        )
    return _react_agent


def run_orchestrator_agent(state: dict) -> dict:
    """Orchestrator Agent 실행 엔트리포인트."""
    messages = state.get("messages", [])

    recent_text = " ".join(m.content for m in messages[-5:] if hasattr(m, "content"))
    lang        = detect_lang(recent_text)
    note        = lang_instruction(lang)

    agent_messages = list(messages)
    if note:
        agent_messages = [SystemMessage(content=note)] + agent_messages

    try:
        result      = _get_agent().invoke({"messages": agent_messages})
        last        = result["messages"][-1]
        content     = last.content if hasattr(last, "content") else str(last)
        report_data = _extract_report_data(result["messages"])
    except Exception as e:
        content     = f"보고서 생성 중 오류가 발생했습니다: {e}"
        report_data = None

    return {
        "messages":   [AIMessage(content=content)],
        "intent":     "orchestrator",
        "report_data": report_data,
    }


def _extract_report_data(messages: list) -> dict | None:
    """
    ReAct 루프의 도구 결과 메시지에서 assemble_report 가 반환한
    {"title": ..., "content": ..., "generatedAt": ...} 구조를 추출합니다.
    """
    for msg in reversed(messages):
        if not hasattr(msg, "content"):
            continue
        raw = msg.content
        if not isinstance(raw, str):
            continue
        try:
            data = json.loads(raw)
            if isinstance(data, dict) and "title" in data and "content" in data:
                return data
        except (json.JSONDecodeError, TypeError):
            pass
    return None
