"""
Supervisor Node — Multi-Agent 라우터

전략:
1. pending_action 이 있으면 → bim_agent (멀티스텝 BIM 대화 진행 중)
2. 키워드 빠른 매칭 (우선순위 순)
3. LLM 최종 판단 (gemma3:12b)

라우팅 대상:
  sensor_agent     — 온습도 센서 데이터 조회
  bim_agent        — BIM 부재 생성/삭제/조회, 드론·구조해석·IFC 안내
  simulation_agent — 굴착기 시뮬레이션 제어
  safe_agent       — 안전 모니터링 (헬멧·침입 감지, YOLO 서버)
  test_agent       — 충돌 테스트 탭 (키보드 조작법, 충돌 로그)
  tab_guide        — 대시보드 탭 일반 안내
  chat             — 일반 대화
"""

import re
from langchain_core.messages import HumanMessage, SystemMessage

from state import AgentState
from llm_config import llm_precise


# ── 키워드 패턴 ────────────────────────────────────────────────────────────────

# 센서 에이전트: 온습도 데이터
_SENSOR_KEYWORDS = re.compile(
    r"온도|습도|센서|알림|경보|알람|임계|threshold"
    r"|현재\s*(상태|값|데이터)|최근\s*(데이터|기록)"
    r"|얼마|몇\s*도|몇\s*퍼센트"
    r"|temperature|humidity|sensor|alert|alarm"
    r"|current\s*(status|value|data)|recent\s*(data|records)",
    re.IGNORECASE,
)

# BIM 에이전트: 부재 생성/삭제/수정 + 조회 + 드론/구조해석/IFC
_BIM_KEYWORDS = re.compile(
    r"bim|ifc"
    r"|기둥|IfcColumn|보(?!\w)|IfcBeam|벽|IfcWall|슬래브|IfcSlab|교각|IfcPier"
    r"|추가|생성|만들|삭제|제거|수정|변경"
    r"|프로젝트\s*(목록|리스트|현황|보여|알려|확인|몇\s*개|생성|만들)"
    r"|부재\s*(수|개수|목록|현황|통계|구성|종류|몇\s*개|조회)"
    r"|몇\s*(개의|개|종류).*부재"
    r"|피사의?\s*사탑|에펠탑|피라미드|인천대교|교각구조|건물골조|교량경간"
    r"|드론\s*(사진|분석|촬영|영상|이미지|어떻게|안내)"
    r"|구조\s*(해석|분석|안전도|하중)"
    r"|drone|aerial\s*(photo|image|analysis)"
    r"|structural\s*(analysis|assessment|load)"
    r"|ifc\s*(가져오기|임포트|불러오기|변환|import)"
    r"|column|beam|wall|slab|pier"
    r"|add|create|delete|remove|modify"
    r"|타워|tower|pyramid|구조물|건축물|랜드마크"
    r"|내\s*프로젝트|내\s*bim"
    r"|project\s*(list|overview|stats)|element\s*(count|stats|list)",
    re.IGNORECASE,
)

# 시뮬레이션 에이전트: 굴착기 제어
_SIMULATION_KEYWORDS = re.compile(
    r"굴착기|굴삭기|excavator"
    r"|붐\s*(각도|올려|내려|설정|변경)|boom\s*(angle|up|down)"
    r"|암\s*(각도|굴절|설정|변경)|arm\s*(angle|bend)"
    r"|버킷\s*(각도|설정|변경|열어|닫아)|bucket\s*(angle)"
    r"|선회\s*(각도|설정|변경)|swing\s*(angle)"
    r"|dig\s*자세|dump\s*자세|travel\s*자세|idle\s*자세"
    r"|굴착\s*(자세|모드|프리셋)|덤핑\s*(자세|모드|프리셋)"
    r"|이동\s*자세|대기\s*자세"
    r"|시뮬레이션\s*(상태|제어|조회|초기화|리셋)"
    r"|굴착기\s*(상태|초기화|리셋|위치|이동)",
    re.IGNORECASE,
)

# Safe 에이전트: 안전 모니터링
_SAFE_KEYWORDS = re.compile(
    r"헬멧\s*(감지|착용|미착용|위반|인식|탐지|현황)"
    r"|안전모\s*(감지|착용|미착용|위반|인식)"
    r"|침입\s*(감지|탐지|이벤트|기록)"
    r"|yolo|감지\s*(서버|상태|결과|이벤트)"
    r"|안전\s*(위반|통계|이력|이벤트|현황|감지|모니터|모니터링)"
    r"|restricted\s*area|제한\s*구역"
    r"|감지\s*카메라|detection\s*server"
    r"|최근\s*(감지|이벤트|위반)"
    r"|helmet\s*(detect|violation)|safety\s*(violation|event|stats|log)"
    r"|webcam\s*(detect|status)|detection\s*(event|log|history|status)"
    r"|safe\s*탭.*(?:어떻게|설명|안내|기능|사용)"
    r"|safety\s*monitoring.{0,20}(?:how|guide|use|explain)",
    re.IGNORECASE,
)

# Test 에이전트: 충돌 테스트 탭
_TEST_KEYWORDS = re.compile(
    r"충돌\s*(테스트|검사|감지|이력|로그|기록|이벤트)"
    r"|키보드\s*(단축키|조작법|컨트롤|제어|사용법|키|버튼)"
    r"|collision\s*(test|log|history|event|detect)"
    r"|keyboard\s*(shortcut|control|key|how)"
    r"|test\s*탭.{0,20}(?:어떻게|설명|안내|기능|사용|뭐야)"
    r"|충돌\s*테스트.{0,20}(?:어떻게|뭐야|설명|사용|안내|가이드)"
    r"|충돌\s*로그|collision\s*(log|history)"
    r"|w\s*a\s*s\s*d|wasd.{0,20}(?:이동|조작|키)"
    r"|test\s*tab.{0,20}(?:how|guide|use|what|explain)",
    re.IGNORECASE,
)

# Tab 안내: 일반 탭 사용법 (위 전문 에이전트에 해당하지 않는 경우)
_TAB_GUIDE_KEYWORDS = re.compile(
    r"(simulation|시뮬레이션|bim)\s*탭.{0,20}(설명|안내|기능|뭐|어떻게|사용|도움|가이드)"
    r"|(설명|안내|기능|사용법|가이드).{0,15}탭"
    r"|탭.{0,10}(종류|목록|전체|모두|뭐가|어떤)"
    r"|어떤\s*탭.{0,10}(있|있나|있어|있습니까)"
    r"|대시보드.{0,15}(안내|소개|설명|기능)"
    r"|bim\s*(뷰어|viewer).{0,20}(설명|안내|사용법|기능)"
    r"|tab\s*(overview|guide|help|tutorial)"
    r"|what\s*(tabs|features).{0,20}(available|exist)"
    r"|how\s*to\s*use\s*(the\s*)?(simulation|bim)\s*(tab|dashboard)",
    re.IGNORECASE,
)

# LLM 분류 시스템 프롬프트
_SYSTEM_PROMPT = SystemMessage(content=(
    "Classify the user message into exactly one of: "
    "sensor_agent, bim_agent, simulation_agent, safe_agent, test_agent, tab_guide, chat\n\n"
    "- sensor_agent: temperature/humidity sensor data queries, alert thresholds\n"
    "- bim_agent: BIM element creation/deletion/query, drone analysis, structural analysis, IFC import, project management\n"
    "- simulation_agent: excavator simulation control (angles, presets, position, reset, status)\n"
    "- safe_agent: safety monitoring, helmet detection, YOLO server, restricted area intrusion, safety statistics\n"
    "- test_agent: collision test tab, keyboard shortcuts, collision event log\n"
    "- tab_guide: general dashboard tab usage guide (simulation tab, BIM tab overview)\n"
    "- chat: general conversation unrelated to above domains\n\n"
    "Respond with exactly one word."
))


def supervisor_node(state: AgentState) -> dict:
    """
    Supervisor 노드: 사용자 메시지를 분석하여 처리할 에이전트를 결정합니다.
    `next_agent` 와 `intent` 를 설정하고 반환합니다.
    """
    # ── 경로 0: multi-step BIM 대화 진행 중 ─────────────────────────────────
    if state.get("pending_action"):
        return {"intent": "bim_agent", "next_agent": "bim_agent"}

    last_message = state["messages"][-1]
    user_text = last_message.content if hasattr(last_message, "content") else str(last_message)

    # ── 키워드 빠른 매칭 (우선순위 순) ─────────────────────────────────────
    # 1. Test 탭 (충돌 테스트·키보드) — safe/tab_guide 보다 먼저
    if _TEST_KEYWORDS.search(user_text):
        return {"intent": "test_agent", "next_agent": "test_agent"}

    # 2. Safe 탭 (헬멧·YOLO·침입) — tab_guide 보다 먼저
    if _SAFE_KEYWORDS.search(user_text):
        return {"intent": "safe_agent", "next_agent": "safe_agent"}

    # 3. 시뮬레이션 에이전트 (굴착기 제어)
    if _SIMULATION_KEYWORDS.search(user_text):
        return {"intent": "simulation_agent", "next_agent": "simulation_agent"}

    # 4. BIM 에이전트 (부재·프로젝트·드론·구조해석·IFC)
    if _BIM_KEYWORDS.search(user_text):
        return {"intent": "bim_agent", "next_agent": "bim_agent"}

    # 5. 센서 에이전트 (온습도)
    if _SENSOR_KEYWORDS.search(user_text):
        return {"intent": "sensor_agent", "next_agent": "sensor_agent"}

    # 6. 일반 탭 안내
    if _TAB_GUIDE_KEYWORDS.search(user_text):
        return {"intent": "tab_guide", "next_agent": "tab_guide"}

    # ── LLM 최종 판단 ────────────────────────────────────────────────────────
    try:
        response = llm_precise.invoke([
            _SYSTEM_PROMPT,
            HumanMessage(content=user_text),
        ])
        raw = response.content.strip().lower()

        if "test" in raw:
            agent = "test_agent"
        elif "safe" in raw:
            agent = "safe_agent"
        elif "simulation" in raw or "excavator" in raw:
            agent = "simulation_agent"
        elif "bim" in raw:
            agent = "bim_agent"
        elif "sensor" in raw or "rag" in raw or "db" in raw:
            agent = "sensor_agent"
        elif "tab" in raw or "guide" in raw:
            agent = "tab_guide"
        else:
            agent = "chat"
    except Exception:
        agent = "chat"

    return {"intent": agent, "next_agent": agent}


def route_by_next_agent(state: AgentState) -> str:
    """Conditional edge: next_agent 값에 따라 노드를 선택합니다."""
    return state.get("next_agent") or "chat"
