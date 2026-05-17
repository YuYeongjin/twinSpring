"""
FastAPI server - exposes LangGraph Agent as REST API

Run: uvicorn server:app --host 0.0.0.0 --port 7070 --reload
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

class ChatRequest(BaseModel):
    message: str
    session_id: str = "default"   # Session ID passed from Spring Boot
    history: list[HistoryMessage] = []
    context: ChatContext = ChatContext()

class ChatResponse(BaseModel):
    response: str
    intent: str | None = None
    bimData: dict | None = None       # Structured data returned from bim_query node
    sensorData: dict | None = None    # Sensor/energy data returned from rag_db node

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
        "messages": messages,
        "intent": None,
        "query_result": None,
        "context": None,
        "bim_project_id":        req.context.projectId,
        "simulation_project_id": req.context.simulationProjectId,
        "pending_action": pending_action,
    }

    try:
        result = graph.invoke(initial_state)
    except Exception as e:
        traceback.print_exc()
        return ChatResponse(
            response="An error occurred while processing your request. Please try again.",
            intent="chat",
        )

    # Save pending_action to session (maintain multi-step BIM conversation)
    _session_store[req.session_id] = {
        "pending_action": result.get("pending_action")
    }

    messages = result.get("messages", [])
    last_content = messages[-1].content if messages else "No response received."

    return ChatResponse(
        response=last_content,
        intent=result.get("intent"),
        bimData=result.get("bim_data"),
        sensorData=result.get("sensor_data"),
    )


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
