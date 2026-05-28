"""
FastAPI server - exposes LangGraph Multi-Agent as REST API

Run: uvicorn server:app --host 0.0.0.0 --port 7070 --reload
"""
from __future__ import annotations   # Python 3.9 호환: X | Y union 타입 허용

import json
import traceback
from typing import Dict, List, Optional
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

# Per-session state store (pending_action and other Python Agent internal state)
_session_store: Dict[str, dict] = {}


# ── Request/Response schemas ──────────────────────────────────────────────

class HistoryMessage(BaseModel):
    role: str       # "user" | "assistant"
    content: str

class ChatContext(BaseModel):
    projectId: Optional[str] = None               # BIM project ID
    simulationProjectId: Optional[str] = None     # Simulation project ID
    wbsProjectId: Optional[str] = None            # WBS project ID (selected project)

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

    # Load pending_action from session
    session_data = _session_store.get(req.session_id, {})
    pending_action = session_data.get("pending_action")

    initial_state = {
        "messages":              messages,
        "intent":                None,
        "next_agent":            None,
        "query_result":          None,
        "context":               None,
        "bim_project_id":        req.context.projectId,
        "simulation_project_id": req.context.simulationProjectId,
        "wbs_project_id":        req.context.wbsProjectId,
        "bim_data":              None,
        "sensor_data":           None,
        "pending_action":        pending_action,
    }

    try:
        result = graph.invoke(initial_state)
    except Exception:
        traceback.print_exc()
        return ChatResponse(
            response="An error occurred while processing your request. Please try again.",
            intent="chat",
        )

    # Save pending_action to session (maintain multi-step BIM conversation)
    _session_store[req.session_id] = {
        "pending_action": result.get("pending_action")
    }

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

    session_data = _session_store.get(req.session_id, {})
    pending_action = session_data.get("pending_action")

    initial_state = {
        "messages":              messages,
        "intent":                None,
        "next_agent":            None,
        "query_result":          None,
        "context":               None,
        "bim_project_id":        req.context.projectId,
        "simulation_project_id": req.context.simulationProjectId,
        "bim_data":              None,
        "sensor_data":           None,
        "pending_action":        pending_action,
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
                _session_store[req.session_id] = {"pending_action": full_result.get("pending_action")}

                done_event = {
                    "done":       True,
                    "response":   last_content,
                    # agent 가 반환한 refined intent 우선 사용
                    # (bim_query/bim_builder/sensor_agent 등 세부 구분 보존)
                    # agent 가 intent 를 반환하지 않은 경우 supervisor intent 로 폴백
                    "intent":     full_result.get("intent") or intent,
                    "nextAgent":  next_agent,
                    "bimData":    full_result.get("bim_data"),
                    "sensorData": full_result.get("sensor_data"),
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

            _session_store[req.session_id] = {"pending_action": None}
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
        "pending_action":        None,
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
    "COLLISION": "부재 충돌 보정 공정 구조안전 확인 절차 간섭 오차",
    "CRACK":     "구조물 균열 균열보수 보수공사 콘크리트 균열폭 시공기준",
    "SAFE_ZONE": "안전구역 위험구역 안전점검 안전관리 출입금지 구역설정",
    "SAFETY":    "안전보호구 안전복장 안전모 착용기준 안전교육 작업자",
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
    except Exception as e:
        print(f"[wbs_rag_suggest] RAG 검색 오류: {e}")
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


@app.delete("/session/{session_id}")
def clear_session(session_id: str):
    """Clear session state (pending_action, etc.)."""
    _session_store.pop(session_id, None)
    return {"status": "cleared", "session_id": session_id}


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7070)
