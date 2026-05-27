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
  rag_agent        — 건설 공정서·시방서 (KCS·KDS) 검색
  tab_guide        — 대시보드 탭 일반 안내
  chat             — 일반 대화
"""

import re

from config.state import AgentState


# ── 키워드 패턴 ────────────────────────────────────────────────────────────────

# 센서 에이전트: 온습도 데이터 (한/영/일)
_SENSOR_KEYWORDS = re.compile(
    # 한국어
    r"온도|습도|센서|알림|경보|알람|임계"
    r"|현재\s*(상태|값|데이터)|최근\s*(데이터|기록)"
    r"|얼마|몇\s*도|몇\s*퍼센트"
    # 영어
    r"|temperature|humidity|sensor|alert|alarm|threshold"
    r"|current\s*(status|value|data)|recent\s*(data|records)"
    # 일본어
    r"|温度|湿度|センサー|気温|室温"
    r"|温度グラフ|湿度グラフ|温度.{0,5}(グラフ|表示|確認|教|見せ)"
    r"|現在の(温度|湿度|気温)|最新の?(温度|湿度|センサ)"
    r"|温度.{0,5}(履歴|データ|記録)|センサー?(データ|値|状態)"
    r"|アラート|アラーム|閾値",
    re.IGNORECASE,
)

# BIM 에이전트: 부재 생성/삭제/수정 + 조회 + 드론/구조해석/IFC (한/영/일)
_BIM_KEYWORDS = re.compile(
    # 한국어
    r"bim|ifc"
    r"|기둥|IfcColumn|보(?!\w)|IfcBeam|벽|IfcWall|슬래브|IfcSlab|교각|IfcPier"
    r"|추가|생성|만들|삭제|제거|수정|변경"
    r"|프로젝트\s*(목록|리스트|현황|보여|알려|확인|몇\s*개|생성|만들)"
    r"|부재\s*(수|개수|목록|현황|통계|구성|종류|몇\s*개|조회)"
    r"|몇\s*(개의|개|종류).*부재"
    r"|피사의?\s*사탑|에펠탑|피라미드|인천대교|교각구조|건물골조|교량경간"
    r"|드론\s*(사진|분析|촬영|영상|이미지|어떻게|안내)"
    r"|구조\s*(해석|분析|안전도|하중)"
    # 영어
    r"|drone|aerial\s*(photo|image|analysis)"
    r"|structural\s*(analysis|assessment|load)"
    r"|ifc\s*(import|export)|column|beam|wall|slab|pier"
    r"|add|create|delete|remove|modify"
    r"|tower|pyramid|landmark"
    r"|project\s*(list|overview|stats)|element\s*(count|stats|list)"
    # 일본어
    r"|柱|梁|壁|スラブ|橋脚"
    r"|プロジェクト\s*(一覧|リスト|作成|確認|状況)"
    r"|部材\s*(数|一覧|統計|種類|追加|削除)"
    r"|追加する|作成する|削除する|変更する|修正する"
    r"|ドローン\s*(写真|分析|撮影|画像)"
    r"|構造\s*(解析|分析|荷重)"
    r"|BIMモデル|IFCファイル",
    re.IGNORECASE,
)

# 시뮬레이션 에이전트: 굴착기 제어 (한/영/일)
_SIMULATION_KEYWORDS = re.compile(
    # 한국어
    r"굴착기|굴삭기"
    r"|붐\s*(각도|올려|내려|설정|변경)"
    r"|암\s*(각도|굴절|설정|변경)"
    r"|버킷\s*(각도|설정|변경|열어|닫아)"
    r"|선회\s*(각도|설정|변경)"
    r"|dig\s*자세|dump\s*자세|travel\s*자세|idle\s*자세"
    r"|굴착\s*(자세|모드|프리셋)|덤핑\s*(자세|모드|프리셋)"
    r"|이동\s*자세|대기\s*자세"
    r"|시뮬레이션\s*(상태|제어|조회|초기화|리셋)"
    r"|굴착기\s*(상태|초기화|리셋|위치|이동)"
    # 영어
    r"|excavator"
    r"|boom\s*(angle|up|down)|arm\s*(angle|bend)"
    r"|bucket\s*(angle)|swing\s*(angle)"
    # 일본어
    r"|掘削機|ショベルカー|バックホウ|ユンボ"
    r"|ブーム\s*(角度|上げ|下げ|設定)"
    r"|アーム\s*(角度|設定|変更)"
    r"|バケット\s*(角度|設定|開|閉)"
    r"|旋回\s*(角度|設定)"
    r"|掘削\s*(姿勢|モード)|ダンプ\s*(姿勢|モード)"
    r"|シミュレーション\s*(状態|制御|リセット|初期化)",
    re.IGNORECASE,
)

# Safe 에이전트: 안전 모니터링 (한/영/일)
_SAFE_KEYWORDS = re.compile(
    # 한국어
    r"헬멧\s*(감지|착용|미착용|위반|인식|탐지|현황)"
    r"|안전모\s*(감지|착용|미착용|위반|인식)"
    r"|침입\s*(감지|탐지|이벤트|기록)"
    r"|yolo|감지\s*(서버|상태|결과|이벤트)"
    r"|안전\s*(위반|통계|이력|이벤트|현황|감지|모니터|모니터링)"
    r"|제한\s*구역|감지\s*카메라"
    r"|최근\s*(감지|이벤트|위반)"
    # 영어
    r"|helmet\s*(detect|violation)|safety\s*(violation|event|stats|log)"
    r"|webcam\s*(detect|status)|detection\s*(event|log|history|status)"
    r"|restricted\s*area|detection\s*server"
    r"|safety\s*monitoring.{0,20}(?:how|guide|use|explain)"
    # 일본어
    r"|ヘルメット\s*(検知|着用|未着用|違反|認識)"
    r"|侵入\s*(検知|検出|イベント|記録)"
    r"|安全\s*(違反|統計|履歴|イベント|状況|監視|モニタリング)"
    r"|制限区域|検知カメラ"
    r"|最近の(検知|イベント|違反)"
    r"|安全監視.{0,20}(方法|説明|使い方|機能)",
    re.IGNORECASE,
)

# Test 에이전트: 충돌 테스트 탭 (한/영/일)
_TEST_KEYWORDS = re.compile(
    # 한국어
    r"충돌\s*(테스트|검사|감지|이력|로그|기록|이벤트)"
    r"|키보드\s*(단축키|조작법|컨트롤|제어|사용법|키|버튼)"
    r"|충돌\s*테스트.{0,20}(?:어떻게|뭐야|설명|사용|안내|가이드)"
    r"|충돌\s*로그"
    r"|w\s*a\s*s\s*d|wasd.{0,20}(?:이동|조작|키)"
    # 영어
    r"|collision\s*(test|log|history|event|detect)"
    r"|keyboard\s*(shortcut|control|key|how)"
    r"|test\s*tab.{0,20}(?:how|guide|use|what|explain)"
    # 일본어
    r"|衝突\s*(テスト|検査|検出|ログ|履歴|イベント)"
    r"|キーボード\s*(ショートカット|操作|制御|使い方|キー)"
    r"|衝突テスト.{0,20}(方法|説明|使い方|ガイド)"
    r"|衝突ログ",
    re.IGNORECASE,
)

# RAG 에이전트: 건설 공정서·시방서 (KCS·KDS) 검색
_RAG_KEYWORDS = re.compile(
    # 규격 코드 직접 언급
    r"kcs|kds"
    # 한국어 — 문서 종류
    r"|시방서|공정서|설계기준|표준시방"
    r"|건설\s*(기준|규정|표준|규격)"
    r"|규격\s*(코드|기준|번호)"
    # 한국어 — 공종·재료명
    r"|콘크리트\s*(설계|기준|시공|강도|배합|타설|양생|압축|균열)"
    r"|철근\s*(배근|간격|피복|이음|겹침|정착)"
    r"|강구조\s*(설계|기준|피로|내진|성능)"
    r"|말뚝\s*(기초|설계|시공|지지력|항타)"
    r"|얕은\s*(기초|기초\s*설계)"
    r"|깊은\s*(기초|기초\s*설계)"
    r"|앵커\s*(설계|시공|긴장|정착)"
    r"|비탈면\s*(보호|보강|배수|낙석|설계|시공)"
    r"|옹벽\s*(설계|시공|콘크리트|보강토|돌망태)"
    r"|지반\s*(조사|설계|계측|개량|연약)"
    r"|연약\s*지반\s*(설계|개량|압밀)"
    r"|토공\s*(시공|자동화|다짐|쌓기|깎기)"
    r"|측량\s*(설계|시공|건설|수심|해상)"
    r"|교량\s*(설계|시공|난간|방수|경간|기초)"
    r"|프리스트레싱|PSC|포스트텐션|프리텐션"
    r"|프리캐스트\s*(콘크리트|PC|설계|시공)"
    r"|슬래브\s*(설계|기초판|시공)"
    r"|벽체\s*(설계|시공|콘크리트)"
    r"|피로\s*(설계|파단|내구성)"
    r"|내진\s*(설계|기준|성능)"
    r"|교면\s*(방수|포장)"
    r"|케이블\s*(공사|교량)"
    r"|충격\s*분산\s*장치"
    r"|머신\s*(가이던스|컨트롤)"
    r"|OSC\s*건설|모듈러|공장제작"
    r"|계측\s*(공사|장비|관리)"
    # 한국어 — 조건/기준 질문 패턴
    r"|시공\s*(기준|규정|요건|방법|절차)"
    r"|품질\s*(관리|기준|시험|검사)"
    r"|허용\s*(응력|변형|처짐|균열)"
    r"|설계\s*(하중|강도|기준값|계수)"
    # 영어
    r"|specification|standard\s*spec"
    r"|construction\s*(standard|code|spec)"
    r"|design\s*(criteria|standard|code)"
    r"|concrete\s*(mix|strength|placement|curing)"
    r"|reinforcement\s*(spacing|cover|lap|splice)"
    r"|pile\s*(foundation|design|capacity)"
    r"|slope\s*(protection|stabilization)"
    r"|retaining\s*wall|earthwork|survey\s*(standard|design)",
    re.IGNORECASE,
)

# Tab 안내: 일반 탭 사용법 (한/영/일)
_TAB_GUIDE_KEYWORDS = re.compile(
    # 한국어
    r"(simulation|시뮬레이션|bim)\s*탭.{0,20}(설명|안내|기능|뭐|어떻게|사용|도움|가이드)"
    r"|(설명|안내|기능|사용법|가이드).{0,15}탭"
    r"|탭.{0,10}(종류|목록|전체|모두|뭐가|어떤)"
    r"|어떤\s*탭.{0,10}(있|있나|있어|있습니까)"
    r"|대시보드.{0,15}(안내|소개|설명|기능)"
    r"|bim\s*(뷰어|viewer).{0,20}(설명|안내|사용법|기능)"
    # 영어
    r"|tab\s*(overview|guide|help|tutorial)"
    r"|what\s*(tabs|features).{0,20}(available|exist)"
    r"|how\s*to\s*use\s*(the\s*)?(simulation|bim)\s*(tab|dashboard)"
    # 일본어
    r"|(シミュレーション|BIM)\s*タブ.{0,20}(説明|案内|機能|使い方|ガイド)"
    r"|タブ.{0,10}(種類|一覧|全部|どんな)"
    r"|どの\s*タブ.{0,10}(ある|あります)"
    r"|ダッシュボード.{0,15}(案内|紹介|説明|機能)"
    r"|BIM\s*(ビューア|ビューワー).{0,20}(説明|使い方|機能)",
    re.IGNORECASE,
)



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

    # 6. RAG 에이전트 (건설 공정서·시방서 KCS·KDS)
    if _RAG_KEYWORDS.search(user_text):
        return {"intent": "rag_agent", "next_agent": "rag_agent"}

    # 7. 일반 탭 안내
    if _TAB_GUIDE_KEYWORDS.search(user_text):
        return {"intent": "tab_guide", "next_agent": "tab_guide"}

    # ── 8. 기본값: 일반 대화 (LLM 호출 없이 즉시 반환) ──────────────────────
    # 키워드에 해당하지 않는 모든 메시지는 chat으로 라우팅
    # 기존 LLM 폴백 제거 → supervisor가 항상 ~1ms 이내 완료됨
    return {"intent": "chat", "next_agent": "chat"}


def route_by_next_agent(state: AgentState) -> str:
    """Conditional edge: next_agent 값에 따라 노드를 선택합니다."""
    return state.get("next_agent") or "chat"
