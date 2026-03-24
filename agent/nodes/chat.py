"""
Node 3: 일반 대화 LLM 노드 (Ollama - Llama 3.2 1B)

1B 모델 특성상 시스템 프롬프트를 짧고 영어로 유지하고,
사용자 메시지는 그대로 전달합니다.
"""

from langchain_core.messages import SystemMessage, AIMessage
from state import AgentState
from llm import llm_chat

# 1B 모델은 짧은 영어 시스템 프롬프트가 더 잘 작동
_SYSTEM = SystemMessage(content=(
    "You are a smart building digital twin assistant. "
    "Answer helpfully in Korean. Keep answers concise."
))


def chat_node(state: AgentState) -> dict:
    messages = [_SYSTEM] + list(state["messages"])

    try:
        response = llm_chat.invoke(messages)
        content = response.content.strip()
    except Exception as e:
        content = f"응답 생성 중 오류가 발생했습니다: {e}"

    return {
        "messages": [AIMessage(content=content)],
        "query_result": None,
        "context": None,
    }
