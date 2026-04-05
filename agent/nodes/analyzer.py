"""
Node 1: 프롬프트 분석 + 라우팅 분류

전략:
1. pending_action이 있으면 bim_builder로 즉시 라우팅 (다단계 BIM 대화 진행 중)
2. 키워드 매칭으로 빠른 분류
3. gemma3:12b LLM으로 최종 판단
"""

import re
from langchain_core.messages import HumanMessage, SystemMessage
from state import AgentState
from llm_config import llm_precise

_RAG_DB_KEYWORDS = re.compile(
    r"온도|습도|센서|에너지|전력|전압|전류|kwh|kw|알림|경보|알람|임계|threshold"
    r"|현재\s*(상태|값|데이터)|최근|조회|확인|얼마|몇\s*(도|volt|kw)",
    re.IGNORECASE,
)

_BIM_KEYWORDS = re.compile(
    r"기둥|IfcColumn|보(?!\w)|IfcBeam|벽|IfcWall|슬래브|IfcSlab|교각|IfcPier"
    r"|추가|생성|만들|삭제|제거|수정|변경|프로젝트\s*(생성|만들|추가)"
    r"|bim|ifc",
    re.IGNORECASE,
)

_SYSTEM_PROMPT = SystemMessage(content=(
    "사용자 메시지를 다음 중 하나로 분류하세요: rag_db, bim_builder, chat\n"
    "- rag_db: 센서/에너지/EMS 데이터 조회 또는 건물 상태 확인\n"
    "- bim_builder: BIM 요소(기둥, 보, 벽, 슬래브 등) 생성/수정/삭제\n"
    "- chat: 일반 대화\n"
    "단 하나의 단어만 응답하세요."
))


def analyze_node(state: AgentState) -> dict:
    # pending_action이 있으면 bim_builder로 즉시 라우팅 (다단계 BIM 대화 진행 중)
    if state.get("pending_action"):
        return {"intent": "bim_builder"}

    last_message = state["messages"][-1]
    user_text = last_message.content if hasattr(last_message, "content") else str(last_message)

    # 키워드 매칭 (빠른 경로)
    if _BIM_KEYWORDS.search(user_text):
        return {"intent": "bim_builder"}
    if _RAG_DB_KEYWORDS.search(user_text):
        return {"intent": "rag_db"}

    # LLM 판단
    try:
        response = llm_precise.invoke([
            _SYSTEM_PROMPT,
            HumanMessage(content=user_text),
        ])
        raw = response.content.strip().lower()
        if "bim" in raw:
            intent = "bim_builder"
        elif "rag" in raw or "db" in raw or "data" in raw:
            intent = "rag_db"
        else:
            intent = "chat"
    except Exception:
        intent = "chat"

    return {"intent": intent}


def route_by_intent(state: AgentState) -> str:
    return state.get("intent", "chat")
