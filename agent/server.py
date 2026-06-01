"""
FastAPI server - exposes LangGraph Multi-Agent as REST API

Run: uvicorn server:app --host 0.0.0.0 --port 7070 --reload
"""
from __future__ import annotations   # Python 3.9 호환: X | Y union 타입 허용

import json
import logging
import traceback
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from graph import graph
from config.llm_config import llm_chat, llm_precise
from nodes.chat import chat_node, _SYSTEM_BASE
from nodes.supervisor import supervisor_node
from config.lang_util import detect_lang, lang_instruction

app = FastAPI(title="Digital Twin AI Agent", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_session_store: Dict[str, dict] = {}


# ── Request/Response schemas ──────────────────────────────────────────────

class HistoryMessage(BaseModel):
    role: str       # "user" | "assistant"
    content: str

class ChatContext(BaseModel):
    projectId: Optional[str] = None               # BIM project ID
    simulationProjectId: Optional[str] = None     # Simulation project ID
    wbsProjectId: Optional[str] = None            # WBS project ID (selected project)
    directAgent: Optional[str] = None             # 탭 전용 에이전트 이름 (키워드 라우팅 스킵)

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

class MultimodalRequest(BaseModel):
    message: str = "Please analyze this image."
    image_base64: str
    session_id: str = "default"


# ── Endpoints ────────────────────────────────────────────────────

@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    """Forward message to LangGraph agent and return the response."""

    # Convert history
    history_messages = []
    for msg in req.history:
        if msg.role == "user":
            history_messages.append(HumanMessage(content=msg.content))
        else:
            history_messages.append(AIMessage(content=msg.content))

    messages = history_messages + [HumanMessage(content=req.message)]

    initial_state = {
        "messages":              messages,
        "intent":                None,
        "next_agent":            None,
        "query_result":          None,
        "context":               None,
        "bim_project_id":        req.context.projectId,
        "simulation_project_id": req.context.simulationProjectId,
        "wbs_project_id":        req.context.wbsProjectId,
        "direct_agent":          req.context.directAgent,
        "bim_data":              None,
        "sensor_data":           None,
    }

    try:
        result = graph.invoke(initial_state)
    except Exception:
        traceback.print_exc()
        return ChatResponse(
            response="An error occurred while processing your request. Please try again.",
            intent="chat",
        )

    result_messages = result.get("messages", [])
    last_content = result_messages[-1].content if result_messages else "No response received."

    return ChatResponse(
        response=last_content,
        intent=result.get("intent"),
        nextAgent=result.get("next_agent"),
        bimData=result.get("bim_data"),
        sensorData=result.get("sensor_data"),
    )


@app.post("/chat-stream")
def chat_stream(req: ChatRequest):
    """
    스트리밍 버전의 /chat 엔드포인트 (SSE).

    흐름:
      1. supervisor 로 intent 판단 (blocking, ~2-5초)
      2. intent == 'chat'  → llm_chat.stream() 으로 토큰 단위 스트리밍
         intent != 'chat'  → 기존 graph.invoke() 결과를 단일 이벤트로 반환
         (BIM·센서 등은 DB 쿼리 위주라 스트리밍 불필요)

    SSE 이벤트 형식:
      data: {"content": "안녕"}          ← 토큰 chunk (chat 전용)
      data: {"done": true, "response": "...", "intent": "chat", ...}  ← 완료 신호
    """
    history_messages = []
    for msg in req.history:
        if msg.role == "user":
            history_messages.append(HumanMessage(content=msg.content))
        else:
            history_messages.append(AIMessage(content=msg.content))
    messages = history_messages + [HumanMessage(content=req.message)]

    initial_state = {
        "messages":              messages,
        "intent":                None,
        "next_agent":            None,
        "query_result":          None,
        "context":               None,
        "bim_project_id":        req.context.projectId,
        "simulation_project_id": req.context.simulationProjectId,
        "wbs_project_id":        req.context.wbsProjectId,
        "direct_agent":          req.context.directAgent,
        "bim_data":              None,
        "sensor_data":           None,
    }

    def generate():
        try:
            # ── 1단계: 질문 분류 (keyword 기반, ~1ms) ─────────────────────
            yield f"data: {json.dumps({'step': 'classifying'}, ensure_ascii=False)}\n\n"

            sup_result = supervisor_node(initial_state)
            intent = sup_result.get("intent", "chat")
            next_agent = sup_result.get("next_agent", "chat")

            if intent != "chat":
                # ── 2a: 전문 Agent 처리 ────────────────────────────────────
                yield f"data: {json.dumps({'step': intent}, ensure_ascii=False)}\n\n"

                merged = {**initial_state, **sup_result}
                full_result = graph.invoke(merged)
                result_messages = full_result.get("messages", [])
                last_content = result_messages[-1].content if result_messages else ""

                done_event = {
                    "done":       True,
                    "response":   last_content,
                    "intent":     full_result.get("intent") or intent,
                    "nextAgent":  next_agent,
                    "bimData":    full_result.get("bim_data"),
                    "sensorData": full_result.get("sensor_data"),
                    "reportData": full_result.get("report_data"),
                }
                yield f"data: {json.dumps(done_event, ensure_ascii=False)}\n\n"
                return

            # ── 2b: chat — 답변 스트리밍 ──────────────────────────────────
            yield f"data: {json.dumps({'step': 'generating'}, ensure_ascii=False)}\n\n"

            recent_text = " ".join(
                m.content for m in messages[-5:] if hasattr(m, "content")
            )
            lang = detect_lang(recent_text)
            note = lang_instruction(lang)
            system_content = _SYSTEM_BASE + (f"\n\n{note}" if note else "")
            final_messages = [SystemMessage(content=system_content)] + list(messages)

            full_content = ""
            for chunk in llm_chat.stream(final_messages):
                if chunk.content:
                    full_content += chunk.content
                    yield f"data: {json.dumps({'content': chunk.content}, ensure_ascii=False)}\n\n"

            done_event = {
                "done":       True,
                "response":   full_content,
                "intent":     "chat",
                "nextAgent":  "chat",
                "bimData":    None,
                "sensorData": None,
            }
            yield f"data: {json.dumps(done_event, ensure_ascii=False)}\n\n"

        except Exception:
            traceback.print_exc()
            error_event = {
                "done":     True,
                "response": "An error occurred while processing your request. Please try again.",
                "intent":   "chat",
            }
            yield f"data: {json.dumps(error_event, ensure_ascii=False)}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.post("/chat-simple", response_model=ChatResponse)
def chat_simple(req: ChatRequest):
    """Simple chatbot endpoint — skips LangGraph routing, answers directly via chat node."""

    history_messages = []
    for msg in req.history:
        if msg.role == "user":
            history_messages.append(HumanMessage(content=msg.content))
        else:
            history_messages.append(AIMessage(content=msg.content))

    messages = history_messages + [HumanMessage(content=req.message)]

    state = {
        "messages":              messages,
        "intent":                "chat",
        "next_agent":            "chat",
        "query_result":          None,
        "context":               None,
        "bim_project_id":        None,
        "simulation_project_id": None,
        "bim_data":              None,
        "sensor_data":           None,
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
    last_content = msgs[-1].content if msgs else "No response received."

    return ChatResponse(response=last_content, intent="chat")


@app.post("/chat-multimodal", response_model=ChatResponse)
def chat_multimodal(req: MultimodalRequest):
    """Analyze image + text with Ollama vision model."""
    try:
        img_b64 = req.image_base64
        if "," in img_b64:
            img_b64 = img_b64.split(",", 1)[1]

        message = HumanMessage(content=[
            {"type": "text", "text": req.message},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"}},
        ])
        response = llm_chat.invoke([message])
        return ChatResponse(response=response.content, intent="vision")
    except Exception:
        traceback.print_exc()
        return ChatResponse(
            response="An error occurred while analyzing the image. Please verify the model supports vision.",
            intent="vision",
        )


# ── WBS Project Chat ─────────────────────────────────────────────────────────

class WbsProjectChatRequest(BaseModel):
    message: str
    history: List[Dict] = []       # [{"role": "user"|"assistant", "content": "..."}]
    collected: Dict = {}           # 지금까지 수집된 프로젝트 필드

class WbsProjectChatResponse(BaseModel):
    response: str
    collected: Dict
    ready: bool                    # True = projectName 확보, 프로젝트 생성 가능


# ── Step-1: 필드 추출 프롬프트 (영어·짧고 명확하게 → 소형 모델도 JSON 출력 안정)
_WBS_EXTRACT_SYSTEM = """You extract construction project fields from Korean user messages.
Return ONLY a JSON object with the fields you found. Omit fields not mentioned.
Available fields: projectName, location, startDate (YYYY-MM-DD), endDate (YYYY-MM-DD),
contractAmount (digits only), clientName, managerName, description.
Example: {"projectName": "한강대교 보강공사", "location": "한강"}
If nothing relevant found, return: {}"""

# ── Step-2: 대화 응답 프롬프트 (한국어·자연스럽게)
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
    """LLM으로 사용자 메시지에서 프로젝트 필드 추출 (JSON)"""
    msgs = [
        SystemMessage(content=_WBS_EXTRACT_SYSTEM),
        HumanMessage(content=user_msg),
    ]
    try:
        result = llm_precise.invoke(msgs)
        raw = result.content.strip()
        # 코드블록 제거
        if "```" in raw:
            for part in raw.split("```"):
                part = part.strip().lstrip("json").strip()
                if part.startswith("{"):
                    raw = part
                    break
        # JSON 파싱 시도
        parsed = json.loads(raw)
        return {k: str(v).strip() for k, v in parsed.items()
                if v and str(v).strip() and str(v).strip().lower() != "null"}
    except Exception:
        return {}


def _generate_conv_response(user_msg: str, collected: Dict, history: List[Dict]) -> str:
    """수집 상태를 바탕으로 자연스러운 한국어 대화 응답 생성"""
    missing = [f for f in ["projectName"] + _ALL_FIELDS if f not in collected]
    collected_str = ", ".join(f"{k}={v}" for k, v in collected.items()) or "없음"
    missing_str = ", ".join(missing[:3]) or "없음"  # 최대 3개만 표시

    system_content = _WBS_CONV_SYSTEM.format(collected=collected_str, missing=missing_str)
    msgs: List = [SystemMessage(content=system_content)]
    for m in history[-6:]:
        role = m.get("role", "user")
        if role == "user":
            msgs.append(HumanMessage(content=m.get("content", "")))
        else:
            msgs.append(AIMessage(content=m.get("content", "")))
    msgs.append(HumanMessage(content=user_msg))

    try:
        result = llm_chat.invoke(msgs)
        return result.content.strip() or "알겠습니다. 계속 진행하겠습니다."
    except Exception:
        return "알겠습니다. 계속 진행하겠습니다."


@app.post("/wbs-project-chat", response_model=WbsProjectChatResponse)
def wbs_project_chat(req: WbsProjectChatRequest):
    """
    대화형 WBS 프로젝트 생성 어시스턴트.
    Step-1: 사용자 메시지에서 프로젝트 필드 추출 (영어 프롬프트, JSON)
    Step-2: 대화 응답 생성 (한국어, 자연스럽게)
    """
    collected = dict(req.collected or {})

    try:
        # 1) 필드 추출
        extracted = _extract_fields(req.message)
        for k, v in extracted.items():
            if v:
                collected[k] = v

        # 2) 준비 여부 판단
        ready = bool(collected.get("projectName"))

        # 3) 대화 응답 생성
        response_text = _generate_conv_response(req.message, collected, req.history)

    except Exception:
        traceback.print_exc()
        response_text = "죄송합니다, 처리 중 오류가 발생했습니다. 다시 시도해 주세요."
        ready = bool(collected.get("projectName"))

    return WbsProjectChatResponse(
        response=response_text,
        collected=collected,
        ready=ready,
    )


# ── WBS RAG Suggest ──────────────────────────────────────────────────────────

class WbsRagRequest(BaseModel):
    eventType: str          # COLLISION | CRACK | SAFE_ZONE | SAFETY
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


# 이벤트 유형 → 건설 시방서 검색 쿼리 매핑
_EVENT_RAG_QUERIES: dict[str, str] = {
    "COLLISION":          "부재 충돌 보정 공정 구조안전 확인 절차 간섭 오차",
    "CRACK":              "구조물 균열 균열보수 보수공사 콘크리트 균열폭 시공기준",
    "SAFE_ZONE":          "안전구역 위험구역 안전점검 안전관리 출입금지 구역설정",
    "SAFETY":             "안전보호구 안전복장 안전모 착용기준 안전교육 작업자",
    # 구조해석 위험 부재 (StructuralDashboard — SF < 1.0 빨간 부재)
    "STRUCTURAL_DANGER":  "구조부재 안전율 허용응력 초과 구조보강 내하력 검토 KDS 구조설계기준 하중조합",
    # 시뮬레이션 굴착기 전도 위험 (physicsResult.dangerLevel === DANGER)
    "SIM_DANGER":         "굴착기 건설기계 전도 위험 안전작업 경사면 굴착 안전기준 KCS 토공 건설기계 작업 안전",
}


@app.post("/wbs-rag-suggest", response_model=WbsRagResponse)
def wbs_rag_suggest(req: WbsRagRequest):
    """
    WBS 개입 시 관련 건설 시방서(KCS/KDS) 근거 검색.

    이벤트 유형에 맞는 쿼리로 ChromaDB를 검색하고,
    증거 문서 목록을 반환하여 사용자 승인 판단을 돕는다.
    """
    from tools.construction_rag_tool import search_construction_docs

    # 기본 쿼리 + 이벤트 상세 정보 보강
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
        meta = doc.metadata
        source = f"{meta.get('code', '')} {meta.get('title', '')}".strip() or meta.get("source", "알 수 없음")
        series = meta.get("series", "") or meta.get("category", "")
        evidence.append(WbsRagEvidence(
            source=source,
            series=series,
            content=text[:500],   # UI 표시용 최대 500자
        ))

    return WbsRagResponse(
        query=query,
        evidence=evidence,
        hasData=len(evidence) > 0,
    )


# ── Structural Spec RAG ──────────────────────────────────────────────────────

class StructuralSpecRequest(BaseModel):
    materialType: str                   # 'concrete_24' | 'concrete_30' | 'concrete_40' | 'steel_235' | 'steel_355'
    elementTypes: List[str] = []        # ['IfcColumn', 'IfcBeam', 'IfcWall', 'IfcSlab', ...]
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


# 재료별 기본 검색 쿼리
_MATERIAL_QUERIES: dict[str, str] = {
    "concrete_24": "콘크리트 구조 허용압축응력 설계기준 안전율 KDS 14 20 콘크리트강도 24MPa",
    "concrete_30": "콘크리트 구조 허용압축응력 설계기준 안전율 KDS 14 20 콘크리트강도 30MPa",
    "concrete_40": "콘크리트 구조 허용압축응력 설계기준 안전율 KDS 14 20 고강도콘크리트",
    "steel_235":   "강구조 허용응력 설계 SS275 허용휨응력 허용전단응력 KDS 14 30",
    "steel_355":   "강구조 허용응력 설계 SM355 고장력강 허용휨응력 KDS 14 30 KDS 14 31",
}

# 부재 유형별 추가 검색어
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
    """
    구조해석 결과에 맞는 KCS/KDS 시방서 근거 검색.

    재료 종류·부재 유형·위험 여부를 종합해 최적 쿼리를 구성하고
    pgvector에서 관련 조문을 반환합니다.
    """
    from tools.construction_rag_tool import search_construction_docs

    # ── 쿼리 조립 ──────────────────────────────────────────────────────────────
    parts: list[str] = []

    # 1) 재료 기반
    parts.append(_MATERIAL_QUERIES.get(req.materialType, "구조 설계기준 허용응력 안전율"))

    # 2) 부재 유형별 (중복 제거, 최대 2종)
    seen_elem: set[str] = set()
    for et in req.elementTypes:
        if et in _ELEMENT_QUERIES and et not in seen_elem:
            parts.append(_ELEMENT_QUERIES[et])
            seen_elem.add(et)
        if len(seen_elem) >= 2:
            break

    # 3) 위험·경고 상태
    if req.hasDanger:
        parts.append("구조부재 허용응력 초과 안전율 미달 구조보강 내하력 검토")
    elif req.hasWarning:
        parts.append("구조부재 안전율 경계값 하중조합 검토 보강 여부")

    # 4) 내진 구역
    if req.seismicZone >= 3:
        parts.append("내진설계 지진하중 스펙트럼 가속도 KDS 17 내진성능")

    # 5) 사용자 추가 검색어
    if req.query:
        parts.append(req.query.strip()[:100])

    full_query = " ".join(parts)[:300]

    # ── RAG 검색 ───────────────────────────────────────────────────────────────
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
        meta = doc.metadata
        source = f"{meta.get('code', '')} {meta.get('title', '')}".strip() or meta.get("source", "알 수 없음")
        series = meta.get("series", "") or meta.get("category", "")
        citations.append(SpecCitation(source=source, series=series, content=text[:500]))

    return StructuralSpecResponse(
        citations=citations,
        hasData=len(citations) > 0,
        query=full_query,
    )


# ── Excavation & Earthwork Spec RAG ──────────────────────────────────────────

class ExcavationSpecRequest(BaseModel):
    soilZone: str = "Common Earth"       # 'Common Earth' | 'Sandy Soil' | 'Gravel' | 'Rock' | 'Water'
    weatherMode: str = "clear"           # 'clear' | 'light-rain' | 'heavy-rain'
    totalExcav: float = 0.0              # 누계 굴착량 (m³)
    totalFill: float = 0.0               # 누계 성토량 (m³)
    digDepth: float = 0.0                # 현재 굴착 깊이 (m)
    hasRandomTerrain: bool = False       # 무작위 지형 활성 여부
    query: Optional[str] = None         # 사용자 추가 검색어


class ExcavationCitation(BaseModel):
    source: str
    series: str
    content: str


class ExcavationSpecResponse(BaseModel):
    citations: list[ExcavationCitation]
    summary: str                         # LLM 요약 (토공 조건 + 시방서 해석)
    hasData: bool
    query: str


# 토질별 기본 검색 쿼리
_ZONE_QUERIES: dict[str, str] = {
    "Common Earth":  "토공 일반토 굴착 다짐 쌓기 깎기 시공기준 KCS 11 20 토공 팽창계수 수축계수",
    "Sandy Soil":    "사질토 모래 굴착 다짐 포화 지하수 비탈면 안정 KCS 11 20 사면안정",
    "Gravel":        "자갈 굴착 쇄석 입도 다짐 다짐도 KCS 11 20 골재",
    "Rock":          "암반 굴착 발파 리핑 암질 분류 기계굴착 암반등급 RQD KCS 11 20 암반굴착",
    "Water":         "수중 굴착 준설 지하수 용출 굴착 배수 흙막이 KCS 21 굴착공사 배수처리",
}

# 날씨별 추가 검색어
_WEATHER_QUERIES: dict[str, str] = {
    "clear":      "",
    "light-rain": "우천 시공 강우 토공 함수비 다짐 기준 우기 시공제한 KCS",
    "heavy-rain": "호우 폭우 시공중지 기준 비탈면 간극수압 토석류 붕괴 KCS 21 지반안정",
}

_EARTHWORK_BASE_QUERY = (
    "토공 굴착량 토적 산출 팽창계수 수축계수 체적변화 토공량 계산 "
    "토공 배분 운반 경제운반거리 KCS 11 20 00 토공 시공일반"
)


@app.post("/excavation-spec", response_model=ExcavationSpecResponse)
def excavation_spec(req: ExcavationSpecRequest):
    """
    시뮬레이션 굴착 컨텍스트에 맞는 KCS/KDS 시방서 근거 + LLM 요약 반환.

    토질 구역·날씨·토공량을 종합하여 관련 시방서 조문을 검색하고,
    굴착 조건에 대한 간결한 해석을 LLM으로 생성합니다.
    """
    from tools.construction_rag_tool import search_construction_docs

    # ── 1. 쿼리 조립 ──────────────────────────────────────────────────────────
    parts: list[str] = [_EARTHWORK_BASE_QUERY]

    # 토질 구역별
    zone_q = _ZONE_QUERIES.get(req.soilZone, _ZONE_QUERIES["Common Earth"])
    parts.append(zone_q)

    # 날씨
    weather_q = _WEATHER_QUERIES.get(req.weatherMode, "")
    if weather_q:
        parts.append(weather_q)

    # 깊이 5m 이상 → 흙막이 검색어 추가
    if req.digDepth >= 5.0:
        parts.append("흙막이 지보공 굴착깊이 5m 이상 KCS 21 30 굴착공사 안전기준")

    # 암반 또는 수중 특수 조건
    if req.soilZone == "Rock":
        parts.append("암반 굴착 시 장비 진동 소음 민원 발파 진동 기준 KDS KCS 암질 판정")
    if req.soilZone == "Water":
        parts.append("굴착 시 지하수 처리 차수 그라우팅 강변 굴착 세굴 방지")

    if req.query:
        parts.append(req.query.strip()[:100])

    full_query = " ".join(parts)[:350]

    # ── 2. RAG 검색 ───────────────────────────────────────────────────────────
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
        meta  = doc.metadata
        source = f"{meta.get('code', '')} {meta.get('title', '')}".strip() or meta.get("source", "알 수 없음")
        series = meta.get("series", "") or meta.get("category", "")
        citations.append(ExcavationCitation(source=source, series=series, content=text[:500]))

    # ── 3. LLM 요약 생성 ──────────────────────────────────────────────────────
    spec_excerpt = "\n".join(
        f"[{c.source}] {c.content[:180]}" for c in citations[:3]
    ) or "관련 시방서 조문 없음"

    hardness_map = {
        "Sandy Soil": "0.85× (모래, 굴착 쉬움)",
        "Common Earth": "1.0× (기준)",
        "Gravel": "1.2× (자갈, 다짐 필요)",
        "Rock": "3.5× (암반, 기계굴착 한계)",
        "Water": "0.3× 토적 효율 (수중 손실)",
    }
    hardness_desc = hardness_map.get(req.soilZone, "1.0×")

    summary_prompt = (
        f"다음은 현재 굴착 시뮬레이션 상태입니다:\n"
        f"- 토질 구역: {req.soilZone} (굴착 저항: {hardness_desc})\n"
        f"- 날씨: {req.weatherMode}\n"
        f"- 누계 굴착량: {req.totalExcav:.2f} m³ / 성토량: {req.totalFill:.2f} m³\n"
        f"- 현재 굴착 깊이: {req.digDepth:.2f} m\n\n"
        f"관련 시방서 조문:\n{spec_excerpt}\n\n"
        "위 내용을 바탕으로 현재 굴착 조건의 특징, 주의사항, 시방서 적용 기준을 "
        "3~5줄로 한국어로 간결하게 요약해 주세요."
    )

    try:
        resp = llm_precise.invoke([HumanMessage(content=summary_prompt)])
        summary = resp.content.strip()
    except Exception:
        summary = f"{req.soilZone} 구역 굴착 중입니다. 누계 굴착량 {req.totalExcav:.2f}m³, 성토량 {req.totalFill:.2f}m³."

    return ExcavationSpecResponse(
        citations=citations,
        summary=summary,
        hasData=len(citations) > 0,
        query=full_query,
    )


@app.delete("/session/{session_id}")
def clear_session(session_id: str):
    """Clear session state."""
    _session_store.pop(session_id, None)
    return {"status": "cleared", "session_id": session_id}


@app.get("/health")
def health():
    """서버 + RAG DB 상태 헬스체크."""
    import logging as _log
    _logger = _log.getLogger("health")
    from tools.construction_rag_tool import search_construction_docs
    rag_ok = False
    try:
        results = search_construction_docs("건설 기준", k=1)
        rag_ok = bool(results)
        if not rag_ok:
            _logger.warning("[health] RAG collection is empty — run build_rag_index.py")
    except Exception:
        _logger.error("[health] RAG connection failed", exc_info=True)

    return {"status": "ok", "rag": rag_ok}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7070)
