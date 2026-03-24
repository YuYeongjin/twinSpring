"""
Node 1: 프롬프트 분석 + 라우팅 분류

사용자 입력을 분석하여 세 가지 intent 중 하나로 분류합니다.
- "rag_db"      : 센서/에너지/EMS 데이터 조회 또는 건물 정보 검색
- "bim_builder" : BIM 요소 생성, 수정, 삭제 요청
- "chat"        : 일반 대화, 인사, 개념 설명 등
"""

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import SystemMessage, HumanMessage
from state import AgentState
from config import ANTHROPIC_API_KEY, LLM_MODEL

_llm = ChatAnthropic(
    model=LLM_MODEL,
    api_key=ANTHROPIC_API_KEY,
    temperature=0,
    max_tokens=256,
)

_SYSTEM_PROMPT = """당신은 사용자의 요청을 분석하는 AI입니다.
사용자 메시지를 읽고 아래 세 가지 카테고리 중 하나로만 분류하세요.

카테고리:
- rag_db : 다음 중 하나에 해당하는 경우
  * 센서 데이터(온도, 습도) 조회
  * 에너지 사용량, 전력, 전압, 전류 관련 질문
  * EMS 알림, 임계값 관련 질문
  * 건물 BIM 정보 조회, 현황 확인
  * 현재 상태, 최근 기록 등 데이터 조회가 필요한 질문

- bim_builder : 다음 중 하나에 해당하는 경우
  * BIM 요소(기둥, 보, 벽, 슬래브 등) 생성 요청
  * BIM 요소 수정, 크기 변경, 위치 변경 요청
  * BIM 요소 삭제 요청
  * BIM 프로젝트 생성 요청
  * "추가해줘", "만들어줘", "생성해줘", "삭제해줘", "변경해줘" 등의 동작 포함

- chat : 다음 중 하나에 해당하는 경우
  * 인사, 잡담
  * 시스템 사용 방법에 대한 일반 질문
  * 개념 설명 요청
  * 그 외 일반 대화

반드시 "rag_db", "bim_builder", "chat" 중 하나만 답변하세요. 다른 텍스트는 절대 포함하지 마세요."""


def analyze_node(state: AgentState) -> dict:
    """프롬프트를 분석하여 intent를 결정하는 노드"""
    last_message = state["messages"][-1]
    user_text = last_message.content if hasattr(last_message, "content") else str(last_message)

    response = _llm.invoke(
        [
            SystemMessage(content=_SYSTEM_PROMPT),
            HumanMessage(content=user_text),
        ]
    )

    raw = response.content.strip().lower()
    if "bim_builder" in raw:
        intent = "bim_builder"
    elif "rag_db" in raw:
        intent = "rag_db"
    else:
        intent = "chat"

    return {"intent": intent}


def route_by_intent(state: AgentState) -> str:
    """intent에 따라 다음 노드를 결정하는 조건부 엣지 함수"""
    return state.get("intent", "chat")
