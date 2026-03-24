"""
Node 3: 일반 대화 LLM 노드

데이터 조회 없이 LLM과 직접 대화합니다.
대화 히스토리를 유지하여 문맥 있는 응답을 생성합니다.
"""

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import SystemMessage, AIMessage
from state import AgentState
from config import ANTHROPIC_API_KEY, LLM_MODEL

_llm = ChatAnthropic(
    model=LLM_MODEL,
    api_key=ANTHROPIC_API_KEY,
    temperature=0.7,
    max_tokens=1024,
)

_SYSTEM_PROMPT = """당신은 스마트 빌딩 디지털 트윈 시스템의 친절한 AI 어시스턴트입니다.
사용자와 자연스럽게 대화하고, 시스템 사용법이나 일반적인 질문에 도움을 드립니다.
센서 데이터나 에너지 데이터 조회가 필요한 질문은 "해당 데이터를 조회하려면 구체적으로 질문해 주세요" 라고 안내해 주세요.
한국어로 답변하세요."""


def chat_node(state: AgentState) -> dict:
    """일반 대화 LLM 노드 - 대화 히스토리 포함"""
    messages = [SystemMessage(content=_SYSTEM_PROMPT)] + list(state["messages"])

    response = _llm.invoke(messages)

    return {
        "messages": [AIMessage(content=response.content)],
        "query_result": None,
        "context": None,
    }
