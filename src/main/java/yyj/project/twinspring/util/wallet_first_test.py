# app.py
import os
from typing import TypedDict, Any, Dict, List
from datetime import datetime
from math import radians, sin, cos, asin, sqrt

from pydantic import BaseModel
from dotenv import load_dotenv

from sqlalchemy import create_engine, text
from sqlalchemy.pool import QueuePool

from langgraph.graph import StateGraph, END
from flask import Flask, request, jsonify

# ── env & config ───────────────────────────────────────────────
load_dotenv()

ENGINE = ENGINE = create_engine("mysql+pymysql://root:Abcd1234@localhost:3306/dallas_wallet_v2")

CFG = {
    "BLOCK_CUT": float(os.getenv("BLOCK_CUT", 0.85)),
    "REVIEW_CUT": float(os.getenv("REVIEW_CUT", 0.60)),
    "Z_STRONG": float(os.getenv("Z_STRONG", 4.0)),
    "Z_WARN": float(os.getenv("Z_WARN", 2.5)),
    "COUNT10M_BLOCK": int(os.getenv("COUNT10M_BLOCK", 5)),
    "COUNT10M_WARN": int(os.getenv("COUNT10M_WARN", 3)),
    "SAME_TARGET10M_WARN": int(os.getenv("SAME_TARGET10M_WARN", 3)),
    "HI_AMOUNT_ABS": float(os.getenv("HI_AMOUNT_ABS", 3_000_000)),
    "IMPOSSIBLE_SPEED_KMH": float(os.getenv("IMPOSSIBLE_SPEED_KMH", 600)),
    "FAR_KM": float(os.getenv("FAR_KM", 500)),
    "N30D_MIN": int(os.getenv("N30D_MIN", 5)),
}

# ── schema capability detect ───────────────────────────────────
def detect_caps() -> Dict[str, bool]:
    sql = text("""
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'TBL_TRANSACTION'
        AND COLUMN_NAME IN ('date_dt','amount_num','latitude','longitude','device_id')
    """)
    with ENGINE.connect() as conn:
        cols = {row[0] for row in conn.execute(sql)}
    return {
        "has_date_dt": "date_dt" in cols,
        "has_amount_num": "amount_num" in cols,
        "has_geo": "latitude" in cols and "longitude" in cols,
        "has_device": "device_id" in cols,
    }

CAPS = detect_caps()

# ── utils ──────────────────────────────────────────────────────
def parse_dt(dt_str: str) -> datetime:
    return datetime.strptime(dt_str, "%Y-%m-%d_%H:%M:%S")

def haversine_km(lat1, lon1, lat2, lon2) -> float:
    if None in (lat1, lon1, lat2, lon2): return 0.0
    R=6371.0088
    dlat=radians(lat2-lat1); dlon=radians(lon2-lon1)
    a=sin(dlat/2)**2 + cos(radians(lat1))*cos(radians(lat2))*sin(dlon/2)**2
    return 2*R*asin(a**0.5)

def circular_hour_diff(h: float, h_avg: float) -> float:
    d = abs(h - h_avg) % 24.0
    return min(d, 24.0 - d)

# ── State & SQL ────────────────────────────────────────────────
class GraphState(TypedDict):
    tx: Dict[str, Any]
    stats: Dict[str, Any]
    rule_hits: List[str]
    risk_score: float
    decision: str
    reasons: List[str]
    evidence: Dict[str, Any]

SQL_30D_LEGACY = text("""
SELECT
  COUNT(*) AS n_30d,
  AVG(CAST(amount AS DECIMAL(18,2))) AS avg_amount,
  STDDEV_SAMP(CAST(amount AS DECIMAL(18,2))) AS std_amount,
  AVG(HOUR(STR_TO_DATE(`date`,'%Y-%m-%d_%H:%i:%s'))) AS avg_hour
FROM TBL_TRANSACTION
WHERE source_name=:src
  AND amount REGEXP '^[0-9]+(\\.[0-9]+)?$'
  AND STR_TO_DATE(`date`,'%Y-%m-%d_%H:%i:%s') >= DATE_SUB(STR_TO_DATE(:cur_dt, '%Y-%m-%d_%H:%i:%s'), INTERVAL 30 DAY)
""")
SQL_30D_EXT = text("""
SELECT
  COUNT(*) AS n_30d,
  AVG(amount_num) AS avg_amount,
  STDDEV_SAMP(amount_num) AS std_amount,
  AVG(HOUR(date_dt)) AS avg_hour,
  AVG(latitude) AS avg_lat, AVG(longitude) AS avg_lon
FROM TBL_TRANSACTION
WHERE source_name=:src AND date_dt >= DATE_SUB(:cur_dt_dt, INTERVAL 30 DAY)
""")
SQL_LAST_LEGACY = text("""
SELECT `date` AS date_str, NULL AS date_dt, NULL AS latitude, NULL AS longitude, NULL AS device_id
FROM TBL_TRANSACTION
WHERE source_name=:src
  AND STR_TO_DATE(`date`,'%Y-%m-%d_%H:%i:%s') < STR_TO_DATE(:cur_dt, '%Y-%m-%d_%H:%i:%s')
ORDER BY STR_TO_DATE(`date`,'%Y-%m-%d_%H:%i:%s') DESC
LIMIT 1
""")
SQL_LAST_EXT = text("""
SELECT date_dt, latitude, longitude, device_id
FROM TBL_TRANSACTION
WHERE source_name=:src AND date_dt < :cur_dt_dt
ORDER BY date_dt DESC
LIMIT 1
""")
SQL_CNT10_LEGACY = text("""
SELECT COUNT(*) AS cnt
FROM TBL_TRANSACTION
WHERE source_name=:src
  AND STR_TO_DATE(`date`,'%Y-%m-%d_%H:%i:%s') >= DATE_SUB(STR_TO_DATE(:cur_dt, '%Y-%m-%d_%H:%i:%s'), INTERVAL 10 MINUTE)
""")
SQL_CNT10_EXT = text("""
SELECT COUNT(*) AS cnt
FROM TBL_TRANSACTION
WHERE source_name=:src AND date_dt >= DATE_SUB(:cur_dt_dt, INTERVAL 10 MINUTE)
""")
SQL_CNT10_SAME_LEGACY = text("""
SELECT COUNT(*) AS cnt
FROM TBL_TRANSACTION
WHERE source_name=:src AND target_name=:tgt
  AND STR_TO_DATE(`date`,'%Y-%m-%d_%H:%i:%s') >= DATE_SUB(STR_TO_DATE(:cur_dt, '%Y-%m-%d_%H:%i:%s'), INTERVAL 10 MINUTE)
""")
SQL_CNT10_SAME_EXT = text("""
SELECT COUNT(*) AS cnt
FROM TBL_TRANSACTION
WHERE source_name=:src AND target_name=:tgt
  AND date_dt >= DATE_SUB(:cur_dt_dt, INTERVAL 10 MINUTE)
""")
SQL_DEVICE_90D_EXT = text("""
SELECT COUNT(*) AS seen
FROM TBL_TRANSACTION
WHERE source_name=:src AND device_id=:dev AND date_dt >= DATE_SUB(:cur_dt_dt, INTERVAL 90 DAY)
""")

# ── explain text ───────────────────────────────────────────────
def explain(state: GraphState) -> List[str]:
    tx, st, hits = state["tx"], state["stats"], set(state["rule_hits"])
    out=[]
    if "R1_amount_z_ge_4" in hits:
        out.append(f"금액 z-score {st.get('z_amount',0):.2f} (≥{CFG['Z_STRONG']:.2f}). "
                   f"(금액={tx['amount']:,.0f}, 평균={st.get('avg_amount',0):,.0f}, 표준편차={st.get('std_amount',0):,.0f})")
    if "R1_amount_z_ge_2p5" in hits:
        out.append(f"금액 z-score {st.get('z_amount',0):.2f} (≥{CFG['Z_WARN']:.2f}).")
    if "R2_count10m_ge_block" in hits:
        out.append(f"최근 10분 발신자 거래 {st.get('count_10m',0)}건 (≥{CFG['COUNT10M_BLOCK']}).")
    if "R2_count10m_ge_warn" in hits:
        out.append(f"최근 10분 발신자 거래 {st.get('count_10m',0)}건 (≥{CFG['COUNT10M_WARN']}).")
    if "R3_same_tgt10m_ge_warn" in hits:
        out.append(f"최근 10분 동일 수신자 {st.get('same_target_10m',0)}건 (≥{CFG['SAME_TARGET10M_WARN']}).")
    if "R4_new_device_high_amount" in hits:
        out.append("최근 90일 내 최초 기기 + 고액.")
    if "R5_device_switch_fast" in hits:
        out.append("1시간 내 기기 전환 + 고액.")
    if "R6_far_at_night" in hits:
        out.append(f"평소 위치에서 {st.get('distance_from_home_km',0):.1f}km 원거리 + 심야.")
    if "R7_impossible_travel" in hits:
        out.append(f"직전 거래 대비 이동속도 {st.get('speed_kmh',0):.0f}km/h (비현실).")
    if "R8_hour_delta_high_amount" in hits:
        out.append(f"평소 시간대와 {st.get('hour_delta_from_avg',0):.1f}h 차이 + 고액.")
    if not out:
        out.append("규칙 위반 없음: 정상 승인.")
    return out

# ── LangGraph nodes ────────────────────────────────────────────
def ingest(state: GraphState) -> GraphState:
    tx=state["tx"]
    for k in ["date","source_name","target_name","amount","transaction_code"]:
        if k not in tx: raise ValueError(f"missing field: {k}")
    tx["amount"]=float(tx["amount"])
    tx["hour"]=parse_dt(tx["date"]).hour
    for opt in ("latitude","longitude","device_id"):
        if opt in tx and tx[opt] is not None:
            if opt in ("latitude","longitude"): tx[opt]=float(tx[opt])
    state["tx"]=tx
    return state

def fetch(state: GraphState) -> GraphState:
    tx=state["tx"]; src, tgt, cur_dt = tx["source_name"], tx["target_name"], tx["date"]
    cur_dt_dt=parse_dt(cur_dt)
    with ENGINE.connect() as conn:
        if CAPS["has_date_dt"] and CAPS["has_amount_num"]:
            r30  = conn.execute(SQL_30D_EXT,{"src":src,"cur_dt_dt":cur_dt_dt}).mappings().first()
            r10  = conn.execute(SQL_CNT10_EXT,{"src":src,"cur_dt_dt":cur_dt_dt}).mappings().first()
            r10t = conn.execute(SQL_CNT10_SAME_EXT,{"src":src,"tgt":tgt,"cur_dt_dt":cur_dt_dt}).mappings().first()
            rlast= conn.execute(SQL_LAST_EXT,{"src":src,"cur_dt_dt":cur_dt_dt}).mappings().first()
        else:
            r30  = conn.execute(SQL_30D_LEGACY,{"src":src,"cur_dt":cur_dt}).mappings().first()
            r10  = conn.execute(SQL_CNT10_LEGACY,{"src":src,"cur_dt":cur_dt}).mappings().first()
            r10t = conn.execute(SQL_CNT10_SAME_LEGACY,{"src":src,"tgt":tgt,"cur_dt":cur_dt}).mappings().first()
            rlast= conn.execute(SQL_LAST_LEGACY,{"src":src,"cur_dt":cur_dt}).mappings().first()
        if CAPS["has_date_dt"] and CAPS["has_device"]:
            rdev = conn.execute(SQL_DEVICE_90D_EXT,{"src":src,"dev":tx.get("device_id"),"cur_dt_dt":cur_dt_dt}).mappings().first()
        else:
            rdev={"seen":0}

    n_30d=int(r30["n_30d"] or 0)
    avg_amount=float(r30["avg_amount"] or 0.0)
    std_amount=float(r30["std_amount"] or 0.0)
    avg_hour=float(r30["avg_hour"] or 0.0)
    avg_lat=float(r30.get("avg_lat") or 0.0)
    avg_lon=float(r30.get("avg_lon") or 0.0)

    cnt_10m=int(r10["cnt"]); same_target_10m=int(r10t["cnt"])
    if rlast:
        if CAPS["has_date_dt"]: last_dt=rlast["date_dt"]
        else: last_dt=parse_dt(rlast["date_str"])
        time_since_last_h=max(0.0,(cur_dt_dt-last_dt).total_seconds()/3600.0) if last_dt else 1e9
        last_lat=float((rlast.get("latitude") or 0.0)); last_lon=float((rlast.get("longitude") or 0.0))
        dist_last=haversine_km(tx.get("latitude") or 0.0, tx.get("longitude") or 0.0, last_lat, last_lon)
        speed_kmh=(dist_last/time_since_last_h) if time_since_last_h>0 else 0.0
        device_switched = CAPS["has_device"] and rlast.get("device_id") and tx.get("device_id") and rlast["device_id"]!=tx["device_id"]
    else:
        time_since_last_h, dist_last, speed_kmh, device_switched = 1e9, 0.0, 0.0, False

    device_seen_90d = (int(rdev["seen"])>0) if rdev else False

    if n_30d>=CFG["N30D_MIN"] and std_amount>0:
        z=(tx["amount"]-avg_amount)/std_amount; z_ok=True
    else:
        z, z_ok = 0.0, False

    if CAPS["has_geo"] and n_30d>=CFG["N30D_MIN"] and tx.get("latitude") is not None:
        dist_home=haversine_km(tx["latitude"],tx["longitude"],avg_lat,avg_lon)
    else:
        dist_home=0.0

    hour_delta = circular_hour_diff(float(tx["hour"]), avg_hour) if n_30d>=CFG["N30D_MIN"] else 0.0

    state["stats"]={
        "n_30d":n_30d,"avg_amount":avg_amount,"std_amount":std_amount,
        "z_amount":z,"z_applicable":z_ok,
        "count_10m":cnt_10m,"same_target_10m":same_target_10m,
        "avg_hour":avg_hour,"hour_delta_from_avg":hour_delta,
        "avg_lat":avg_lat,"avg_lon":avg_lon,
        "distance_from_home_km":dist_home,
        "time_since_last_h":time_since_last_h,
        "distance_from_last_km":dist_last,"speed_kmh":speed_kmh,
        "device_seen_90d":device_seen_90d,"device_switched":device_switched,
        "caps":CAPS
    }
    return state

def evaluate(state: GraphState) -> GraphState:
    tx, st = state["tx"], state["stats"]; hits=[]
    # R1: 금액 z-score
    if st["z_applicable"]:
        if st["z_amount"]>=CFG["Z_STRONG"]: hits.append("R1_amount_z_ge_4")
        elif st["z_amount"]>=CFG["Z_WARN"]: hits.append("R1_amount_z_ge_2p5")
    # R2: 10분 빈도
    if st["count_10m"]>=CFG["COUNT10M_BLOCK"]: hits.append("R2_count10m_ge_block")
    elif st["count_10m"]>=CFG["COUNT10M_WARN"]: hits.append("R2_count10m_ge_warn")
    # R3: 동일 수신자 반복
    if st["same_target_10m"]>=CFG["SAME_TARGET10M_WARN"]: hits.append("R3_same_tgt10m_ge_warn")
    # 확장 규칙
    high_amount = (st["z_applicable"] and st["z_amount"]>=2.0) or (tx["amount"]>=CFG["HI_AMOUNT_ABS"])
    if CAPS["has_device"] and CAPS["has_date_dt"]:
        if (not st["device_seen_90d"]) and high_amount: hits.append("R4_new_device_high_amount")
        if st["device_switched"] and st["time_since_last_h"]<=1.0 and high_amount: hits.append("R5_device_switch_fast")
    if CAPS["has_geo"] and st["n_30d"]>=CFG["N30D_MIN"]:
        if st["distance_from_home_km"]>=CFG["FAR_KM"] and tx["hour"] in (2,3,4,5): hits.append("R6_far_at_night")
        if st["speed_kmh"]>=CFG["IMPOSSIBLE_SPEED_KMH"]: hits.append("R7_impossible_travel")
    if st["hour_delta_from_avg"]>=6.0 and high_amount: hits.append("R8_hour_delta_high_amount")

    weights={
        "R1_amount_z_ge_4":0.60, "R1_amount_z_ge_2p5":0.35,
        "R2_count10m_ge_block":0.40, "R2_count10m_ge_warn":0.25,
        "R3_same_tgt10m_ge_warn":0.30, "R4_new_device_high_amount":0.30,
        "R5_device_switch_fast":0.20, "R6_far_at_night":0.25,
        "R7_impossible_travel":0.50, "R8_hour_delta_high_amount":0.25
    }
    risk = sum(weights.get(h,0.0) for h in hits)
    state["rule_hits"]=hits; state["risk_score"]=min(1.0, risk); return state

def decide(state: GraphState) -> GraphState:
    r=state["risk_score"]; hits=set(state["rule_hits"])
    if "R7_impossible_travel" in hits or "R1_amount_z_ge_4" in hits or "R2_count10m_ge_block" in hits:
        decision="block"
    elif r>=CFG["REVIEW_CUT"] or hits & {"R1_amount_z_ge_2p5","R2_count10m_ge_warn","R3_same_tgt10m_ge_warn",
                                         "R4_new_device_high_amount","R5_device_switch_fast","R6_far_at_night","R8_hour_delta_high_amount"}:
        decision="review"
    else:
        decision="approve"
    state["decision"]=decision
    state["reasons"]=explain(state)
    tx, st = state["tx"], state["stats"]
    state["evidence"]={
        "date":tx["date"],"source_name":tx["source_name"],"target_name":tx["target_name"],
        "amount":tx["amount"],"hour":tx["hour"],
        "n_30d":st["n_30d"],"avg_amount":st["avg_amount"],"std_amount":st["std_amount"],"z_amount":st["z_amount"],
        "count_10m":st["count_10m"],"same_target_10m":st["same_target_10m"],
        "distance_from_last_km":round(st["distance_from_last_km"],2),
        "distance_from_home_km":round(st["distance_from_home_km"],2),
        "time_since_last_h":round(st["time_since_last_h"],2),
        "speed_kmh":round(st["speed_kmh"],1),
        "hour_delta_from_avg":round(st["hour_delta_from_avg"],1),
        "device_seen_90d":st["device_seen_90d"],"device_switched":st["device_switched"],
        "caps":st["caps"]
    }
    return state

# ── graph ──────────────────────────────────────────────────────
g = StateGraph(GraphState)
g.add_node("Ingest", ingest)
g.add_node("Fetch", fetch)
g.add_node("Evaluate", evaluate)
g.add_node("Decide", decide)
g.set_entry_point("Ingest")
g.add_edge("Ingest","Fetch")
g.add_edge("Fetch","Evaluate")
g.add_edge("Evaluate","Decide")
g.add_edge("Decide", END)
APP = g.compile()

class TxReq(BaseModel):
    date: str
    source_name: str
    target_name: str
    amount: float | str
    transaction_code: str
    latitude: float | None = None
    longitude: float | None = None
    device_id: str | None = None

## test code
# if __name__ == "__main__":
#     sample_tx = {
#         "date": "2025-08-26_09:57:17",
#         "source_name": "01049194784",
#         "target_name": "01049194784",
#         "amount": "800000",
#         "transaction_code": "transfer",
#
#     }
#     out = APP.invoke({"tx": sample_tx})
#     print({
#         "decision": out["decision"],
#         "risk_score": out["risk_score"],
#         "rule_hits": out["rule_hits"],
#         "reasons": out["reasons"],
#         "evidence": out["evidence"]
#     })
##


flask_app = Flask(__name__)

@flask_app.route("/agent", methods=["POST"])
def agent():
    payload = request.get_json(force=True) or {}
    try:
        out = APP.invoke({"tx": payload})
        return jsonify({
            "decision": out["decision"],
            "risk_score": round(out["risk_score"], 3),
            "rule_hits": out["rule_hits"],
            "reasons": out["reasons"],
            "evidence": out["evidence"]
        })
    except Exception as e:
        return jsonify({
            "decision": "review",
            "risk_score": 0.6,
            "rule_hits": [],
            "reasons": [f"시스템 오류로 수동 심사를 권고합니다: {str(e)}"],
            "evidence": {}
        }), 500

if __name__ == "__main__":
    # 개발용 실행
    flask_app.run(host="0.0.0.0", port=5005)