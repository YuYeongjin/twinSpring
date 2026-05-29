"""
Node 1: Prompt analysis + routing classification

Strategy:
1. If pending_action exists, route immediately to bim_builder (multi-step BIM conversation in progress)
2. Fast keyword matching
"""

import re
from langchain_core.messages import HumanMessage, SystemMessage
from config.state import AgentState
from config.llm_config import llm_precise



# Tab information / usage guide
_TAB_GUIDE_KEYWORDS = re.compile(
    # Tab-specific: "simulation 탭 설명해줘", "safe 탭 어떻게 써?", "test tab guide"
    r"(simulation|시뮬레이션|bim|test|테스트|safe|안전)\s*탭.{0,20}(설명|안내|기능|뭐|어떻게|사용|도움|가이드|소개|알려)"
    r"|(설명|안내|기능|사용법|사용방법|도움|가이드|소개).{0,15}탭"
    # Tab overview
    r"|탭.{0,10}(종류|목록|전체|모두|뭐가|어떤)"
    r"|어떤\s*탭.{0,10}(있|있나|있어|있습니까)"
    r"|대시보드.{0,15}(안내|소개|설명|기능)"
    # Test tab specific
    r"|test\s*탭|테스트\s*탭|충돌\s*테스트.{0,20}(어떻게|뭐야|설명|사용|안내|가이드)"
    r"|키보드\s*(단축키|조작법|컨트롤|제어|사용법)"
    r"|collision\s*test.{0,20}(how|what|guide|use)"
    # Safe tab specific
    r"|safe\s*탭|safety\s*탭|안전\s*탭|안전\s*모니터링.{0,20}(어떻게|설명|뭐야|안내)"
    r"|헬멧\s*감지.{0,20}(어떻게|설명|뭐야)|webcam\s*detect"
    # BIM tab (as tab info, not BIM operations)
    r"|bim\s*탭|bim\s*뷰어.{0,20}(설명|안내|사용법|기능)"
    r"|bim\s*viewer.{0,20}(how|guide|use|what)"
    # Simulation tab (as tab info, not simulator commands)
    r"|simulation\s*탭|시뮬레이션\s*탭|시뮬레이션\s*대시보드.{0,20}(설명|안내|기능)"
    # English equivalents
    r"|tab\s*(overview|guide|help|tutorial)|what\s*(tabs|features).{0,20}(available|exist)"
    r"|how\s*to\s*use\s*(the\s*)?(simulation|bim|test|safe)\s*(tab|dashboard)",
    re.IGNORECASE,
)

_RAG_DB_KEYWORDS = re.compile(
    r"온도|습도|센서|알림|경보|알람|임계|threshold"
    r"|현재\s*(상태|값|데이터)|최근|조회|확인|얼마|몇\s*도"
    r"|temperature|humidity|sensor|alert|alarm|current\s*(status|value|data)|recent",
    re.IGNORECASE,
)

# BIM data query (read/statistics, not create/modify)
_BIM_QUERY_KEYWORDS = re.compile(
    r"프로젝트\s*(목록|리스트|현황|조회|보여|알려|확인|몇\s*개)"
    r"|부재\s*(수|개수|목록|현황|통계|구성|조회|종류|몇\s*개)"
    r"|몇\s*(개의|개|종류).*부재"
    r"|bim.*조회|bim.*목록|bim.*현황|bim.*통계|bim.*부재"
    r"|어떤.*부재|부재.*어떤|부재.*있"
    r"|내\s*프로젝트|내\s*bim"
    r"|project\s*(list|overview|stats)|element\s*(count|stats|list)",
    re.IGNORECASE,
)

_BIM_KEYWORDS = re.compile(
    r"기둥|IfcColumn|보(?!\w)|IfcBeam|벽|IfcWall|슬래브|IfcSlab|교각|IfcPier"
    r"|추가|생성|만들|삭제|제거|수정|변경|프로젝트\s*(생성|만들|추가)"
    r"|bim|ifc"
    r"|피사의\s*사탑|피사탑|에펠탑|피라미드|부르즈\s*할리파|랜드마크"
    r"|인천대교|사장교|케이블교"
    r"|column|beam|wall|slab|pier|add|create|delete|remove|modify"
    r"|타워|tower|pyramid|구조물|건축물",
    re.IGNORECASE,
)

# Simulation control keywords
_SIMULATION_KEYWORDS = re.compile(
    r"굴착기|굴삭기|excavator"
    r"|붐\s*(각도|올려|내려|설정|변경)|boom\s*(angle|up|down)"
    r"|암\s*(각도|굴절|설정|변경)|arm\s*(angle|bend)"
    r"|버킷\s*(각도|설정|변경|열어|닫아)|bucket\s*(angle)"
    r"|선회\s*(각도|설정|변경)|swing\s*(angle)"
    r"|dig\s*자세|dump\s*자세|travel\s*자세|idle\s*자세"
    r"|굴착\s*(자세|모드|프리셋)|덤핑\s*(자세|모드|프리셋)"
    r"|이동\s*(자세|모드)|대기\s*(자세|모드)"
    r"|시뮬레이션\s*(상태|제어|조회|초기화)"
    r"|굴착기\s*(상태|초기화|리셋|위치|이동)",
    re.IGNORECASE,
)

_SYSTEM_PROMPT = SystemMessage(content=(
    "Classify the user message into exactly one of: rag_db, bim_builder, bim_query, simulation_controller, tab_guide, chat\n"
    "- rag_db: sensor data query or building status check (temperature, humidity, alerts)\n"
    "- bim_builder: create/modify/delete BIM elements (column, beam, wall, slab, etc.)\n"
    "- bim_query: list BIM projects, check element count/statistics/composition\n"
    "- simulation_controller: excavator simulation control (set angles, presets, reset, status query)\n"
    "- tab_guide: explain or give usage guidance for a dashboard tab (simulation, bim, test, safe)\n"
    "- chat: general conversation\n"
    "Respond with exactly one word."
))


def analyze_node(state: AgentState) -> dict:
    # If pending_action exists, route immediately to bim_builder (multi-step BIM conversation)
    if state.get("pending_action"):
        return {"intent": "bim_builder"}

    last_message = state["messages"][-1]
    user_text = last_message.content if hasattr(last_message, "content") else str(last_message)

    # Keyword matching (fast path) — checked in priority order
    # tab_guide is checked first so "simulation 탭 설명해줘" doesn't fall into simulation_controller
    if _TAB_GUIDE_KEYWORDS.search(user_text):
        return {"intent": "tab_guide"}
    if _SIMULATION_KEYWORDS.search(user_text):
        return {"intent": "simulation_controller"}
    if _BIM_QUERY_KEYWORDS.search(user_text):
        return {"intent": "bim_query"}
    if _BIM_KEYWORDS.search(user_text):
        return {"intent": "bim_builder"}
    if _RAG_DB_KEYWORDS.search(user_text):
        return {"intent": "rag_db"}

    # LLM judgment
    try:
        response = llm_precise.invoke([
            _SYSTEM_PROMPT,
            HumanMessage(content=user_text),
        ])
        raw = response.content.strip().lower()
        if "tab_guide" in raw or "tab" in raw and "guide" in raw:
            intent = "tab_guide"
        elif "simulation" in raw or "excavator" in raw:
            intent = "simulation_controller"
        elif "bim_query" in raw or "query" in raw:
            intent = "bim_query"
        elif "bim" in raw:
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
