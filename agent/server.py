"""
FastAPI 서버 - LangGraph Agent를 REST API로 노출

실행: uvicorn server:app --host 0.0.0.0 --port 7070 --reload
"""

import traceback
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from langchain_core.messages import HumanMessage, AIMessage
from graph import graph
from llm_config import llm_chat

app = FastAPI(title="Digital Twin AI Agent", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 세션별 상태 저장소 (pending_action 등 Python Agent 내부 상태)
# key: session_id, value: {"pending_action": dict | None}
_session_store: dict[str, dict] = {}


# ── 요청/응답 스키마 ──────────────────────────────────────────────

class HistoryMessage(BaseModel):
    role: str       # "user" | "assistant"
    content: str

class ChatContext(BaseModel):
    projectId: str | None = None

class ChatRequest(BaseModel):
    message: str
    session_id: str = "default"   # Spring Boot에서 전달하는 세션 ID
    history: list[HistoryMessage] = []
    context: ChatContext = ChatContext()

class ChatResponse(BaseModel):
    response: str
    intent: str | None = None
    bimData: dict | None = None   # bim_query 노드에서 반환하는 구조화 데이터

class MultimodalRequest(BaseModel):
    message: str = "이 이미지를 분석해주세요."
    image_base64: str        # data URL 또는 순수 base64
    session_id: str = "default"


# ── 엔드포인트 ────────────────────────────────────────────────────

@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    """메시지를 LangGraph 에이전트로 전달하고 응답을 반환합니다."""

    # 히스토리 변환
    history_messages = []
    for msg in req.history:
        if msg.role == "user":
            history_messages.append(HumanMessage(content=msg.content))
        else:
            history_messages.append(AIMessage(content=msg.content))

    messages = history_messages + [HumanMessage(content=req.message)]

    # 세션에서 pending_action 로드
    session_data = _session_store.get(req.session_id, {})
    pending_action = session_data.get("pending_action")

    initial_state = {
        "messages": messages,
        "intent": None,
        "query_result": None,
        "context": None,
        "bim_project_id": req.context.projectId,
        "pending_action": pending_action,
    }

    try:
        result = graph.invoke(initial_state)
    except Exception as e:
        traceback.print_exc()
        # pending_action은 유지 (다음 요청에서 재시도 가능하도록)
        return ChatResponse(
            response="처리 중 오류가 발생했습니다. 다시 시도해 주세요.",
            intent="chat",
        )

    # 세션에 pending_action 저장 (다단계 BIM 대화 유지)
    _session_store[req.session_id] = {
        "pending_action": result.get("pending_action")
    }

    messages = result.get("messages", [])
    last_content = messages[-1].content if messages else "응답을 받지 못했습니다."

    return ChatResponse(
        response=last_content,
        intent=result.get("intent"),
        bimData=result.get("bim_data"),
    )


@app.post("/chat-multimodal", response_model=ChatResponse)
def chat_multimodal(req: MultimodalRequest):
    """이미지 + 텍스트를 Ollama 비전 모델로 분석합니다."""
    try:
        # data URL 접두사 제거 (예: "data:image/jpeg;base64,...")
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
            response="이미지 분석 중 오류가 발생했습니다. 모델이 비전을 지원하는지 확인해 주세요.",
            intent="vision",
        )


@app.delete("/session/{session_id}")
def clear_session(session_id: str):
    """세션 상태(pending_action 등)를 초기화합니다."""
    _session_store.pop(session_id, None)
    return {"status": "cleared", "session_id": session_id}


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7070)
