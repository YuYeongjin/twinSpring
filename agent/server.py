"""
FastAPI server - exposes LangGraph Multi-Agent as REST API

Run: uvicorn server:app --host 0.0.0.0 --port 7070 --reload
"""

import json
import traceback
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from graph import graph
from llm_config import llm_chat
from nodes.chat import chat_node, _SYSTEM_BASE
from nodes.supervisor import supervisor_node
from lang_util import detect_lang, lang_instruction

app = FastAPI(title="Digital Twin AI Agent", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Per-session state store (pending_action and other Python Agent internal state)
# key: session_id, value: {"pending_action": dict | None}
_session_store: dict[str, dict] = {}


# ── Request/Response schemas ──────────────────────────────────────────────

class HistoryMessage(BaseModel):
    role: str       # "user" | "assistant"
    content: str

class ChatContext(BaseModel):
    projectId: str | None = None               # BIM project ID
    simulationProjectId: str | None = None     # Simulation project ID
    wbsProjectId: str | None = None            # WBS project ID (CPM/균열 감지 자동 태스크 추가용)

class ChatRequest(BaseModel):
    message: str
    session_id: str = "default"   # Session ID passed from Spring Boot
    history: list[HistoryMessage] = []
    context: ChatContext = ChatContext()

class ChatResponse(BaseModel):
    response: str
    intent: str | None = None
    nextAgent: str | None = None      # Which specialized agent handled the request
    bimData: dict | None = None       # Structured data returned from bim_agent
    sensorData: dict | None = None    # Sensor/energy data returned from sensor_agent

class MultimodalRequest(BaseModel):
    message: str = "Please analyze this image."
    image_base64: str        # data URL or raw base64
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
