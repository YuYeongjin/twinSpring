"""
Router Node — llama3.2:1b 기반 도메인 분류기

1차: llama3.2:1b LLM → JSON {"domain": "...", "need_rag": bool}
2차: JSON 파싱 실패 시 키워드 매칭 폴백 (기존 supervisor 로직 재활용)
"""
from __future__ import annotations

import json
import re
import logging

from langchain_core.messages import SystemMessage, HumanMessage
from config.state import AgentState
from config.llm_config import llm_router
from config.lang_util import detect_lang

logger = logging.getLogger(__name__)

_VALID_DOMAINS = frozenset(
    {"bim", "sensor", "simulation", "safe", "wbs", "test", "orchestrator", "tab_guide", "chat"}
)

_ROUTER_SYSTEM = SystemMessage(content=(
    "You are a routing classifier for a Digital Twin construction management system.\n"
    "Classify the user message into one domain and decide if RAG spec search is needed.\n\n"
    "Domains:\n"
    "  bim         — BIM elements, columns, beams, walls, slabs, piers, IFC, drone, structural analysis\n"
    "  sensor      — temperature, humidity, sensor data, alerts\n"
    "  simulation  — excavator control, angles, presets, earthwork volume\n"
    "  safe        — safety detection, helmet, YOLO, intrusion, violations\n"
    "  wbs         — work breakdown, construction projects, tasks, schedule, Gantt\n"
    "  test        — collision test, keyboard controls\n"
    "  orchestrator — integrated report, multi-domain summary\n"
    "  chat        — general conversation, greetings, other\n\n"
    "need_rag: true ONLY when the query requires construction spec lookup "
    "(KCS/KDS standards, 시방서, specification codes, design criteria)\n\n"
    'Output ONLY valid JSON — no explanation:\n{"domain": "<domain>", "need_rag": <true|false>}'
))


# ── 키워드 폴백 패턴 (nodes/supervisor.py 로직 축약) ────────────────────────────

_TEST_PAT = re.compile(
    r"충돌.{0,5}테스트|collision.{0,5}test"
    r"|키보드.{0,5}(단축|조작)|keyboard.{0,5}(short|control)", re.I)
_SAFE_PAT = re.compile(
    r"헬멧|안전모|침입.{0,5}감지|yolo"
    r"|감지.{0,5}(서버|이벤트|위반)|helmet|detection.{0,5}(event|violation)", re.I)
_SIM_PAT = re.compile(
    r"굴착기|굴삭기|excavator|붐.{0,5}(각도|설정)|버킷|선회"
    r"|토공|earthwork|掘削機", re.I)
_WBS_PAT = re.compile(
    r"wbs|공정표|공정.{0,5}(관리|일정)|태스크|현장.{0,5}프로젝트"
    r"|착공|준공|gantt|work.breakdown", re.I)
_BIM_PAT = re.compile(
    r"bim|ifc|기둥|IfcColumn|보(?!\w)|IfcBeam|벽|IfcWall|슬래브|교각"
    r"|column|beam|wall|slab|pier|드론|drone|구조.{0,5}해석|structural.anal", re.I)
_SENSOR_PAT = re.compile(
    r"온도|습도|센서|temperature|humidity|sensor|温度|湿度", re.I)
_ORC_PAT = re.compile(
    r"통합.{0,5}보고서|종합.{0,5}보고서|integrated.report|전체.{0,5}현황", re.I)
_RAG_PAT = re.compile(
    r"kcs|kds|시방서|설계기준|표준시방|specification|standard.spec"
    r"|콘크리트.{0,5}(설계|기준)|철근.{0,5}(배근|간격)|허용.{0,5}응력", re.I)


def _keyword_route(text: str) -> dict:
    """키워드 기반 즉시 분류 (폴백 전용)."""
    if _TEST_PAT.search(text):
        return {"domain": "test",         "need_rag": False}
    if _SAFE_PAT.search(text):
        return {"domain": "safe",         "need_rag": False}
    if _SIM_PAT.search(text):
        return {"domain": "simulation",   "need_rag": bool(_RAG_PAT.search(text))}
    if _WBS_PAT.search(text):
        return {"domain": "wbs",          "need_rag": False}
    if _BIM_PAT.search(text):
        return {"domain": "bim",          "need_rag": False}
    if _SENSOR_PAT.search(text):
        return {"domain": "sensor",       "need_rag": False}
    if _ORC_PAT.search(text):
        return {"domain": "orchestrator", "need_rag": bool(_RAG_PAT.search(text))}
    if _RAG_PAT.search(text):
        return {"domain": "chat",         "need_rag": True}
    return {"domain": "chat", "need_rag": False}


def router_node(state: AgentState) -> dict:
    # 탭 전용 직접 라우팅 (LLM 스킵)
    direct = state.get("direct_agent")
    if direct:
        return {"domain": direct, "need_rag": False, "intent": direct, "lang": "ko"}

    messages  = state.get("messages", [])
    last      = messages[-1]
    user_text = last.content if hasattr(last, "content") else str(last)

    recent = " ".join(m.content or "" for m in messages[-5:] if hasattr(m, "content"))
    lang   = detect_lang(recent)

    # llama3.2:1b 분류 시도
    try:
        result = llm_router.invoke([_ROUTER_SYSTEM, HumanMessage(content=user_text)])
        raw    = result.content.strip()

        # 코드블록 제거
        if "```" in raw:
            for part in raw.split("```"):
                part = part.strip().lstrip("json").strip()
                if part.startswith("{"):
                    raw = part
                    break

        # 첫 번째 JSON 객체 추출
        m = re.search(r'\{[^}]+\}', raw, re.DOTALL)
        if m:
            parsed = json.loads(m.group())
            domain   = str(parsed.get("domain", "chat")).strip().lower()
            need_rag = bool(parsed.get("need_rag", False))
            if domain not in _VALID_DOMAINS:
                domain = "chat"
            logger.debug("[router] LLM → domain=%s need_rag=%s", domain, need_rag)
            return {"domain": domain, "need_rag": need_rag, "lang": lang, "intent": domain}
    except Exception:
        logger.warning("[router] LLM 분류 실패 — 키워드 폴백", exc_info=True)

    # 키워드 폴백
    routed = _keyword_route(user_text)
    logger.debug("[router] keyword → %s", routed)
    return {**routed, "lang": lang, "intent": routed["domain"]}
