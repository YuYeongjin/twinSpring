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
