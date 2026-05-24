from typing import TypedDict, Any, Dict, List
from langgraph.graph import StateGraph, END
from sqlalchemy import create_engine, text
import math, time

# --- DB 연결 ---
ENGINE = create_engine("mysql+pymysql://root:Abcd1234@localhost:3306/dallas_wallet_v2")

# === State ===
class GraphState(TypedDict):
    tx: Dict[str, Any]            # 입력 트랜잭션 (최소 필드)
    stats: Dict[str, Any]         # 평균/표준편차, 빈도 등
    rule_hits: List[str]          # 발동 규칙
    risk_score: float             # 0~1
    decision: str                 # "approve"|"review"|"block"
    reasons: List[str]            # 설명
    evidence: Dict[str, Any]      # 수치 근거

# === SQL (date는 'YYYY-MM-DD_HH:mm:SS' 문자열) ===
SQL_30D_SRC = text("""
SELECT
  AVG(CAST(amount AS DECIMAL(18,2)))      AS avg_amount,
  STDDEV_SAMP(CAST(amount AS DECIMAL(18,2))) AS std_amount
FROM TBL_TRANSACTION
WHERE source_name = :src
  AND STR_TO_DATE(`date`, '%Y-%m-%d_%H:%i:%s') >= DATE_SUB(
        STR_TO_DATE(:cur_dt, '%Y-%m-%d_%H:%i:%s'), INTERVAL 30 DAY)
""")

SQL_CNT_10M_SRC = text("""
SELECT COUNT(*) AS cnt
FROM TBL_TRANSACTION
WHERE source_name = :src
  AND STR_TO_DATE(`date`, '%Y-%m-%d_%H:%i:%s') >= DATE_SUB(
        STR_TO_DATE(:cur_dt, '%Y-%m-%d_%H:%i:%s'), INTERVAL 10 MINUTE)
""")

SQL_CNT_10M_SAME_TGT = text("""
SELECT COUNT(*) AS cnt
FROM TBL_TRANSACTION
WHERE source_name = :src
  AND target_name = :tgt
  AND STR_TO_DATE(`date`, '%Y-%m-%d_%H:%i:%s') >= DATE_SUB(
        STR_TO_DATE(:cur_dt, '%Y-%m-%d_%H:%i:%s'), INTERVAL 10 MINUTE)
""")

# === 설명 생성 ===
def explain_reasons(state: GraphState) -> List[str]:
    tx, st = state["tx"], state["stats"]
    rs: List[str] = []

    if "R1_amount_z_ge_4" in state["rule_hits"]:
        rs.append(
            f"보낸 사람 최근 30일 평균 대비 금액 z-score가 {st.get('z_amount',0):.2f}로 임계(≥4.00) 초과입니다. "
            f"(금액={float(tx['amount']):,.0f}, 평균={st.get('avg_amount',0):,.0f}, 표준편차={st.get('std_amount',0):,.0f})"
        )
    if "R1_amount_z_ge_2p5" in state["rule_hits"]:
        rs.append(f"금액 z-score {st.get('z_amount',0):.2f}로 주의 임계(≥2.50)에 해당합니다.")
    if "R2_count10m_ge_5" in state["rule_hits"]:
        rs.append(f"최근 10분 내 해당 발신자의 전송 {st.get('count_10m',0)}건으로 과도한 빈도(≥5건)입니다.")
    if "R2_count10m_ge_3" in state["rule_hits"]:
        rs.append(f"최근 10분 내 해당 발신자의 전송 {st.get('count_10m',0)}건으로 주의 수준(≥3건)입니다.")
    if "R3_same_tgt10m_ge_3" in state["rule_hits"]:
        rs.append(f"최근 10분 내 동일 수신자에게 {st.get('same_target_10m',0)}건 반복 전송(≥3건)입니다.")

    if not rs:
        rs.append("규칙 위반 없음: 정상 승인 기준을 충족합니다.")
    return rs

# === 노드 ===
def ingest_and_validate(state: GraphState) -> GraphState:
    tx = state["tx"]
    required = ["date", "source_name", "target_name", "amount", "transaction_code"]
    for k in required:
        if k not in tx:
            raise ValueError(f"missing field: {k}")
    # 타입 보정
    tx["amount"] = float(tx["amount"])
    state["tx"] = tx
    return state

def fetch_stats(state: GraphState) -> GraphState:
    tx = state["tx"]
    src, tgt, cur_dt = tx["source_name"], tx["target_name"], tx["date"]
    with ENGINE.connect() as conn:
        r30  = conn.execute(SQL_30D_SRC,       {"src": src, "cur_dt": cur_dt}).mappings().first()
        r10  = conn.execute(SQL_CNT_10M_SRC,   {"src": src, "cur_dt": cur_dt}).mappings().first()
        r10t = conn.execute(SQL_CNT_10M_SAME_TGT, {"src": src, "tgt": tgt, "cur_dt": cur_dt}).mappings().first()

    avg_amount = float(r30["avg_amount"] or 0.0)
    std_amount = float(r30["std_amount"] or 0.0)
    cnt_10m = int(r10["cnt"])
    same_target_10m = int(r10t["cnt"])

    # z-score (분모 0 방지: std<1이면 1로 대체)
    z = (tx["amount"] - avg_amount) / (std_amount if std_amount > 1.0 else 1.0)

    state["stats"] = {
        "avg_amount": avg_amount,
        "std_amount": std_amount,
        "z_amount": z,
        "count_10m": cnt_10m,
        "same_target_10m": same_target_10m
    }
    return state

def rule_evaluate(state: GraphState) -> GraphState:
    st = state["stats"]
    hits: List[str] = []

    # R1: 금액 z-score
    if st["z_amount"] >= 4.0:
        hits.append("R1_amount_z_ge_4")
    elif st["z_amount"] >= 2.5:
        hits.append("R1_amount_z_ge_2p5")

    # R2: 최근 10분 전체 전송 횟수 (발신자 기준)
    if st["count_10m"] >= 5:
        hits.append("R2_count10m_ge_5")
    elif st["count_10m"] >= 3:
        hits.append("R2_count10m_ge_3")

    # R3: 최근 10분 동일 수신자 반복
    if st["same_target_10m"] >= 3:
        hits.append("R3_same_tgt10m_ge_3")

    state["rule_hits"] = hits

    # 간단 위험 점수(가중합)
    risk = 0.0
    for h in hits:
        risk += {
            "R1_amount_z_ge_4":    0.60,
            "R1_amount_z_ge_2p5":  0.35,
            "R2_count10m_ge_5":    0.40,
            "R2_count10m_ge_3":    0.25,
            "R3_same_tgt10m_ge_3": 0.30,
        }.get(h, 0.0)
    state["risk_score"] = min(1.0, risk)
    return state

def decision_gate(state: GraphState) -> GraphState:
    r = state["risk_score"]
    hits = set(state["rule_hits"])
    if "R1_amount_z_ge_4" in hits or "R2_count10m_ge_5" in hits:
        state["decision"] = "block"
    elif r >= 0.60 or "R1_amount_z_ge_2p5" in hits or "R2_count10m_ge_3" in hits or "R3_same_tgt10m_ge_3" in hits:
        state["decision"] = "review"
    else:
        state["decision"] = "approve"

    # 설명 & 근거
    state["reasons"] = explain_reasons(state)
    st = state["stats"]
    tx = state["tx"]
    state["evidence"] = {
        "source_name": tx["source_name"],
        "target_name": tx["target_name"],
        "date": tx["date"],
        "amount": float(tx["amount"]),
        "avg_amount": float(st.get("avg_amount", 0)),
        "std_amount": float(st.get("std_amount", 0)),
        "z_amount": float(st.get("z_amount", 0)),
        "count_10m": int(st.get("count_10m", 0)),
        "same_target_10m": int(st.get("same_target_10m", 0)),
    }
    return state

# === 그래프 조립 ===
g = StateGraph(GraphState)
g.add_node("IngestAndValidate", ingest_and_validate)
g.add_node("FetchStats", fetch_stats)
g.add_node("RuleEvaluate", rule_evaluate)
g.add_node("DecisionGate", decision_gate)
g.set_entry_point("IngestAndValidate")
g.add_edge("IngestAndValidate", "FetchStats")
g.add_edge("FetchStats", "RuleEvaluate")
g.add_edge("RuleEvaluate", "DecisionGate")
g.add_edge("DecisionGate", END)
APP = g.compile()

# === 사용 예시 ===
if __name__ == "__main__":
    sample_tx = {
        "date": "2025-08-26_09:57:17",
        "source_name": "01049194784",
        "target_name": "01049194784",
        "amount": "800000",
        "transaction_code": "transfer",

    }
    out = APP.invoke({"tx": sample_tx})
    print({
        "decision": out["decision"],
        "risk_score": out["risk_score"],
        "rule_hits": out["rule_hits"],
        "reasons": out["reasons"],
        "evidence": out["evidence"]
    })