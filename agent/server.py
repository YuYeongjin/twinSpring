"""
FastAPI 서버 - LangGraph Agent를 REST API로 노출

실행: uvicorn server:app --host 0.0.0.0 --port 8000 --reload
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from langchain_core.messages import HumanMessage, AIMessage
from graph import graph

app = FastAPI(title="Digital Twin AI Agent", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── 요청/응답 스키마 ──────────────────────────────────────────────

class HistoryMessage(BaseModel):
    role: str       # "user" | "assistant"
    content: str

class ChatContext(BaseModel):
    projectId: str | None = None

class ChatRequest(BaseModel):
    message: str
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

    # 현재 사용자 메시지 추가
    messages = history_messages + [HumanMessage(content=req.message)]

    # 컨텍스트를 state에 주입
    initial_state = {
        "messages": messages,
        "intent": None,
        "query_result": None,
        "context": None,
        "bim_project_id": req.context.projectId,
    }

    result = graph.invoke(initial_state)

    return ChatResponse(
        response=result["messages"][-1].content,
        intent=result.get("intent"),
    )


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
