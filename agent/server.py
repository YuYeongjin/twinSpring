"""
FastAPI server — Supervisor 기반 Digital Twin AI Agent

자연어 채팅: /chat, /chat-stream  → Supervisor Workflow (LangGraph)
버튼 클릭:  /api/{domain}/...    → Tool 직접 호출 (LangGraph/LLM 없음)

Run: uvicorn server:app --host 0.0.0.0 --port 7070 --reload
"""
from __future__ import annotations

import json
import logging
import traceback
from typing import Dict, List, Optional

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)

logger = logging.getLogger(__name__)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

from graph import graph
from config.llm_config import llm_responder, llm_precise
from tools.db_tool import log_agent_query
from config.lang_util import detect_lang, lang_instruction
from nodes.router import _keyword_route          # 스트리밍 빠른 분류용
from nodes.chat import chat_node, _SYSTEM_BASE   # /chat-simple 하위호환

app = FastAPI(title="Digital Twin AI Agent", version="4.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_session_store: Dict[str, dict] = {}


# ── Request / Response 스키마 ─────────────────────────────────────────────────

class HistoryMessage(BaseModel):
    role: str
    content: str

class ChatContext(BaseModel):
    projectId: Optional[str] = None
    simulationProjectId: Optional[str] = None
    wbsProjectId: Optional[str] = None
    directAgent: Optional[str] = None
    uiLang: Optional[str] = None          # UI에서 전달한 언어 설정 (ko|en|ja)

class ChatRequest(BaseModel):
    message: str
    session_id: str = "default"
    history: List[HistoryMessage] = []
    context: ChatContext = ChatContext()

class ChatResponse(BaseModel):
    response: str
    intent: Optional[str] = None
    nextAgent: Optional[str] = None
    bimData: Optional[dict] = None
    sensorData: Optional[dict] = None
    reportData: Optional[dict] = None

class MultimodalRequest(BaseModel):
    message: str = "Please analyze this image."
    image_base64: str
    session_id: str = "default"


def _build_initial_state(req: ChatRequest, messages: list) -> dict:
    return {
        "messages":              messages,
        "domain":                None,
        "need_rag":              False,
        "lang":                  req.context.uiLang or None,  # UI 언어 설정 우선 사용
        "rag_context":           None,
        "tool_results":          None,
        "bim_project_id":        req.context.projectId,
        "simulation_project_id": req.context.simulationProjectId,
        "wbs_project_id":        req.context.wbsProjectId,
        "direct_agent":          req.context.directAgent,
        "bim_data":              None,
        "sensor_data":           None,
        "report_data":           None,
        "intent":                None,
    }


def _history_to_messages(history: List[HistoryMessage]) -> list:
    msgs = []
    for m in history:
        if m.role == "user":
            msgs.append(HumanMessage(content=m.content))
        else:
            msgs.append(AIMessage(content=m.content))
    return msgs


# ── 자연어 채팅 엔드포인트 ─────────────────────────────────────────────────────

@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    """자연어 요청 → Supervisor Workflow (LangGraph)."""
    messages = _history_to_messages(req.history) + [HumanMessage(content=req.message)]
    initial_state = _build_initial_state(req, messages)

    log_agent_query(req.session_id, req.message, project_id=req.context.projectId)

    try:
        result = graph.invoke(initial_state)
    except Exception:
        traceback.print_exc()
        return ChatResponse(
            response="An error occurred while processing your request. Please try again.",
            intent="chat",
        )

    result_msgs = result.get("messages", [])
    last_content = result_msgs[-1].content if result_msgs else "No response received."

    return ChatResponse(
        response=last_content,
        intent=result.get("intent") or result.get("domain"),
        nextAgent=result.get("domain"),
        bimData=result.get("bim_data"),
        sensorData=result.get("sensor_data"),
        reportData=result.get("report_data"),
    )


@app.post("/chat-stream")
def chat_stream(req: ChatRequest):
    """
    스트리밍 버전의 /chat 엔드포인트 (SSE).

    흐름:
      1. 키워드 빠른 분류 (~1ms) — chat 여부 판단
      2. chat → llm_responder.stream() 으로 토큰 스트리밍
         domain → graph.invoke() 결과를 단일 이벤트로 반환
    """
    messages = _history_to_messages(req.history) + [HumanMessage(content=req.message)]
    initial_state = _build_initial_state(req, messages)

    log_agent_query(req.session_id, req.message, project_id=req.context.projectId)

    def generate():
        try:
            yield f"data: {json.dumps({'step': 'classifying'}, ensure_ascii=False)}\n\n"

            # 키워드 빠른 분류 (LLM 없음 — 스트리밍 지연 방지)
            quick   = _keyword_route(req.message)
            domain  = quick["domain"]

            if domain != "chat":
                # ── 도메인 Agent: graph.invoke (LLM router + tool + responder)
                yield f"data: {json.dumps({'step': domain}, ensure_ascii=False)}\n\n"

                result      = graph.invoke(initial_state)
                result_msgs = result.get("messages", [])
                last_content = result_msgs[-1].content if result_msgs else ""

                done_event = {
                    "done":       True,
                    "response":   last_content,
                    "intent":     result.get("intent") or result.get("domain") or domain,
                    "nextAgent":  result.get("domain") or domain,
                    "bimData":    result.get("bim_data"),
                    "sensorData": result.get("sensor_data"),
                    "reportData": result.get("report_data"),
                }
                yield f"data: {json.dumps(done_event, ensure_ascii=False)}\n\n"
                return

            # ── 일반 채팅: 토큰 스트리밍
            yield f"data: {json.dumps({'step': 'generating'}, ensure_ascii=False)}\n\n"

            recent = " ".join(m.content for m in messages[-5:] if hasattr(m, "content"))
            lang   = initial_state.get("lang") or detect_lang(recent)
            note   = lang_instruction(lang)
            system_content = _SYSTEM_BASE + (f"\n\n{note}" if note else "")
            final_messages = [SystemMessage(content=system_content)] + list(messages)

            full_content = ""
            for chunk in llm_responder.stream(final_messages):
                if chunk.content:
                    full_content += chunk.content
                    yield f"data: {json.dumps({'content': chunk.content}, ensure_ascii=False)}\n\n"

            done_event = {
                "done":      True,
                "response":  full_content,
                "intent":    "chat",
                "nextAgent": "chat",
                "bimData":   None,
                "sensorData":None,
            }
            yield f"data: {json.dumps(done_event, ensure_ascii=False)}\n\n"

        except Exception:
            traceback.print_exc()
            yield f"data: {json.dumps({'done': True, 'response': 'An error occurred. Please try again.', 'intent': 'chat'}, ensure_ascii=False)}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.post("/chat-simple", response_model=ChatResponse)
def chat_simple(req: ChatRequest):
    """LangGraph 라우팅 없이 직접 chat_node 호출 (하위호환)."""
    log_agent_query(req.session_id, req.message, domain="chat", project_id=req.context.projectId)
    messages = _history_to_messages(req.history) + [HumanMessage(content=req.message)]
    state = {
        "messages":              messages,
        "domain":                "chat",
        "need_rag":              False,
        "lang":                  None,
        "rag_context":           None,
        "tool_results":          None,
        "bim_project_id":        None,
        "simulation_project_id": None,
        "wbs_project_id":        None,
        "direct_agent":          None,
        "bim_data":              None,
        "sensor_data":           None,
        "report_data":           None,
        "intent":                "chat",
    }
    try:
        result = chat_node(state)
    except Exception:
        traceback.print_exc()
        return ChatResponse(
            response="An error occurred while processing your request. Please try again.",
            intent="chat",
        )
    msgs = result.get("messages", [])
    return ChatResponse(response=msgs[-1].content if msgs else "No response received.", intent="chat")


@app.post("/chat-multimodal", response_model=ChatResponse)
def chat_multimodal(req: MultimodalRequest):
    """이미지 + 텍스트 분석 (Ollama vision 모델)."""
    log_agent_query(req.session_id, req.message, domain="vision")
    try:
        img_b64 = req.image_base64
        if "," in img_b64:
            img_b64 = img_b64.split(",", 1)[1]
        message = HumanMessage(content=[
            {"type": "text", "text": req.message},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"}},
        ])
        response = llm_responder.invoke([message])
        return ChatResponse(response=response.content, intent="vision")
    except Exception:
        traceback.print_exc()
        return ChatResponse(
            response="An error occurred while analyzing the image.",
            intent="vision",
        )


# ── WBS Project Chat (대화형 프로젝트 생성 어시스턴트) ──────────────────────────

class WbsProjectChatRequest(BaseModel):
    message: str
    history: List[Dict] = []
    collected: Dict = {}

class WbsProjectChatResponse(BaseModel):
    response: str
    collected: Dict
    ready: bool

_WBS_EXTRACT_SYSTEM = """You extract construction project fields from Korean user messages.
Return ONLY a JSON object with the fields you found. Omit fields not mentioned.
Available fields: projectName, location, startDate (YYYY-MM-DD), endDate (YYYY-MM-DD),
contractAmount (digits only), clientName, managerName, description.
Example: {"projectName": "한강대교 보강공사", "location": "한강"}
If nothing relevant found, return: {}"""

_WBS_CONV_SYSTEM = """당신은 건설 현장 WBS 프로젝트 생성 도우미입니다. 친절하게 한국어로 답변하세요.

현재까지 수집된 정보: {collected}
아직 필요한 정보: {missing}

규칙:
- 방금 받은 정보를 간략히 확인해 주세요
- 필요한 정보 중 하나만 자연스럽게 질문하세요
- projectName(현장명)만 있으면 프로젝트를 생성할 수 있다고 알려주세요
- 이미 수집된 정보는 다시 묻지 마세요"""

_ALL_FIELDS = ["location", "startDate", "endDate", "contractAmount", "clientName", "managerName"]


def _extract_fields(user_msg: str) -> Dict:
    msgs = [SystemMessage(content=_WBS_EXTRACT_SYSTEM), HumanMessage(content=user_msg)]
    try:
        result = llm_precise.invoke(msgs)
        raw = result.content.strip()
        if "```" in raw:
            for part in raw.split("```"):
                part = part.strip().lstrip("json").strip()
                if part.startswith("{"):
                    raw = part
                    break
        parsed = json.loads(raw)
        return {k: str(v).strip() for k, v in parsed.items()
                if v and str(v).strip() and str(v).strip().lower() != "null"}
    except Exception:
        return {}


def _generate_conv_response(user_msg: str, collected: Dict, history: List[Dict]) -> str:
    missing = [f for f in ["projectName"] + _ALL_FIELDS if f not in collected]
    collected_str = ", ".join(f"{k}={v}" for k, v in collected.items()) or "없음"
    missing_str   = ", ".join(missing[:3]) or "없음"
    system_content = _WBS_CONV_SYSTEM.format(collected=collected_str, missing=missing_str)
    msgs: List = [SystemMessage(content=system_content)]
    for m in history[-6:]:
        role = m.get("role", "user")
        msgs.append(HumanMessage(content=m.get("content", "")) if role == "user"
                    else AIMessage(content=m.get("content", "")))
    msgs.append(HumanMessage(content=user_msg))
    try:
        result = llm_responder.invoke(msgs)
        return result.content.strip() or "알겠습니다. 계속 진행하겠습니다."
    except Exception:
        return "알겠습니다. 계속 진행하겠습니다."


@app.post("/wbs-project-chat", response_model=WbsProjectChatResponse)
def wbs_project_chat(req: WbsProjectChatRequest):
    """대화형 WBS 프로젝트 생성 어시스턴트."""
    collected = dict(req.collected or {})
    try:
        for k, v in _extract_fields(req.message).items():
            if v:
                collected[k] = v
        ready         = bool(collected.get("projectName"))
        response_text = _generate_conv_response(req.message, collected, req.history)
    except Exception:
        traceback.print_exc()
        response_text = "죄송합니다, 처리 중 오류가 발생했습니다. 다시 시도해 주세요."
        ready         = bool(collected.get("projectName"))
    return WbsProjectChatResponse(response=response_text, collected=collected, ready=ready)


# ── WBS RAG Suggest ──────────────────────────────────────────────────────────

class WbsRagRequest(BaseModel):
    eventType: str
    title: str = ""
    detail: str = ""

class WbsRagEvidence(BaseModel):
    source: str
    series: str
    content: str

class WbsRagResponse(BaseModel):
    query: str
    evidence: list[WbsRagEvidence]
    hasData: bool

_EVENT_RAG_QUERIES: dict[str, str] = {
    "COLLISION":         "부재 충돌 보정 공정 구조안전 확인 절차 간섭 오차",
    "CRACK":             "구조물 균열 균열보수 보수공사 콘크리트 균열폭 시공기준",
    "SAFE_ZONE":         "안전구역 위험구역 안전점검 안전관리 출입금지 구역설정",
    "SAFETY":            "안전보호구 안전복장 안전모 착용기준 안전교육 작업자",
    "STRUCTURAL_DANGER": "구조부재 안전율 허용응력 초과 구조보강 내하력 검토 KDS 구조설계기준 하중조합",
    "SIM_DANGER":        "굴착기 건설기계 전도 위험 안전작업 경사면 굴착 안전기준 KCS 토공 건설기계 작업 안전",
}


@app.post("/wbs-rag-suggest", response_model=WbsRagResponse)
def wbs_rag_suggest(req: WbsRagRequest):
    from tools.construction_rag_tool import search_construction_docs
    base_query = _EVENT_RAG_QUERIES.get(req.eventType, "안전관리 시공기준")
    extra = " ".join(filter(None, [req.title, req.detail]))
    query = f"{base_query} {extra}".strip()[:250]
    try:
        docs = search_construction_docs(query, k=4)
    except Exception:
        logger.error("[wbs_rag_suggest] RAG 검색 실패", exc_info=True)
        docs = []
    evidence: list[WbsRagEvidence] = []
    seen: set[str] = set()
    for doc in docs:
        text = doc.page_content.strip()
        if not text or text in seen:
            continue
        seen.add(text)
        meta   = doc.metadata
        source = f"{meta.get('code', '')} {meta.get('title', '')}".strip() or meta.get("source", "알 수 없음")
        series = meta.get("series", "") or meta.get("category", "")
        evidence.append(WbsRagEvidence(source=source, series=series, content=text[:500]))
    return WbsRagResponse(query=query, evidence=evidence, hasData=len(evidence) > 0)


# ── Structural Spec RAG ──────────────────────────────────────────────────────

class StructuralSpecRequest(BaseModel):
    materialType: str
    elementTypes: List[str] = []
    hasWarning: bool = False
    hasDanger: bool = False
    seismicZone: int = 2
    query: Optional[str] = None

class SpecCitation(BaseModel):
    source: str
    series: str
    content: str

class StructuralSpecResponse(BaseModel):
    citations: list[SpecCitation]
    hasData: bool
    query: str

_MATERIAL_QUERIES: dict[str, str] = {
    "concrete_24": "콘크리트 구조 허용압축응력 설계기준 안전율 KDS 14 20 콘크리트강도 24MPa",
    "concrete_30": "콘크리트 구조 허용압축응력 설계기준 안전율 KDS 14 20 콘크리트강도 30MPa",
    "concrete_40": "콘크리트 구조 허용압축응력 설계기준 안전율 KDS 14 20 고강도콘크리트",
    "steel_235":   "강구조 허용응력 설계 SS275 허용휨응력 허용전단응력 KDS 14 30",
    "steel_355":   "강구조 허용응력 설계 SM355 고장력강 허용휨응력 KDS 14 30 KDS 14 31",
}
_ELEMENT_QUERIES: dict[str, str] = {
    "IfcColumn": "기둥 축력 허용압축응력 세장비 좌굴 검토 하중조합",
    "IfcBeam":   "보 허용휨응력 허용전단응력 처짐 제한 L/360 연속보",
    "IfcWall":   "벽체 전단벽 허용전단응력 축력 설계",
    "IfcSlab":   "슬래브 허용처짐 휨강도 분포하중 연속슬래브 KDS 14 20",
    "IfcPier":   "교각 기둥 축력 허용응력 내진 설계",
    "IfcMember": "부재 허용응력 안전율 하중조합",
}


@app.post("/structural-spec", response_model=StructuralSpecResponse)
def structural_spec(req: StructuralSpecRequest):
    from tools.construction_rag_tool import search_construction_docs
    parts: list[str] = [_MATERIAL_QUERIES.get(req.materialType, "구조 설계기준 허용응력 안전율")]
    seen_elem: set[str] = set()
    for et in req.elementTypes:
        if et in _ELEMENT_QUERIES and et not in seen_elem:
            parts.append(_ELEMENT_QUERIES[et])
            seen_elem.add(et)
        if len(seen_elem) >= 2:
            break
    if req.hasDanger:
        parts.append("구조부재 허용응력 초과 안전율 미달 구조보강 내하력 검토")
    elif req.hasWarning:
        parts.append("구조부재 안전율 경계값 하중조합 검토 보강 여부")
    if req.seismicZone >= 3:
        parts.append("내진설계 지진하중 스펙트럼 가속도 KDS 17 내진성능")
    if req.query:
        parts.append(req.query.strip()[:100])
    full_query = " ".join(parts)[:300]
    try:
        docs = search_construction_docs(full_query, k=5)
    except Exception:
        logger.error("[structural_spec] RAG 검색 실패", exc_info=True)
        docs = []
    citations: list[SpecCitation] = []
    seen_texts: set[str] = set()
    for doc in docs:
        text = doc.page_content.strip()
        if not text or text in seen_texts:
            continue
        seen_texts.add(text)
        meta   = doc.metadata
        source = f"{meta.get('code', '')} {meta.get('title', '')}".strip() or meta.get("source", "알 수 없음")
        series = meta.get("series", "") or meta.get("category", "")
        citations.append(SpecCitation(source=source, series=series, content=text[:500]))
    return StructuralSpecResponse(citations=citations, hasData=len(citations) > 0, query=full_query)


# ── Excavation Spec RAG ──────────────────────────────────────────────────────

class ExcavationSpecRequest(BaseModel):
    soilZone: str = "Common Earth"
    weatherMode: str = "clear"
    totalExcav: float = 0.0
    totalFill: float = 0.0
    digDepth: float = 0.0
    hasRandomTerrain: bool = False
    query: Optional[str] = None

class ExcavationCitation(BaseModel):
    source: str
    series: str
    content: str

class ExcavationSpecResponse(BaseModel):
    citations: list[ExcavationCitation]
    summary: str
    hasData: bool
    query: str

_ZONE_QUERIES: dict[str, str] = {
    "Common Earth": "토공 일반토 굴착 다짐 쌓기 깎기 시공기준 KCS 11 20 토공 팽창계수 수축계수",
    "Sandy Soil":   "사질토 모래 굴착 다짐 포화 지하수 비탈면 안정 KCS 11 20 사면안정",
    "Gravel":       "자갈 굴착 쇄석 입도 다짐 다짐도 KCS 11 20 골재",
    "Rock":         "암반 굴착 발파 리핑 암질 분류 기계굴착 암반등급 RQD KCS 11 20 암반굴착",
    "Water":        "수중 굴착 준설 지하수 용출 굴착 배수 흙막이 KCS 21 굴착공사 배수처리",
}
_WEATHER_QUERIES: dict[str, str] = {
    "clear":      "",
    "light-rain": "우천 시공 강우 토공 함수비 다짐 기준 우기 시공제한 KCS",
    "heavy-rain": "호우 폭우 시공중지 기준 비탈면 간극수압 토석류 붕괴 KCS 21 지반안정",
}
_EARTHWORK_BASE = (
    "토공 굴착량 토적 산출 팽창계수 수축계수 체적변화 토공량 계산 "
    "토공 배분 운반 경제운반거리 KCS 11 20 00 토공 시공일반"
)


@app.post("/excavation-spec", response_model=ExcavationSpecResponse)
def excavation_spec(req: ExcavationSpecRequest):
    from tools.construction_rag_tool import search_construction_docs
    parts: list[str] = [_EARTHWORK_BASE, _ZONE_QUERIES.get(req.soilZone, _ZONE_QUERIES["Common Earth"])]
    weather_q = _WEATHER_QUERIES.get(req.weatherMode, "")
    if weather_q:
        parts.append(weather_q)
    if req.digDepth >= 5.0:
        parts.append("흙막이 지보공 굴착깊이 5m 이상 KCS 21 30 굴착공사 안전기준")
    if req.soilZone == "Rock":
        parts.append("암반 굴착 시 장비 진동 소음 민원 발파 진동 기준 KDS KCS 암질 판정")
    if req.soilZone == "Water":
        parts.append("굴착 시 지하수 처리 차수 그라우팅 강변 굴착 세굴 방지")
    if req.query:
        parts.append(req.query.strip()[:100])
    full_query = " ".join(parts)[:350]
    try:
        docs = search_construction_docs(full_query, k=5)
    except Exception:
        logger.error("[excavation_spec] RAG 검색 실패", exc_info=True)
        docs = []
    citations: list[ExcavationCitation] = []
    seen_texts: set[str] = set()
    for doc in docs:
        text = doc.page_content.strip()
        if not text or text in seen_texts:
            continue
        seen_texts.add(text)
        meta   = doc.metadata
        source = f"{meta.get('code', '')} {meta.get('title', '')}".strip() or meta.get("source", "알 수 없음")
        series = meta.get("series", "") or meta.get("category", "")
        citations.append(ExcavationCitation(source=source, series=series, content=text[:500]))
    hardness_map = {
        "Sandy Soil":   "0.85× (모래, 굴착 쉬움)",
        "Common Earth": "1.0× (기준)",
        "Gravel":       "1.2× (자갈, 다짐 필요)",
        "Rock":         "3.5× (암반, 기계굴착 한계)",
        "Water":        "0.3× 토적 효율 (수중 손실)",
    }
    spec_excerpt = "\n".join(
        f"[{c.source}] {c.content[:180]}" for c in citations[:3]
    ) or "관련 시방서 조문 없음"
    summary_prompt = (
        f"현재 굴착 조건:\n"
        f"- 토질: {req.soilZone} (굴착 저항: {hardness_map.get(req.soilZone, '1.0×')})\n"
        f"- 날씨: {req.weatherMode}\n"
        f"- 누계 굴착량: {req.totalExcav:.2f} m³ / 성토량: {req.totalFill:.2f} m³\n"
        f"- 현재 굴착 깊이: {req.digDepth:.2f} m\n\n"
        f"관련 시방서:\n{spec_excerpt}\n\n"
        "위 내용을 바탕으로 현재 굴착 조건의 특징, 주의사항, 시방서 적용 기준을 3~5줄로 요약해 주세요."
    )
    try:
        resp    = llm_precise.invoke([HumanMessage(content=summary_prompt)])
        summary = resp.content.strip()
    except Exception:
        summary = f"{req.soilZone} 구역 굴착 중. 누계 굴착량 {req.totalExcav:.2f}m³, 성토량 {req.totalFill:.2f}m³."
    return ExcavationSpecResponse(citations=citations, summary=summary, hasData=len(citations) > 0, query=full_query)


# ── 유틸 ──────────────────────────────────────────────────────────────────────

@app.delete("/session/{session_id}")
def clear_session(session_id: str):
    _session_store.pop(session_id, None)
    return {"status": "cleared", "session_id": session_id}


@app.get("/health")
def health():
    # 서버 생존 여부만 확인 — RAG/DB 쿼리 없이 즉시 응답
    # (이전 구현에서 RAG 검색을 수행해 3초 타임아웃을 초과, 오프라인 오판 발생)
    return {"status": "ok"}


@app.get("/health/detail")
def health_detail():
    # RAG/DB 상태까지 확인하는 상세 헬스체크 (별도 모니터링용)
    from tools.construction_rag_tool import search_construction_docs
    rag_ok = False
    try:
        results = search_construction_docs("건설 기준", k=1)
        rag_ok  = bool(results)
    except Exception:
        pass
    return {"status": "ok", "rag": rag_ok}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7070)
