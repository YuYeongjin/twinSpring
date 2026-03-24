"""
Node 1: 프롬프트 분석 + 라우팅 분류

전략: 키워드 매칭을 우선 적용하고, 판단이 어려운 경우에만 LLM을 사용합니다.
1B 소형 모델의 한계를 보완하고 라즈베리파이에서 응답 속도를 높입니다.

intent:
- "rag_db"      : 센서/에너지/EMS 데이터 조회
- "bim_builder" : BIM 요소 생성, 수정, 삭제
- "chat"        : 일반 대화
"""

import re
from langchain_core.messages import HumanMessage
from state import AgentState
from llm import llm_precise

# ── 키워드 기반 빠른 분류 ──────────────────────────────────────────

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

# LLM 판단용 프롬프트 (영어로 작성 - 1B 모델은 영어가 더 안정적)
_LLM_PROMPT = (
    "Classify the user message into one of: rag_db, bim_builder, chat.\n"
    "- rag_db: query sensor/energy/EMS data or building status\n"
    "- bim_builder: create/update/delete BIM elements or projects\n"
    "- chat: general conversation\n"
    "Reply with ONLY one word.\n\n"
    "Message: {text}\nAnswer:"
)


def analyze_node(state: AgentState) -> dict:
    last_message = state["messages"][-1]
    user_text = last_message.content if hasattr(last_message, "content") else str(last_message)

    # 1단계: 키워드 매칭 (빠른 경로)
    if _BIM_KEYWORDS.search(user_text):
        return {"intent": "bim_builder"}
    if _RAG_DB_KEYWORDS.search(user_text):
        return {"intent": "rag_db"}

    # 2단계: LLM 판단 (키워드로 판단 불가한 경우)
    try:
        response = llm_precise.invoke(
            [HumanMessage(content=_LLM_PROMPT.format(text=user_text))]
        )
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
